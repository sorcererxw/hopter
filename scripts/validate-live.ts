import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { execSync } from "node:child_process"
import { chromium, type ConsoleMessage, type Page, type Response } from "playwright"

import { appendDevLog, getLogsDir, readDevState, waitForHttpOk } from "./lib/devloop.ts"
import { createValidationRun } from "./lib/validation.ts"
import { combineValidationStatus, renderValidationSummary, type ValidationCheck } from "./lib/rebuild-validation.ts"

const baseUrl = "http://127.0.0.1:8787"
const healthUrl = `/healthz`

function changedFiles() {
  try {
    const output = execSync("git status --short --untracked-files=no", {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
    return output
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => line.slice(3).trim())
  } catch {
    return []
  }
}

function classifyScope(files: string[]) {
  if (files.length === 0) {
    return "default"
  }
  if (files.every((file) => file.startsWith("docs/") || file.endsWith(".md"))) {
    return "docs"
  }
  if (files.some((file) => file.startsWith("idl/"))) {
    return "idl"
  }
  if (files.some((file) => file.startsWith("cmd/") || file.startsWith("internal/") || file.endsWith(".go"))) {
    return "backend"
  }
  if (files.some((file) => file.startsWith("ui/"))) {
    return "ui"
  }
  return "default"
}

function browserLog(kind: string, payload: Record<string, unknown>) {
  appendDevLog(
    "browser",
    {
      kind,
      ...payload,
    }
  )
}

function messageText(message: ConsoleMessage) {
  try {
    return message.text()
  } catch {
    return "<console message unavailable>"
  }
}

async function logResponse(response: Response) {
  if (response.status() < 400) {
    return
  }

  browserLog("response", {
    method: response.request().method(),
    status: response.status(),
    url: response.url(),
  })
}

async function attachBrowserLogging(page: Page) {
  page.on("console", (message) => {
    browserLog(`console.${message.type()}`, {
      location: message.location(),
      msg: messageText(message),
      url: page.url(),
    })
  })

  page.on("pageerror", (error) => {
    browserLog("pageerror", {
      msg: error.message,
      stack: error.stack,
      url: page.url(),
    })
  })

  page.on("requestfailed", (request) => {
    browserLog("requestfailed", {
      errorText: request.failure()?.errorText,
      method: request.method(),
      url: request.url(),
    })
  })

  page.on("response", (response) => {
    void logResponse(response)
  })
}

async function waitForReady(timeoutMs = 45_000) {
  const started = Date.now()
  let lastState = readDevState()

  while (Date.now() - started < timeoutMs) {
    lastState = readDevState()
    if (lastState?.status === "ready") {
      const health = await waitForHttpOk(healthUrl, 2_500, 125)
      if (health.ok) {
        return { health, state: lastState }
      }
    }

    if (lastState?.status === "build_failed") {
      return {
        health: { error: lastState.lastError || "build failed", ok: false },
        state: lastState,
      }
    }

    await Bun.sleep(250)
  }

  return {
    health: { error: "timed out waiting for dev state ready", ok: false },
    state: lastState,
  }
}

async function run() {
  const run = createValidationRun("verify_live")
  const checks: ValidationCheck[] = []
  const files = changedFiles()
  const scope = classifyScope(files)
  const logsDir = getLogsDir()

  run.writeJson("context.json", {
    baseUrl,
    changedFiles: files,
    logsDir,
    scope,
  })

  checks.push({
    name: "dev state file present",
    status: readDevState() ? "pass" : "blocked",
    detail: readDevState() ? "state.json exists under persistent dev logs" : "run `make dev` before `make verify-live`",
  })

  if (scope === "docs") {
    checks.push({
      name: "docs-only change classification",
      status: "pass",
      detail: "skipped browser smoke because only docs changed",
    })
    const overallStatus = combineValidationStatus(checks.map((check) => check.status))
    run.writeJson("report.json", { checks, logsDir, scope, status: overallStatus })
    run.writeText("summary.md", renderValidationSummary("Live dev verification", checks, [
      "Docs-only change detected; no browser smoke was necessary.",
    ]))
    writeFileSync(path.resolve(process.cwd(), "storage/artifacts/validation/latest-verify-live.txt"), `${run.rootDir}\n`)
    console.log(`Live verification evidence: ${run.rootDir}`)
    return
  }

  const ready = await waitForReady()
  checks.push({
    name: "dev loop ready",
    status: ready.health.ok ? "pass" : "fail",
    detail: ready.health.ok
      ? `state=${ready.state?.status} and ${healthUrl} returned 200`
      : ready.health.error || "dev loop did not become ready",
  })

  if (!ready.health.ok) {
    const overallStatus = combineValidationStatus(checks.map((check) => check.status))
    run.writeJson("report.json", { checks, logsDir, scope, state: ready.state, status: overallStatus })
    run.writeText("summary.md", renderValidationSummary("Live dev verification", checks, [
      "The dev loop did not recover to READY before browser smoke could start.",
    ]))
    writeFileSync(path.resolve(process.cwd(), "storage/artifacts/validation/latest-verify-live.txt"), `${run.rootDir}\n`)
    console.log(`Live verification evidence: ${run.rootDir}`)
    process.exitCode = 1
    return
  }

  const browser = await chromium.launch({ headless: true })
  try {
    mkdirSync(path.join(run.rootDir, "screenshots"), { recursive: true })
    const page = await browser.newPage({ baseURL: baseUrl })
    browserLog("smoke_started", {
      baseUrl,
      changedFiles: files,
      scope,
    })
    await attachBrowserLogging(page)
    await page.goto("/", { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {})
    browserLog("navigation", {
      url: page.url(),
    })
    await page.screenshot({ fullPage: true, path: path.join(run.rootDir, "screenshots", "home.png") })

    const pageText = await page.textContent("body")
    const homeLooksHealthy =
      pageText?.includes("Start building") ||
      pageText?.includes("Start a new session") ||
      pageText?.includes("Loading threads") ||
      pageText?.includes("The shell is ready") ||
      pageText?.includes("New Session") ||
      pageText?.includes("New Thread")

    checks.push({
      name: "workspace shell renders through Go origin",
      status: homeLooksHealthy ? "pass" : "fail",
      detail: homeLooksHealthy
        ? "home route rendered expected shell copy"
        : "home route did not show expected workspace shell text",
    })
    browserLog("smoke_result", {
      ok: homeLooksHealthy,
      url: page.url(),
    })
  } finally {
    await browser.close()
  }

  const overallStatus = combineValidationStatus(checks.map((check) => check.status))
  run.writeJson("report.json", { checks, logsDir, scope, state: ready.state, status: overallStatus })
  run.writeText("summary.md", renderValidationSummary("Live dev verification", checks, [
    `Persistent dev logs are available under ${logsDir}.`,
  ]))
  writeFileSync(path.resolve(process.cwd(), "storage/artifacts/validation/latest-verify-live.txt"), `${run.rootDir}\n`)
  console.log(`Live verification evidence: ${run.rootDir}`)

  if (overallStatus !== "pass") {
    process.exitCode = 1
  }
}

await run()
