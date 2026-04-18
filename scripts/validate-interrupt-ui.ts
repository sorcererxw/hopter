import { writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Page, type Route } from "playwright";

import { readDevState, waitForHttpOk } from "./lib/devloop.ts";
import {
  combineValidationStatus,
  renderValidationSummary,
  type ValidationCheck,
} from "./lib/rebuild-validation.ts";
import { createValidationRun } from "./lib/validation.ts";

const baseUrl =
  process.env.ORCHD_LIVE_BASE_URL?.trim() || "http://127.0.0.1:8787";
const healthUrl =
  process.env.ORCHD_GO_HEALTH_URL?.trim() || `${baseUrl}/healthz`;

const sessionId = "sess_interrupt_mock";
const projectId = "proj_interrupt_mock";
const updatedAt = "2026-04-18T12:48:00Z";

function buildSessionMetaResponse() {
  return {
    session: {
      id: sessionId,
      title: "Interrupt Probe",
      project: {
        id: projectId,
        name: "probe-project",
        rootPath: "/tmp/probe-project",
      },
      status: 2,
      summary: "Codex is still working on this turn...",
      attentionRequired: false,
      attentionReason: "",
      lastInputHint: "",
      updatedAt,
      artifacts: [],
      backendKey: "codex",
      hasMoreBefore: false,
      latestPageSizeHint: 20,
    },
  };
}

function buildTranscriptResponse() {
  return {
    page: {
      items: [
        {
          id: "user-1",
          kind: 1,
          title: "You",
          body: "Please inspect the repository.",
          status: "",
        },
        {
          id: "agent-1",
          kind: 2,
          title: "Codex",
          body: "I am still inspecting files.",
          status: "streaming",
        },
      ],
      hasMoreBefore: false,
      snapshotUpdatedAt: updatedAt,
    },
  };
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
  };
}

function buildListSessionsResponse() {
  return {
    sessions: [
      {
        id: sessionId,
        title: "Interrupt Probe",
        project: {
          id: projectId,
          name: "probe-project",
          rootPath: "/tmp/probe-project",
        },
        status: 2,
        updatedAt,
        attentionRequired: false,
      },
    ],
  };
}

async function fulfillJSON(route: Route, body: unknown) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function wireMockRPC(page: Page, interruptCalls: Array<Record<string, unknown>>) {
  await page.route(
    "**/rpc/orchd.v1.ProjectService/ListProjects",
    async (route) => {
      await fulfillJSON(route, buildListProjectsResponse());
    },
  );

  await page.route(
    "**/rpc/orchd.v1.SessionService/ListSessions",
    async (route) => {
      await fulfillJSON(route, buildListSessionsResponse());
    },
  );

  await page.route(
    "**/rpc/orchd.v1.SessionService/GetSessionMeta",
    async (route) => {
      await fulfillJSON(route, buildSessionMetaResponse());
    },
  );

  await page.route(
    "**/rpc/orchd.v1.SessionService/ListSessionTranscript",
    async (route) => {
      await fulfillJSON(route, buildTranscriptResponse());
    },
  );

  await page.route(
    "**/rpc/orchd.v1.SessionService/InterruptSession",
    async (route) => {
      interruptCalls.push(route.request().postDataJSON() as Record<string, unknown>);
      await fulfillJSON(route, {
        accepted: true,
        sessionId,
        updatedAt,
      });
    },
  );
}

async function waitForReady(timeoutMs = 45_000) {
  const started = Date.now();
  let lastState = readDevState();

  while (Date.now() - started < timeoutMs) {
    lastState = readDevState();
    if (lastState?.status === "ready") {
      const health = await waitForHttpOk(healthUrl, 2_500, 125);
      if (health.ok) {
        return { health, state: lastState };
      }
    }
    await Bun.sleep(250);
  }

  return {
    health: { error: "timed out waiting for dev state ready", ok: false },
    state: lastState,
  };
}

async function main() {
  const run = createValidationRun("interrupt_ui");
  const checks: ValidationCheck[] = [];

  const ready = await waitForReady();
  checks.push({
    name: "dev loop ready",
    status: ready.health.ok ? "pass" : "fail",
    detail: ready.health.ok
      ? `state=${ready.state?.status} and ${healthUrl} returned 200`
      : ready.health.error || "dev loop did not become ready",
  });

  if (!ready.health.ok) {
    const overallStatus = combineValidationStatus(checks.map((check) => check.status));
    run.writeJson("report.json", { checks, state: ready.state, status: overallStatus });
    run.writeText(
      "summary.md",
      renderValidationSummary("Interrupt UI validation", checks, [
        "Skipped browser assertions because the dev loop was not ready.",
      ]),
    );
    writeFileSync(
      path.resolve(process.cwd(), "storage/artifacts/validation/latest-interrupt-ui.txt"),
      `${run.rootDir}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const interruptCalls: Array<Record<string, unknown>> = [];
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({
      baseURL: baseUrl,
      viewport: { width: 1440, height: 1024 },
    });

    await wireMockRPC(page, interruptCalls);
    await page.goto(`/sessions/${sessionId}`, { waitUntil: "domcontentloaded" });

    await page.getByTestId("session-composer").waitFor({ state: "visible", timeout: 15_000 });

    const interruptButton = page.getByTestId("session-interrupt-submit");
    const sendButton = page.getByTestId("session-followup-submit");
    const input = page.getByTestId("session-prompt-input");

    await interruptButton.waitFor({ state: "visible", timeout: 15_000 });

    checks.push({
      name: "empty running composer shows interrupt button",
      status: (await interruptButton.isVisible()) ? "pass" : "fail",
      detail: "session-interrupt-submit should render while the turn is running and the draft is empty",
    });

    await input.fill("Follow up with one more instruction");

    checks.push({
      name: "non-empty composer switches back to send button",
      status: (await sendButton.isVisible()) && !(await interruptButton.isVisible().catch(() => false))
        ? "pass"
        : "fail",
      detail: "session-followup-submit should replace the interrupt button once the user types",
    });

    await input.fill("");
    await interruptButton.waitFor({ state: "visible", timeout: 5_000 });
    await interruptButton.click();

    checks.push({
      name: "interrupt button calls InterruptSession RPC",
      status:
        interruptCalls.length === 1 &&
        interruptCalls[0]?.sessionId === sessionId
          ? "pass"
          : "fail",
      detail:
        interruptCalls.length === 1
          ? JSON.stringify(interruptCalls[0])
          : `interrupt call count = ${interruptCalls.length}`,
    });

    await page.screenshot({
      path: path.join(run.rootDir, "interrupt-button.png"),
      fullPage: true,
    });
  } finally {
    await browser.close();
  }

  const overallStatus = combineValidationStatus(checks.map((check) => check.status));
  run.writeJson("report.json", {
    status: overallStatus,
    checks,
    interruptCalls,
  });
  run.writeText(
    "summary.md",
    renderValidationSummary("Interrupt UI validation", checks, [
      "This lane verifies that the session composer swaps the send button for an interrupt button when the current turn is still running and the draft is empty.",
    ]),
  );
  writeFileSync(
    path.resolve(process.cwd(), "storage/artifacts/validation/latest-interrupt-ui.txt"),
    `${run.rootDir}\n`,
  );
  console.log(`Interrupt UI validation evidence: ${run.rootDir}`);

  if (overallStatus !== "pass") {
    process.exitCode = 1;
  }
}

await main();
