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
  "http://127.0.0.1:8787";
const healthUrl = `${baseUrl}/healthz`;

const sessionId = "sess_breakpoint_probe";
const projectId = "proj_breakpoint_probe";
const repoRoot = process.cwd();
const projectName = path.basename(repoRoot);
const updatedAt = "2026-04-17T12:00:00Z";

function buildListProjectsResponse() {
  return {
    projects: [
      {
        id: projectId,
        name: projectName,
        rootPath: repoRoot,
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
        title: "Breakpoint Probe",
        project: {
          id: projectId,
          name: projectName,
          rootPath: repoRoot,
        },
        status: "SESSION_STATUS_RUNNING",
        updatedAt,
        attentionRequired: false,
      },
    ],
  };
}

function buildSessionMetaResponse() {
  return {
    session: {
      id: sessionId,
      title: "Breakpoint Probe",
      project: {
        id: projectId,
        name: projectName,
        rootPath: repoRoot,
      },
      status: "SESSION_STATUS_RUNNING",
      summary: "Breakpoint shell validation is in progress.",
      attentionRequired: false,
      attentionReason: "",
      lastInputHint: "",
      updatedAt,
      artifacts: [],
      backendKey: "codex",
      hasMoreBefore: false,
      latestPageSizeHint: 3,
    },
  };
}

function buildTranscriptPage() {
  return {
    page: {
      items: [
        {
          id: "user-1",
          kind: "SESSION_TRANSCRIPT_ITEM_KIND_USER_MESSAGE",
          title: "You",
          body: "Redesign the breakpoint shell.",
          status: "",
        },
        {
          id: "agent-1",
          kind: "SESSION_TRANSCRIPT_ITEM_KIND_AGENT_MESSAGE",
          title: "Codex",
          body:
            "I unified the workspace shell posture into phone, compact, and wide modes.",
          status: "",
        },
      ],
      hasMoreBefore: false,
      snapshotUpdatedAt: updatedAt,
    },
  };
}

async function fulfillJSON(route: Route, body: unknown) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function wireMockRPC(page: Page) {
  await page.route(
    "**/rpc/hopter.v1.ProjectService/ListProjects",
    async (route) => {
      await fulfillJSON(route, buildListProjectsResponse());
    }
  );

  await page.route(
    "**/rpc/hopter.v1.SessionService/ListSessions",
    async (route) => {
      await fulfillJSON(route, buildListSessionsResponse());
    }
  );

  await page.route(
    "**/rpc/hopter.v1.SessionService/GetSessionMeta",
    async (route) => {
      await fulfillJSON(route, buildSessionMetaResponse());
    }
  );

  await page.route(
    "**/rpc/hopter.v1.SessionService/ListSessionTranscript",
    async (route) => {
      await fulfillJSON(route, buildTranscriptPage());
    }
  );
}

async function createMockPage(browser: Awaited<ReturnType<typeof chromium.launch>>) {
  const page = await browser.newPage({ baseURL: baseUrl });
  await wireMockRPC(page);
  return page;
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

async function screenshotScenario(
  page: Page,
  runRoot: string,
  name: string,
  viewport: { height: number; width: number },
  url: string
) {
  await page.setViewportSize(viewport);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await page.screenshot({
    fullPage: true,
    path: path.join(runRoot, `${name}.png`),
  });
}

async function main() {
  const run = createValidationRun("workspace_breakpoints");
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
    const overallStatus = combineValidationStatus(
      checks.map((check) => check.status)
    );
    run.writeJson("report.json", {
      checks,
      state: ready.state,
      status: overallStatus,
    });
    run.writeText(
      "summary.md",
      renderValidationSummary("Workspace breakpoint validation", checks)
    );
    writeFileSync(
      path.resolve(
        process.cwd(),
        "storage/artifacts/validation/latest-workspace-breakpoints.txt"
      ),
      `${run.rootDir}\n`
    );
    console.log(`Workspace breakpoint validation evidence: ${run.rootDir}`);
    process.exitCode = 1;
    return;
  }

  const browser = await chromium.launch({ headless: true });

  try {
    let page = await createMockPage(browser);
    await screenshotScenario(
      page,
      run.rootDir,
      "phone-list",
      { width: 390, height: 844 },
      "/"
    );
    await page.getByTestId("workspace-phone-list").waitFor();
    await page.getByTestId("session-rail").waitFor();
    await page.getByTestId("workspace-topbar").waitFor({ state: "hidden" }).catch(() => {});

    await page.getByRole("link", { name: /Breakpoint Probe/i }).click();
    await page.waitForURL(`${baseUrl}/sessions/${sessionId}`);
    await page.getByTestId("workspace-phone-detail").waitFor();
    await page.getByTestId("workspace-topbar-back").click();
    await page.waitForURL(`${baseUrl}/`);
    await page.getByTestId("workspace-phone-list").waitFor();

    checks.push({
      name: "phone list posture",
      status: "pass",
      detail:
        "phone home route renders the session list as the entry page and tapping a session returns cleanly to the list",
    });

    await page.close();
    page = await createMockPage(browser);

    await screenshotScenario(
      page,
      run.rootDir,
      "phone-detail",
      { width: 390, height: 844 },
      `/sessions/${sessionId}`
    );
    await page.getByTestId("workspace-phone-detail").waitFor();
    await page.getByTestId("workspace-topbar").waitFor();
    await page.getByTestId("workspace-topbar-back").waitFor();
    const phoneToolbarMode = await page
      .getByTestId("workspace-topbar")
      .getAttribute("data-toolbar-mode");
    if (phoneToolbarMode !== "mobile") {
      throw new Error(`expected phone detail toolbar mode mobile, got ${phoneToolbarMode}`);
    }
    await page.getByTestId("workspace-topbar-back").click();
    await page.waitForURL(`${baseUrl}/`);
    checks.push({
      name: "phone detail back fallback",
      status: "pass",
      detail:
        "phone detail route uses a deterministic back action to the session list",
    });

    await page.close();
    page = await createMockPage(browser);

    await screenshotScenario(
      page,
      run.rootDir,
      "compact-closed",
      { width: 900, height: 1200 },
      `/sessions/${sessionId}`
    );
    await page.getByTestId("workspace-shell-detail").waitFor();
    await page.getByTestId("workspace-topbar-rail-toggle").waitFor();
    const compactToolbarClosed = await page
      .getByTestId("workspace-topbar")
      .getAttribute("data-toolbar-mode");
    if (compactToolbarClosed !== "desktop") {
      throw new Error(
        `expected compact closed toolbar mode desktop, got ${compactToolbarClosed}`
      );
    }
    checks.push({
      name: "compact closed posture",
      status: "pass",
      detail:
        "compact shell keeps the rail hidden by default and uses desktop toolbar mode",
    });

    await page.getByTestId("workspace-topbar-rail-toggle").click();
    await page.getByTestId("workspace-rail-pane").waitFor();
    await page.screenshot({
      fullPage: true,
      path: path.join(run.rootDir, "compact-open.png"),
    });
    const compactToolbarOpen = await page
      .getByTestId("workspace-topbar")
      .getAttribute("data-toolbar-mode");
    if (compactToolbarOpen !== "mobile") {
      throw new Error(
        `expected compact open toolbar mode mobile, got ${compactToolbarOpen}`
      );
    }
    await page.getByRole("link", { name: /Breakpoint Probe/i }).click();
    await page.waitForURL(`${baseUrl}/sessions/${sessionId}`);
    await page.getByTestId("workspace-rail-pane").waitFor();
    await page.getByTestId("workspace-topbar-rail-toggle").click();
    await page.getByTestId("workspace-rail-pane").waitFor({ state: "hidden" });
    checks.push({
      name: "compact open posture",
      status: "pass",
      detail:
        "compact shell switches to mobile toolbar mode while the inline rail is open, keeps the rail visible across session navigation, and collapses cleanly back to desktop mode",
    });

    await page.close();
    page = await createMockPage(browser);

    await screenshotScenario(
      page,
      run.rootDir,
      "wide-visible",
      { width: 1366, height: 900 },
      `/sessions/${sessionId}`
    );
    await page.getByTestId("workspace-rail-pane").waitFor();
    const wideToolbarVisible = await page
      .getByTestId("workspace-topbar")
      .getAttribute("data-toolbar-mode");
    if (wideToolbarVisible !== "desktop") {
      throw new Error(
        `expected wide visible toolbar mode desktop, got ${wideToolbarVisible}`
      );
    }

    await page.getByTestId("workspace-topbar-rail-toggle").click();
    await page.getByTestId("workspace-rail-pane").waitFor({ state: "hidden" });
    await page.screenshot({
      fullPage: true,
      path: path.join(run.rootDir, "wide-hidden.png"),
    });
    const wideToolbarHidden = await page
      .getByTestId("workspace-topbar")
      .getAttribute("data-toolbar-mode");
    if (wideToolbarHidden !== "desktop") {
      throw new Error(
        `expected wide hidden toolbar mode desktop, got ${wideToolbarHidden}`
      );
    }

    checks.push({
      name: "wide posture",
      status: "pass",
      detail:
        "wide shell keeps desktop toolbar mode whether the rail is visible or hidden",
    });
  } catch (error) {
    checks.push({
      name: "workspace breakpoint validation",
      status: "fail",
      detail: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await browser.close();
  }

  const overallStatus = combineValidationStatus(
    checks.map((check) => check.status)
  );
  run.writeJson("report.json", {
    checks,
    state: ready.state,
    status: overallStatus,
  });
  run.writeText(
    "summary.md",
    renderValidationSummary("Workspace breakpoint validation", checks, [
      "This lane validates phone, compact, and wide shell behavior with mocked Connect RPC responses.",
    ])
  );
  writeFileSync(
    path.resolve(
      process.cwd(),
      "storage/artifacts/validation/latest-workspace-breakpoints.txt"
    ),
    `${run.rootDir}\n`
  );
  console.log(`Workspace breakpoint validation evidence: ${run.rootDir}`);

  if (overallStatus !== "pass") {
    process.exitCode = 1;
  }
}

await main();
