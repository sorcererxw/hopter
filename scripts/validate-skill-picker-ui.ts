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
const healthUrl = `/healthz`;

const sessionId = "sess_skill_picker_mock";
const projectId = "proj_skill_picker_mock";
const updatedAt = "2026-04-18T15:48:00Z";

function buildSessionMetaResponse() {
  return {
    session: {
      id: sessionId,
      title: "Skill Picker Probe",
      project: {
        id: projectId,
        name: "probe-project",
        rootPath: "/tmp/probe-project",
      },
      status: 3,
      summary: "Waiting for your next instruction.",
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
          id: "agent-1",
          kind: 2,
          title: "Codex",
          body: "Ask for the next step.",
          status: "",
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
        title: "Skill Picker Probe",
        project: {
          id: projectId,
          name: "probe-project",
          rootPath: "/tmp/probe-project",
        },
        status: 3,
        updatedAt,
        attentionRequired: false,
      },
    ],
  };
}

function buildSkillListResponse() {
  return {
    skills: [
      {
        name: "Excel",
        reference: "excel",
        description: "Create and edit spreadsheet or excel files",
        source: "local",
      },
      {
        name: "Ask Claude",
        reference: "ask-claude",
        description: "Ask Claude via local CLI and capture a reusable artifact",
        source: "local",
      },
      {
        name: "Autopilot",
        reference: "autopilot",
        description: "Full autonomous execution from idea to working code",
        source: "project",
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

async function wireMockRPC(
  page: Page,
  sendCalls: Array<Record<string, unknown>>,
) {
  await page.route("**/api/auth/me", async (route) => {
    await fulfillJSON(route, {
      data: {
        authenticated: true,
        user: {
          id: "local-dev",
          mode: "dev",
        },
      },
    });
  });

  await page.route(
    "**/rpc/hopter.v1.ProjectService/ListProjects",
    async (route) => {
      await fulfillJSON(route, buildListProjectsResponse());
    },
  );

  await page.route(
    "**/rpc/hopter.v1.SessionService/ListSessions",
    async (route) => {
      await fulfillJSON(route, buildListSessionsResponse());
    },
  );

  await page.route(
    "**/rpc/hopter.v1.SessionService/GetSessionMeta",
    async (route) => {
      await fulfillJSON(route, buildSessionMetaResponse());
    },
  );

  await page.route(
    "**/rpc/hopter.v1.SessionService/ListSessionTranscript",
    async (route) => {
      await fulfillJSON(route, buildTranscriptResponse());
    },
  );

  await page.route("**/rpc/hopter.v1.HostService/ListSkills", async (route) => {
    await fulfillJSON(route, buildSkillListResponse());
  });

  await page.route(
    "**/rpc/hopter.v1.SessionService/SendSessionInput",
    async (route) => {
      sendCalls.push(route.request().postDataJSON() as Record<string, unknown>);
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
  const run = createValidationRun("skill_picker_ui");
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
      checks.map((check) => check.status),
    );
    run.writeJson("report.json", {
      checks,
      state: ready.state,
      status: overallStatus,
    });
    run.writeText(
      "summary.md",
      renderValidationSummary("Skill picker UI validation", checks, [
        "Skipped browser assertions because the dev loop was not ready.",
      ]),
    );
    writeFileSync(
      path.resolve(
        process.cwd(),
        "storage/artifacts/validation/latest-skill-picker-ui.txt",
      ),
      `${run.rootDir}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const sendCalls: Array<Record<string, unknown>> = [];
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({
      baseURL: baseUrl,
      viewport: { width: 1440, height: 1024 },
    });

    await wireMockRPC(page, sendCalls);
    await page.goto(`/sessions/${sessionId}`, {
      waitUntil: "domcontentloaded",
    });

    const input = page.getByTestId("session-prompt-input");
    await input.waitFor({ state: "visible", timeout: 15_000 });
    await input.fill("$ex");

    const popover = page.getByTestId("skill-suggestion-popover");
    await popover.waitFor({ state: "visible", timeout: 10_000 });

    const excelItem = page.locator(
      '[data-testid="skill-suggestion-item"][data-skill-reference="excel"]',
    );
    checks.push({
      name: "typing $ query opens the skill picker",
      status: (await excelItem.count()) > 0 ? "pass" : "fail",
      detail: "Excel should appear as a suggestion for $ex",
    });

    await input.press("Enter");
    const selectedValue = await input.inputValue();

    checks.push({
      name: "enter inserts selected skill reference",
      status: selectedValue === "$excel " ? "pass" : "fail",
      detail: `input value after selection: ${selectedValue}`,
    });

    const skillHighlight = page.getByTestId("composer-skill-highlight").first();
    const highlightBackground = await skillHighlight.evaluate(
      (node) => window.getComputedStyle(node).backgroundColor,
    );
    checks.push({
      name: "selected skill is highlighted inside the composer",
      status:
        (await skillHighlight.textContent()) === "$excel" &&
        highlightBackground !== "rgba(0, 0, 0, 0)"
          ? "pass"
          : "fail",
      detail: `highlight background: ${highlightBackground}`,
    });

    checks.push({
      name: "skill selection does not submit the turn",
      status: sendCalls.length === 0 ? "pass" : "fail",
      detail:
        sendCalls.length === 0
          ? "no SendSessionInput call was fired while choosing a skill"
          : `unexpected send payload: ${JSON.stringify(sendCalls[0])}`,
    });

    await input.type("build a revenue model");
    await page.getByTestId("session-followup-submit").click();

    checks.push({
      name: "composer sends the inserted skill reference",
      status:
        sendCalls.length === 1 &&
        sendCalls[0]?.input === "$excel build a revenue model"
          ? "pass"
          : "fail",
      detail:
        sendCalls.length === 1
          ? JSON.stringify(sendCalls[0])
          : `send call count = ${sendCalls.length}`,
    });

    await page.screenshot({
      path: path.join(run.rootDir, "skill-picker.png"),
      fullPage: true,
    });

    const overallStatus = combineValidationStatus(
      checks.map((check) => check.status),
    );
    run.writeJson("report.json", { checks, sendCalls, status: overallStatus });
    run.writeText(
      "summary.md",
      renderValidationSummary("Skill picker UI validation", checks),
    );
    writeFileSync(
      path.resolve(
        process.cwd(),
        "storage/artifacts/validation/latest-skill-picker-ui.txt",
      ),
      `${run.rootDir}\n`,
    );
    console.log(`Skill picker UI validation evidence: ${run.rootDir}`);

    if (overallStatus !== "pass") {
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

await main();
