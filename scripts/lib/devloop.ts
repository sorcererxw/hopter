import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"

const DEV_LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const DEV_LOG_ROTATE_BYTES = 10 * 1024 * 1024

export type DevStateStatus = "starting" | "ready" | "rebuilding" | "build_failed" | "stopped"

export type DevState = {
  lastError?: string
  logsDir: string
  pid?: number
  repoRoot: string
  sessionId: string
  status: DevStateStatus
  ts: string
}

export type DevLogSource = "browser" | "go" | "supervisor" | "vite"

export function nowIso() {
  return new Date().toISOString()
}

export function getRepoRoot() {
  return path.resolve(process.cwd())
}

export function normalizeLocalhostHost(host: string) {
  switch (host.trim()) {
    case "":
    case "0.0.0.0":
      return "127.0.0.1"
    case "::":
    case "[::]":
      return "[::1]"
    default:
      return host.trim()
  }
}

export function localHttpUrl(host: string, port: number) {
  return `http://${normalizeLocalhostHost(host)}:${port}`
}

export function nextDevStateLastError(
  status: DevStateStatus,
  previousLastError: string,
  nextLastError?: string
) {
  if (nextLastError !== undefined) {
    return nextLastError
  }

  if (status === "ready") {
    return ""
  }

  return previousLastError
}

export function getRepoSlug(repoRoot = getRepoRoot()) {
  return path.basename(repoRoot).replace(/[^a-zA-Z0-9._-]+/g, "-")
}

export function getLogsDir(repoRoot = getRepoRoot()) {
  return path.join(homedir(), ".hopter", "devlogs", getRepoSlug(repoRoot))
}

export function getStatePath(repoRoot = getRepoRoot()) {
  return path.join(getLogsDir(repoRoot), "state.json")
}

export function getCurrentSessionPath(repoRoot = getRepoRoot()) {
  return path.join(getLogsDir(repoRoot), "current-session.json")
}

function ensureDir(dir: string) {
  mkdirSync(dir, { recursive: true })
}

function maybeRotate(filePath: string) {
  if (!existsSync(filePath)) {
    return
  }

  const stats = statSync(filePath)
  if (stats.size < DEV_LOG_ROTATE_BYTES) {
    return
  }

  const parsed = path.parse(filePath)
  const rotated = path.join(parsed.dir, `${parsed.name}.${nowIso().replaceAll(":", "-")}${parsed.ext}`)
  renameSync(filePath, rotated)
}

export function pruneOldLogs(repoRoot = getRepoRoot()) {
  const logsDir = getLogsDir(repoRoot)
  ensureDir(logsDir)

  const cutoff = Date.now() - DEV_LOG_RETENTION_MS
  for (const entry of readdirSync(logsDir, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue
    }

    const absolutePath = path.join(logsDir, entry.name)
    const stats = statSync(absolutePath)
    if (stats.mtimeMs < cutoff) {
      rmSync(absolutePath, { force: true })
    }
  }
}

export function appendDevLog(
  source: DevLogSource,
  payload: Record<string, unknown>,
  repoRoot = getRepoRoot()
) {
  const logsDir = getLogsDir(repoRoot)
  ensureDir(logsDir)
  pruneOldLogs(repoRoot)

  const entry = {
    ts: nowIso(),
    source,
    ...payload,
  }

  const sourcePath = path.join(logsDir, `${source}.jsonl`)
  const timelinePath = path.join(logsDir, "timeline.jsonl")

  maybeRotate(sourcePath)
  maybeRotate(timelinePath)

  appendFileSync(sourcePath, `${JSON.stringify(entry)}\n`)
  appendFileSync(timelinePath, `${JSON.stringify(entry)}\n`)
}

export function writeDevState(
  state: Omit<DevState, "logsDir" | "repoRoot" | "ts"> & {
    repoRoot?: string
    ts?: string
  }
) {
  const repoRoot = state.repoRoot ? path.resolve(state.repoRoot) : getRepoRoot()
  const logsDir = getLogsDir(repoRoot)
  ensureDir(logsDir)

  const nextState: DevState = {
    logsDir,
    repoRoot,
    sessionId: state.sessionId,
    status: state.status,
    ts: state.ts ?? nowIso(),
    lastError: state.lastError,
    pid: state.pid,
  }

  writeFileSync(getStatePath(repoRoot), JSON.stringify(nextState, null, 2))
  writeFileSync(
    getCurrentSessionPath(repoRoot),
    JSON.stringify(
      {
        logsDir,
        pid: nextState.pid,
        repoRoot,
        sessionId: nextState.sessionId,
        startedAt: nextState.ts,
      },
      null,
      2
    )
  )

  return nextState
}

export function readDevState(repoRoot = getRepoRoot()) {
  const statePath = getStatePath(repoRoot)
  if (!existsSync(statePath)) {
    return null
  }

  return JSON.parse(readFileSync(statePath, "utf8")) as DevState
}

export async function waitForHttpOk(
  url: string,
  timeoutMs = 20_000,
  intervalMs = 250
): Promise<{ ok: boolean; status?: number; body?: string; error?: string }> {
  const started = Date.now()

  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url)
      const body = await response.text()
      if (response.ok) {
        return { ok: true, status: response.status, body }
      }
      await Bun.sleep(intervalMs)
    } catch (error) {
      if (Date.now() - started + intervalMs >= timeoutMs) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
      await Bun.sleep(intervalMs)
    }
  }

  return { ok: false, error: `Timed out waiting for ${url}` }
}

export async function consumeTextStream(
  stream:
    | ReadableStream<Uint8Array>
    | NodeJS.ReadableStream
    | null
    | undefined,
  onLine: (line: string) => void | Promise<void>
) {
  if (!stream) {
    return
  }

  let buffer = ""
  const flush = async (chunkText: string) => {
    buffer += chunkText
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ""

    for (const line of lines) {
      if (line.length > 0) {
        await onLine(line)
      }
    }
  }

  if (typeof (stream as ReadableStream<Uint8Array>).getReader === "function") {
    const reader = (stream as ReadableStream<Uint8Array>)
      .pipeThrough(new TextDecoderStream())
      .getReader()

    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      await flush(value)
    }
  } else {
    for await (const chunk of stream as NodeJS.ReadableStream) {
      await flush(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk))
    }
  }

  if (buffer.length > 0) {
    await onLine(buffer)
  }
}

export function summarizeErrorLine(line: string) {
  return line.trim().slice(0, 280)
}
