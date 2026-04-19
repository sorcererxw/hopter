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
  process.env.HOPTER_LIVE_BASE_URL?.trim() || "http://127.0.0.1:8787";
const healthUrl =
  process.env.HOPTER_GO_HEALTH_URL?.trim() || `${baseUrl}/healthz`;

const sessionId = "sess_mock";
const projectId = "proj_mock";
const updatedAt = "2026-04-16T16:48:00Z";
const olderCursor = "cursor_older";

function buildFileChangeBody() {
  return JSON.stringify({
    version: 1,
    changes: [
      {
        path: "internal/codex/transcript.go",
        kind: "updated",
        additions: 100,
        deletions: 56,
        diff: "@@ -1,2 +1,2 @@\n-old\n+new\n",
      },
      {
        path: "ui/src/components/app/session-detail-pane.tsx",
        kind: "updated",
        additions: 42,
        deletions: 10,
        diff: "@@ -10,2 +10,2 @@\n-old\n+new\n",
      },
    ],
  });
}

function buildSessionMetaResponse() {
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
      summary: "Captured command output and updated the session transcript.",
      attentionRequired: false,
      attentionReason: "",
      lastInputHint: "Follow up with command evidence.",
      updatedAt,
      artifacts: [],
      backendKey: "codex",
      hasMoreBefore: true,
      latestPageSizeHint: 3,
    },
  };
}

function buildLatestTranscriptPage() {
  return {
    page: {
      items: [
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
          body:
            "Captured command output and updated the session transcript.\n\n```text\nPlease make another follow-up pass on the workspace UI implementation in this repo root:\n.\n```\n",
          status: "",
        },
      ],
      nextBeforeCursor: olderCursor,
      hasMoreBefore: true,
      snapshotUpdatedAt: updatedAt,
    },
  };
}

function buildOlderTranscriptPage() {
  return {
    page: {
      items: [
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
          body:
            "我跑过的验证：\n- pnpm --dir ui typecheck\n- go test ./internal/codex/...\n- make verify-live",
          status: "",
        },
        {
          id: "file-1",
          kind: "SESSION_TRANSCRIPT_ITEM_KIND_FILE_CHANGE",
          title: "File change",
          body: buildFileChangeBody(),
          status: "completed",
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
      const payload = route.request().postDataJSON() as
        | { beforeCursor?: string }
        | undefined;
      if (payload?.beforeCursor === olderCursor) {
        await page.waitForTimeout(350);
        await fulfillJSON(route, buildOlderTranscriptPage());
        return;
      }
      await page.waitForTimeout(250);
      await fulfillJSON(route, buildLatestTranscriptPage());
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
  const run = createValidationRun("transcript_ui");
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
      renderValidationSummary("Transcript UI validation", checks),
    );
    writeFileSync(
      path.resolve(
        process.cwd(),
        "storage/artifacts/validation/latest-transcript-ui.txt",
      ),
      `${run.rootDir}\n`,
    );
    console.log(`Transcript UI validation evidence: ${run.rootDir}`);
    process.exitCode = 1;
    return;
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      baseURL: baseUrl,
      viewport: { width: 1280, height: 720 },
    });
    await wireMockRPC(page);

    await page.goto(`/sessions/${sessionId}`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByTestId("session-transcript-loading-initial").waitFor();
    await page
      .waitForLoadState("networkidle", { timeout: 15_000 })
      .catch(() => {});
    await page.screenshot({
      fullPage: true,
      path: path.join(run.rootDir, "session-initial.png"),
    });

    await page.getByTestId("session-transcript").waitFor();
    await page
      .getByTestId("session-transcript-agent")
      .filter({
        hasText: "Captured command output and updated the session transcript.",
      })
      .waitFor();
    await page
      .getByTestId("session-transcript-user")
      .filter({ hasText: "Follow up with command evidence." })
      .waitFor();
    const olderMessage = page
      .getByTestId("session-transcript-user")
      .filter({ hasText: "Build a transcript-aware validation flow." });
    if (await olderMessage.count()) {
      throw new Error("older transcript page rendered before upward pagination");
    }

    checks.push({
      name: "initial latest-page render",
      status: "pass",
      detail:
        "session route rendered only the latest transcript page on first load",
    });

    const commandEntry = page.getByTestId("session-transcript-command");
    await commandEntry.waitFor();
    await page.getByRole("button", { name: /Command/i }).click();
    await commandEntry.getByText("git status").waitFor();
    if ((await commandEntry.locator(".rounded-full").count()) > 0) {
      throw new Error(
        "command transcript row still renders a left-side avatar bubble",
      );
    }

    const fileChangeEntry = page.getByTestId("session-transcript-file-change");
    const codeBlock = page
      .locator("pre")
      .filter({
        hasText:
          "Please make another follow-up pass on the workspace UI implementation in this repo root:",
      })
      .first();
    await codeBlock.waitFor();
    await codeBlock
      .getByText(
        "Please make another follow-up pass on the workspace UI implementation in this repo root:",
      )
      .waitFor();
    await page.getByTestId("session-code-copy").waitFor();

    await page.getByTestId("session-transcript").evaluate((node) => {
      let current = node.parentElement as HTMLElement | null;
      while (current) {
        const style = window.getComputedStyle(current);
        if (style.overflowY === "auto" || style.overflowY === "scroll") {
          current.scrollTop = 0;
          current.dispatchEvent(new Event("scroll", { bubbles: true }));
          return;
        }
        current = current.parentElement;
      }
      throw new Error("could not find transcript scroll container");
    });
    await page.getByTestId("session-transcript-loading").waitFor();
    await olderMessage.waitFor();
    await page
      .getByTestId("session-transcript-agent")
      .filter({ hasText: "我跑过的验证：" })
      .waitFor();
    await page
      .locator("li")
      .filter({ hasText: "pnpm --dir ui typecheck" })
      .waitFor();
    await page
      .locator("li")
      .filter({ hasText: "go test ./internal/codex/..." })
      .waitFor();
    await page.locator("li").filter({ hasText: "make verify-live" }).waitFor();
    await page.getByTestId("session-transcript-loading").waitFor({
      state: "hidden",
    });

    await fileChangeEntry.waitFor();
    await fileChangeEntry
      .getByRole("button", { name: /Changed 2 files/i })
      .click();
    const transcriptFileButton = fileChangeEntry.getByRole("button", {
      name: /Edited.*internal\/codex\/transcript\.go/i,
    });
    await transcriptFileButton.waitFor();
    await transcriptFileButton.click();
    await page.getByText("internal/codex/transcript.go").last().waitFor();
    await page.getByText("Edited  +100 -56").waitFor();

    await page.screenshot({
      fullPage: true,
      path: path.join(run.rootDir, "session-paginated.png"),
    });

    checks.push({
      name: "upward pagination render",
      status: "pass",
      detail:
        "scrolling upward fetched the older transcript page with a visible loading row",
    });
    checks.push({
      name: "fenced code block render",
      status: "pass",
      detail:
        "agent markdown fence rendered as a local preformatted code block with a copy action",
    });
    checks.push({
      name: "file change and command presentation",
      status: "pass",
      detail:
        "file changes render as a changed-files summary with selectable entries and command rows render without left avatar bubbles",
    });
  } catch (error) {
    checks.push({
      name: "browser transcript validation",
      status: "fail",
      detail: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await browser.close();
  }

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
    renderValidationSummary("Transcript UI validation", checks, [
      "This lane validates transcript rendering in the browser with mocked Connect RPC responses.",
    ]),
  );
  writeFileSync(
    path.resolve(
      process.cwd(),
      "storage/artifacts/validation/latest-transcript-ui.txt",
    ),
    `${run.rootDir}\n`,
  );
  console.log(`Transcript UI validation evidence: ${run.rootDir}`);

  if (overallStatus !== "pass") {
    process.exitCode = 1;
  }
}

await main();
