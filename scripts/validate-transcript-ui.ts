import { writeFileSync } from "node:fs"
import path from "node:path"
import { chromium, type Page, type Route } from "playwright"

import { readDevState, waitForHttpOk } from "./lib/devloop.ts"
import { combineValidationStatus, renderValidationSummary, type ValidationCheck } from "./lib/rebuild-validation.ts"
import { createValidationRun } from "./lib/validation.ts"

const baseUrl = process.env.ORCHD_LIVE_BASE_URL?.trim() || "http://127.0.0.1:8787"
const healthUrl = process.env.ORCHD_GO_HEALTH_URL?.trim() || `${baseUrl}/healthz`

const sessionId = "sess_mock"
const projectId = "proj_mock"
const updatedAt = "2026-04-16T16:48:00Z"

function buildSessionResponse(state: "initial" | "afterFollowup") {
  const transcriptItems =
    state === "initial"
      ? [
          {
            id: "user-1",
            kind: "SESSION_TRANSCRIPT_ITEM_KIND_USER_MESSAGE",
            title: "You",
            body: "Build a transcript-aware validation flow.",
            status: "",
          },
          {
            id: "agent-1",
            kind: "SESSION_TRANSCRIPT_ITEM_KIND_AGENT_MESSAGE",
            title: "Codex",
            body: "Added the first transcript-aware path.",
            status: "",
          },
        ]
      : [
          {
            id: "user-1",
            kind: "SESSION_TRANSCRIPT_ITEM_KIND_USER_MESSAGE",
            title: "You",
            body: "Build a transcript-aware validation flow.",
            status: "",
          },
          {
            id: "agent-1",
            kind: "SESSION_TRANSCRIPT_ITEM_KIND_AGENT_MESSAGE",
            title: "Codex",
            body: "Added the first transcript-aware path.",
            status: "",
          },
          {
            id: "user-2",
            kind: "SESSION_TRANSCRIPT_ITEM_KIND_USER_MESSAGE",
            title: "You",
            body: "Follow up with command evidence.",
            status: "",
          },
          {
            id: "cmd-1",
            kind: "SESSION_TRANSCRIPT_ITEM_KIND_COMMAND_EXECUTION",
            title: "Command",
            body: "git status\n\nstatus: completed\n\noutput:\nOn branch master",
            status: "completed",
          },
          {
            id: "agent-2",
            kind: "SESSION_TRANSCRIPT_ITEM_KIND_AGENT_MESSAGE",
            title: "Codex",
            body: "Captured command output and updated the session transcript.",
            status: "",
          },
        ]

  return {
    session: {
      id: sessionId,
      title: "Transcript Probe",
      project: {
        id: projectId,
        name: "probe-project",
        rootPath: "/tmp/probe-project",
      },
      status: "SESSION_STATUS_COMPLETED",
      summary:
        state === "initial"
          ? "Added the first transcript-aware path."
          : "Captured command output and updated the session transcript.",
      attentionRequired: false,
      attentionReason: "",
      lastInputHint:
        state === "initial"
          ? "Build a transcript-aware validation flow."
          : "Follow up with command evidence.",
      updatedAt,
      artifacts: [],
      transcriptItems,
    },
  }
}

function buildListProjectsResponse() {
  return {
    projects: [
      {
        id: projectId,
        name: "probe-project",
        rootPath: "/tmp/probe-project",
        defaultBackend: "codex",
        createdAt: updatedAt,
        updatedAt,
      },
    ],
  }
}

function buildListSessionsResponse() {
  return {
    sessions: [
      {
        id: sessionId,
        title: "Transcript Probe",
        project: {
          id: projectId,
          name: "probe-project",
          rootPath: "/tmp/probe-project",
        },
        status: "SESSION_STATUS_COMPLETED",
        updatedAt,
        attentionRequired: false,
      },
    ],
  }
}

async function fulfillJSON(route: Route, body: unknown) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  })
}

async function wireMockRPC(page: Page) {
  let state: "initial" | "afterFollowup" = "initial"

  await page.route("**/rpc/orchd.v1.ProjectService/ListProjects", async (route) => {
    await fulfillJSON(route, buildListProjectsResponse())
  })

  await page.route("**/rpc/orchd.v1.SessionService/ListSessions", async (route) => {
    await fulfillJSON(route, buildListSessionsResponse())
  })

  await page.route("**/rpc/orchd.v1.SessionService/GetSession", async (route) => {
    await fulfillJSON(route, buildSessionResponse(state))
  })

  await page.route("**/rpc/orchd.v1.SessionService/SendSessionInput", async (route) => {
    state = "afterFollowup"
    await fulfillJSON(route, {
      accepted: true,
      sessionId,
      updatedAt,
    })
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
    await Bun.sleep(250)
  }

  return {
    health: { error: "timed out waiting for dev state ready", ok: false },
    state: lastState,
  }
}

async function main() {
  const run = createValidationRun("transcript_ui")
  const checks: ValidationCheck[] = []

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
    run.writeJson("report.json", { checks, state: ready.state, status: overallStatus })
    run.writeText("summary.md", renderValidationSummary("Transcript UI validation", checks))
    writeFileSync(path.resolve(process.cwd(), "storage/artifacts/validation/latest-transcript-ui.txt"), `${run.rootDir}\n`)
    console.log(`Transcript UI validation evidence: ${run.rootDir}`)
    process.exitCode = 1
    return
  }

  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ baseURL: baseUrl })
    await wireMockRPC(page)

    await page.goto(`/sessions/${sessionId}`, { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {})
    await page.screenshot({
      fullPage: true,
      path: path.join(run.rootDir, "session-initial.png"),
    })

    await page.getByTestId("session-transcript").waitFor()
    await page
      .getByTestId("session-transcript-user")
      .filter({ hasText: "Build a transcript-aware validation flow." })
      .waitFor()
    await page
      .getByTestId("session-transcript-agent")
      .filter({ hasText: "Added the first transcript-aware path." })
      .waitFor()

    checks.push({
      name: "initial transcript render",
      status: "pass",
      detail: "session route rendered initial user and agent transcript items",
    })

    await page.getByTestId("session-prompt-input").fill("Follow up with command evidence.")
    await page.getByTestId("session-followup-submit").click()

    await page
      .getByTestId("session-transcript-user")
      .filter({ hasText: "Follow up with command evidence." })
      .waitFor()

    const commandEntry = page.getByTestId("session-transcript-command")
    await commandEntry.waitFor()
    await page.getByRole("button", { name: /Command/i }).click()
    await commandEntry.getByText("git status").waitFor()
    await page
      .getByTestId("session-transcript-agent")
      .filter({ hasText: "Captured command output and updated the session transcript." })
      .waitFor()

    await page.screenshot({
      fullPage: true,
      path: path.join(run.rootDir, "session-followup.png"),
    })

    checks.push({
      name: "follow-up transcript render",
      status: "pass",
      detail: "follow-up input appended user, command, and agent transcript entries",
    })
  } catch (error) {
    checks.push({
      name: "browser transcript validation",
      status: "fail",
      detail: error instanceof Error ? error.message : String(error),
    })
  } finally {
    await browser.close()
  }

  const overallStatus = combineValidationStatus(checks.map((check) => check.status))
  run.writeJson("report.json", { checks, state: ready.state, status: overallStatus })
  run.writeText(
    "summary.md",
    renderValidationSummary("Transcript UI validation", checks, [
      "This lane validates transcript rendering in the browser with mocked Connect RPC responses.",
    ])
  )
  writeFileSync(path.resolve(process.cwd(), "storage/artifacts/validation/latest-transcript-ui.txt"), `${run.rootDir}\n`)
  console.log(`Transcript UI validation evidence: ${run.rootDir}`)

  if (overallStatus !== "pass") {
    process.exitCode = 1
  }
}

await main()
