import { spawn } from "node:child_process"

import {
  appendDevLog,
  consumeTextStream,
  getRepoRoot,
  localHttpUrl,
  nextDevStateLastError,
  nowIso,
  summarizeErrorLine,
  waitForHttpOk,
  writeDevState,
} from "./lib/devloop.ts"

const repoRoot = getRepoRoot()
const sessionId = `dev-${Date.now()}`

const uiDevHost = "0.0.0.0"
const goDevHost = "127.0.0.1"
const uiDevProxyUrl = localHttpUrl(uiDevHost, 5173)
const healthUrl = "http://127.0.0.1:8787/healthz"
const devArgs = process.argv.slice(2)
const relayMode = devArgs.includes("--relay")

let viteProc: ReturnType<typeof spawn> | null = null
let goProc: ReturnType<typeof spawn> | null = null
let healthTimer: Timer | null = null
let currentStatus: ReturnType<typeof writeDevState>["status"] = "starting"
let lastError = ""
let shutdownStarted = false

const ANSI = {
  blue: "\u001b[34m",
  cyan: "\u001b[36m",
  dim: "\u001b[2m",
  green: "\u001b[32m",
  red: "\u001b[31m",
  reset: "\u001b[0m",
  yellow: "\u001b[33m",
}

function supportsColor() {
  return Boolean(process.stdout.isTTY) && !process.env.NO_COLOR
}

function highlightMessage(source: "go" | "supervisor" | "vite", message: string, stream: "stderr" | "stdout") {
  if (!supportsColor()) {
    return `[${source}] ${message}`
  }

  const sourceColor =
    source === "supervisor"
      ? ANSI.cyan
      : source === "vite"
        ? ANSI.green
        : ANSI.blue

  const normalized = message.toLowerCase()
  let messageColor = ""

  if (
    stream === "stderr" ||
    normalized.includes("error") ||
    normalized.includes("failed") ||
    normalized.includes("exit code 1")
  ) {
    messageColor = ANSI.red
  } else if (
    normalized.includes("ready") ||
    normalized.includes("running") ||
    normalized.includes("listening") ||
    normalized.includes("state=ready")
  ) {
    messageColor = ANSI.green
  } else if (
    normalized.includes("rebuilding") ||
    normalized.includes("building") ||
    normalized.includes("starting") ||
    normalized.includes("watching")
  ) {
    messageColor = ANSI.yellow
  } else if (normalized.includes("stopped") || normalized.includes("shutdown")) {
    messageColor = ANSI.dim
  }

  return `${sourceColor}[${source}]${ANSI.reset} ${messageColor}${message}${ANSI.reset}`
}

function printConsoleLine(source: "go" | "supervisor" | "vite", message: string, stream: "stderr" | "stdout" = "stdout") {
  const writer = stream === "stderr" ? process.stderr : process.stdout
  writer.write(`${highlightMessage(source, message, stream)}\n`)
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
    { name: "hopter", port: 8787 },
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
        `dev preflight failed: ${failures.join("; ")}. Stop the old listeners first.`
    )
  }
}

function setStatus(status: typeof currentStatus, extra: { lastError?: string } = {}) {
  if (status === currentStatus && (extra.lastError ?? "") === lastError) {
    return
  }

  currentStatus = status
  lastError = nextDevStateLastError(status, lastError, extra.lastError)
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

function signalProcessGroup(proc: ReturnType<typeof spawn>, signal: NodeJS.Signals) {
  if (proc.killed) {
    return
  }

  if (proc.pid) {
    try {
      process.kill(-proc.pid, signal)
      return
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? error.code : ""
      if (code === "ESRCH") {
        return
      }
    }
  }

  proc.kill(signal)
}

async function stopPortListeners(signal: NodeJS.Signals) {
  const killSignal = signal.replace(/^SIG/, "")
  for (const port of [5173, 8787]) {
    const proc = spawn(
      "bash",
      [
        "-lc",
        `pids=$(lsof -tiTCP:${port} -sTCP:LISTEN -n -P 2>/dev/null || true); if [ -n "$pids" ]; then kill -${killSignal} $pids 2>/dev/null || true; fi`,
      ],
      {
        cwd: repoRoot,
        stdio: ["ignore", "ignore", "ignore"],
      }
    )
    await new Promise((resolve) => proc.on("close", resolve))
  }
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
    detached: true,
    env: process.env,
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
  const args = ["run", "github.com/air-verse/air@latest", "-c", ".air.toml"]
  if (relayMode) {
    args.push("--", "--relay")
  }

  return {
    command: "go",
    args,
  }
}

async function startGoLoop() {
  printConsoleLine("supervisor", `starting go hot reload loop${relayMode ? " with relay enabled" : ""}`)
  appendDevLog(
    "supervisor",
    {
      event: "go_loop_starting",
      proxyUrl: uiDevProxyUrl,
      relay: relayMode,
    },
    repoRoot
  )

  const runner = resolveGoRunner()
  goProc = spawn(runner.command, runner.args, {
    cwd: repoRoot,
    detached: true,
    env: process.env,
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
    signalProcessGroup(proc, "SIGTERM")
  }
  await stopPortListeners("SIGTERM")

  await Bun.sleep(500)
  for (const proc of [goProc, viteProc]) {
    if (!proc || proc.killed) {
      continue
    }
    signalProcessGroup(proc, "SIGKILL")
  }
  await stopPortListeners("SIGKILL")

  setStatus("stopped")
  process.exit(exitCode)
}

for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"] as const) {
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
