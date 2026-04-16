import { spawn } from "node:child_process"

import {
  appendDevLog,
  consumeTextStream,
  getRepoRoot,
  nowIso,
  summarizeErrorLine,
  waitForHttpOk,
  writeDevState,
} from "./lib/devloop.ts"

const repoRoot = getRepoRoot()
const sessionId = `dev-${Date.now()}`

const uiDevHost = process.env.ORCHD_UI_DEV_HOST?.trim() || "0.0.0.0"
const uiDevProxyHost = normalizeProxyHost(process.env.ORCHD_UI_DEV_PROXY_HOST?.trim() || uiDevHost)
const goDevHost = process.env.ORCHD_HOST?.trim() || uiDevHost
const goLocalhostOnlyNoAuth = process.env.ORCHD_LOCALHOST_ONLY_NO_AUTH?.trim() || "false"
const uiDevProxyUrl = process.env.ORCHD_UI_DEV_PROXY_URL?.trim() || `http://${uiDevProxyHost}:5173`
const healthUrl = process.env.ORCHD_GO_HEALTH_URL?.trim() || "http://127.0.0.1:8787/healthz"

let viteProc: ReturnType<typeof spawn> | null = null
let goProc: ReturnType<typeof spawn> | null = null
let healthTimer: Timer | null = null
let currentStatus: ReturnType<typeof writeDevState>["status"] = "starting"
let lastError = ""
let shutdownStarted = false

function printConsoleLine(source: "go" | "supervisor" | "vite", message: string, stream: "stderr" | "stdout" = "stdout") {
  const writer = stream === "stderr" ? process.stderr : process.stdout
  writer.write(`[${source}] ${message}\n`)
}

async function describePortOwner(port: number) {
  const proc = spawn("bash", ["-lc", `lsof -iTCP:${port} -sTCP:LISTEN -n -P | tail -n +2 | head -n 1`], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "ignore"],
  })

  let output = ""
  for await (const chunk of proc.stdout) {
    output += chunk.toString()
  }
  await new Promise((resolve) => proc.on("close", resolve))
  return output.trim()
}

async function preflightPorts() {
  const checks = [
    { name: "vite", port: 5173 },
    { name: "orchd", port: 8787 },
  ]

  const failures: string[] = []
  for (const check of checks) {
    const owner = await describePortOwner(check.port)
    if (!owner) {
      continue
    }

    failures.push(
      `${check.name} port ${check.port} is already in use (${owner})`
    )
  }

  if (failures.length > 0) {
    throw new Error(
      `dev preflight failed: ${failures.join(
        "; "
      )}. Stop the old listeners or change ORCHD_HOST/ORCHD_PORT and ORCHD_UI_DEV_HOST first.`
    )
  }
}

function normalizeProxyHost(host: string) {
  switch (host) {
    case "":
    case "0.0.0.0":
      return "127.0.0.1"
    case "::":
    case "[::]":
      return "[::1]"
    default:
      return host
  }
}

function setStatus(status: typeof currentStatus, extra: { lastError?: string } = {}) {
  if (status === currentStatus && (extra.lastError ?? "") === lastError) {
    return
  }

  currentStatus = status
  lastError = extra.lastError ?? lastError
  writeDevState({
    sessionId,
    status,
    lastError,
    pid: process.pid,
    repoRoot,
    ts: nowIso(),
  })
  appendDevLog(
    "supervisor",
    {
      event: "state_changed",
      lastError,
      status,
    },
    repoRoot
  )
  printConsoleLine(
    "supervisor",
    `state=${status}${lastError ? ` error=${lastError}` : ""}`,
    lastError ? "stderr" : "stdout"
  )
}

function logProcessLine(source: "go" | "vite", stream: "stderr" | "stdout", line: string) {
  appendDevLog(
    source,
    {
      msg: line,
      stream,
    },
    repoRoot
  )
  printConsoleLine(source, line, stream)
}

function maybeInferGoState(line: string, stream: "stderr" | "stdout") {
  const normalized = line.toLowerCase()
  if (normalized.includes("building")) {
    setStatus("rebuilding")
    return
  }

  if (
    normalized.includes("failed to build") ||
    normalized.includes("cannot find package") ||
    normalized.includes("undefined:") ||
    normalized.includes("syntax error") ||
    normalized.includes("compile") && normalized.includes("error")
  ) {
    setStatus("build_failed", { lastError: summarizeErrorLine(line) })
    return
  }

  if (stream === "stderr" && normalized.includes("error")) {
    lastError = summarizeErrorLine(line)
  }
}

async function startVite() {
  printConsoleLine("supervisor", "starting vite dev server")
  appendDevLog(
    "supervisor",
    {
      event: "vite_starting",
    },
    repoRoot
  )

  viteProc = spawn("pnpm", ["--dir", "ui", "dev"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ORCHD_UI_DEV_HOST: uiDevHost,
    },
    stdio: ["ignore", "pipe", "pipe"],
  })

  void consumeTextStream(viteProc.stdout, (line) => logProcessLine("vite", "stdout", line))
  void consumeTextStream(viteProc.stderr, (line) => logProcessLine("vite", "stderr", line))

  viteProc.on("exit", (code, signal) => {
    appendDevLog(
      "supervisor",
      {
        code,
        event: "vite_exit",
        signal,
      },
      repoRoot
    )

    if (!shutdownStarted) {
      setStatus("build_failed", {
        lastError: `vite exited unexpectedly (code=${code ?? "null"}, signal=${signal ?? "null"})`,
      })
      void shutdown(code ?? 1)
    }
  })

  const viteReady = await waitForHttpOk(uiDevProxyUrl)
  if (!viteReady.ok) {
    throw new Error(viteReady.error || `vite dev server did not become ready at ${uiDevProxyUrl}`)
  }

  appendDevLog(
    "supervisor",
    {
      event: "vite_ready",
      url: uiDevProxyUrl,
    },
    repoRoot
  )
  printConsoleLine("supervisor", `vite ready at ${uiDevProxyUrl}`)
}

function resolveGoRunner() {
  const airBin = process.env.ORCHD_AIR_BIN?.trim()
  if (airBin) {
    return { command: airBin, args: ["-c", ".air.toml"] }
  }

  return {
    command: "go",
    args: ["run", "github.com/air-verse/air@latest", "-c", ".air.toml"],
  }
}

async function startGoLoop() {
  printConsoleLine("supervisor", "starting go hot reload loop")
  appendDevLog(
    "supervisor",
    {
      event: "go_loop_starting",
      proxyUrl: uiDevProxyUrl,
    },
    repoRoot
  )

  const runner = resolveGoRunner()
  goProc = spawn(runner.command, runner.args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      ORCHD_HOST: goDevHost,
      ORCHD_LOCALHOST_ONLY_NO_AUTH: goLocalhostOnlyNoAuth,
      ORCHD_UI_DEV_PROXY_URL: uiDevProxyUrl,
    },
    stdio: ["ignore", "pipe", "pipe"],
  })

  void consumeTextStream(goProc.stdout, (line) => {
    logProcessLine("go", "stdout", line)
    maybeInferGoState(line, "stdout")
  })
  void consumeTextStream(goProc.stderr, (line) => {
    logProcessLine("go", "stderr", line)
    maybeInferGoState(line, "stderr")
  })

  goProc.on("exit", (code, signal) => {
    appendDevLog(
      "supervisor",
      {
        code,
        event: "go_loop_exit",
        signal,
      },
      repoRoot
    )

    if (!shutdownStarted) {
      setStatus("build_failed", {
        lastError: `go loop exited unexpectedly (code=${code ?? "null"}, signal=${signal ?? "null"})`,
      })
      void shutdown(code ?? 1)
    }
  })
}

function startHealthMonitor() {
  let wasHealthy = false

  healthTimer = setInterval(async () => {
    const result = await waitForHttpOk(healthUrl, 500, 125)
    if (result.ok) {
      if (!wasHealthy || currentStatus !== "ready") {
        wasHealthy = true
        setStatus("ready")
      }
      return
    }

    if (wasHealthy) {
      wasHealthy = false
      setStatus("rebuilding")
      return
    }

    if (currentStatus === "starting") {
      return
    }

    if (currentStatus !== "build_failed") {
      setStatus("rebuilding")
    }
  }, 500)
}

async function shutdown(exitCode = 0) {
  if (shutdownStarted) {
    return
  }
  shutdownStarted = true

  if (healthTimer) {
    clearInterval(healthTimer)
    healthTimer = null
  }

  appendDevLog(
    "supervisor",
    {
      event: "shutdown",
      exitCode,
    },
    repoRoot
  )
  printConsoleLine("supervisor", `shutdown exitCode=${exitCode}`, exitCode === 0 ? "stdout" : "stderr")

  for (const proc of [goProc, viteProc]) {
    if (!proc || proc.killed) {
      continue
    }
    proc.kill("SIGTERM")
  }

  await Bun.sleep(500)
  for (const proc of [goProc, viteProc]) {
    if (!proc || proc.killed) {
      continue
    }
    proc.kill("SIGKILL")
  }

  setStatus("stopped")
  process.exit(exitCode)
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void shutdown(0)
  })
}

writeDevState({
  sessionId,
  status: "starting",
  pid: process.pid,
  repoRoot,
  ts: nowIso(),
})
printConsoleLine("supervisor", `session started id=${sessionId}`)
appendDevLog(
  "supervisor",
  {
    event: "session_started",
    goDevHost,
    sessionId,
    uiDevHost,
    uiDevProxyUrl,
  },
  repoRoot
)

try {
  await preflightPorts()
  await startVite()
  await startGoLoop()
  startHealthMonitor()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
  setStatus("build_failed", {
    lastError: message,
  })
  appendDevLog(
    "supervisor",
    {
      error: message,
      event: "startup_failed",
    },
    repoRoot
  )
  await shutdown(1)
}
