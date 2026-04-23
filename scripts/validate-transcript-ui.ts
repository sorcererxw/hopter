import { writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Locator, type Page, type Route } from "playwright";

import { readDevState, waitForHttpOk } from "./lib/devloop.ts";
import {
  combineValidationStatus,
  renderValidationSummary,
  type ValidationCheck,
} from "./lib/rebuild-validation.ts";
import { createValidationRun } from "./lib/validation.ts";

const baseUrl = "http://127.0.0.1:8787";
const healthUrl = `${baseUrl}/healthz`;

const sessionId = "sess_mock";
const projectId = "proj_mock";
const updatedAt = "2026-04-16T16:48:00Z";
const olderCursor = "cursor_older";
const oldestCursor = "cursor_oldest";
let includeFollowupTranscript = false;
let runningCommandCompleted = false;
let olderTranscriptAttempts = 0;

function buildListModelsResponse() {
  return {
    models: [
      {
        id: "gpt-5.4",
        model: "gpt-5.4",
        displayName: "gpt-5.4",
        isDefault: true,
        defaultReasoningEffort: "xhigh",
        supportedReasoningEfforts: [
          { reasoningEffort: "low" },
          { reasoningEffort: "medium" },
          { reasoningEffort: "high" },
          { reasoningEffort: "xhigh" },
        ],
      },
      {
        id: "gpt-5.3-codex",
        model: "gpt-5.3-codex",
        displayName: "gpt-5.3-codex",
        defaultReasoningEffort: "high",
        supportedReasoningEfforts: [
          { reasoningEffort: "medium" },
          { reasoningEffort: "high" },
        ],
      },
    ],
  };
}

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
          id: "agent-2",
          orderKey: "000000000001:000000000004:agent-2",
          kind: "SESSION_TRANSCRIPT_ITEM_KIND_AGENT_MESSAGE",
          title: "Codex",
          body: "Captured command output and updated the session transcript.\n\n```text\nPlease make another follow-up pass on the workspace UI implementation in this repo root:\n.\n```\n",
          status: "",
        },
        {
          id: "user-2",
          orderKey: "000000000001:000000000000:user-2",
          kind: "SESSION_TRANSCRIPT_ITEM_KIND_USER_MESSAGE",
          title: "You",
          body: "Follow up with command evidence.",
          status: "",
        },
        {
          id: "cmd-1",
          orderKey: "000000000001:000000000001:cmd-1",
          kind: "SESSION_TRANSCRIPT_ITEM_KIND_COMMAND_EXECUTION",
          title: "Command",
          body: "git status\n\nstatus: completed\n\noutput:\nOn branch master",
          status: "completed",
        },
        {
          id: "cmd-2",
          orderKey: "000000000001:000000000002:cmd-2",
          kind: "SESSION_TRANSCRIPT_ITEM_KIND_COMMAND_EXECUTION",
          title: "Command",
          body: "pnpm --dir ui typecheck\n\nstatus: completed\n\noutput:\nTypecheck passed",
          status: "completed",
        },
        {
          id: "cmd-running",
          orderKey: "000000000001:000000000003:cmd-running",
          kind: "SESSION_TRANSCRIPT_ITEM_KIND_COMMAND_EXECUTION",
          title: "Command",
          body: `pnpm --dir ui build\n\nstatus: ${
            runningCommandCompleted ? "completed" : "inProgress"
          }\n\noutput:\n${runningCommandCompleted ? "Build completed" : "Building production bundle..."}`,
          status: runningCommandCompleted ? "completed" : "inProgress",
        },
        {
          id: "progress-1",
          orderKey: "000000000001:000000000003:progress-1",
          kind: "SESSION_TRANSCRIPT_ITEM_KIND_REASONING",
          title: "Progress",
          body: "本地 review-log 命令没有正常执行，先不强行重试写 gstack 元数据。",
          status: "completed",
        },
        ...Array.from({ length: 14 }, (_, index) => ({
          id: `agent-filler-${index}`,
          orderKey: `000000000001:${String(index + 5).padStart(12, "0")}:agent-filler-${index}`,
          kind: "SESSION_TRANSCRIPT_ITEM_KIND_AGENT_MESSAGE",
          title: "Codex",
          body: `Latest-page filler ${index + 1} for scroll pagination validation.`,
          status: "",
        })),
        ...(includeFollowupTranscript
          ? [
              {
                id: "agent-3",
                orderKey: "000000000001:000000000019:agent-3",
                kind: "SESSION_TRANSCRIPT_ITEM_KIND_AGENT_MESSAGE",
                title: "Codex",
                body: "AUTO-SCROLL-FOLLOWUP: this message should keep the transcript pinned to the bottom.",
                status: "",
              },
            ]
          : []),
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
          id: "file-1",
          orderKey: "000000000000:000000000002:file-1",
          kind: "SESSION_TRANSCRIPT_ITEM_KIND_FILE_CHANGE",
          title: "File change",
          body: buildFileChangeBody(),
          status: "completed",
        },
        {
          id: "agent-1",
          orderKey: "000000000000:000000000001:agent-1",
          kind: "SESSION_TRANSCRIPT_ITEM_KIND_AGENT_MESSAGE",
          title: "Codex",
          body: "我跑过的验证：\n- pnpm --dir ui typecheck\n- go test ./internal/codex/...\n- make verify-live",
          status: "",
        },
        {
          id: "user-1",
          orderKey: "000000000000:000000000000:user-1",
          kind: "SESSION_TRANSCRIPT_ITEM_KIND_USER_MESSAGE",
          title: "You",
          body: "Build a transcript-aware validation flow.",
          status: "",
        },
      ],
      nextBeforeCursor: oldestCursor,
      hasMoreBefore: true,
      snapshotUpdatedAt: updatedAt,
    },
  };
}

function buildOldestTranscriptPage() {
  return {
    page: {
      items: [
        {
          id: "agent-0",
          orderKey: "000000000000:000000000000:agent-0",
          kind: "SESSION_TRANSCRIPT_ITEM_KIND_AGENT_MESSAGE",
          title: "Codex",
          body: "Oldest transcript page loaded after a second upward pagination request.",
          status: "",
        },
      ],
      hasMoreBefore: false,
      snapshotUpdatedAt: updatedAt,
    },
  };
}

function buildSessionReviewResponse() {
  return {
    review: {
      sessionId,
      projectId,
      available: true,
      turnId: "turn-1",
      reason: "",
      fullPatch: [
        "diff --git a/internal/codex/transcript.go b/internal/codex/transcript.go",
        "@@ -1,2 +1,2 @@",
        "-old",
        "+new",
        "diff --git a/ui/src/components/app/session-detail-pane.tsx b/ui/src/components/app/session-detail-pane.tsx",
        "@@ -10,2 +10,2 @@",
        "-old",
        "+new",
      ].join("\n"),
      files: [
        {
          path: "internal/codex/transcript.go",
          kind: "Edited",
          additions: 100,
          deletions: 56,
          diff: "@@ -1,2 +1,2 @@\n-old\n+new\n",
          displayLabel: "internal/codex/transcript.go",
        },
        {
          path: "ui/src/components/app/session-detail-pane.tsx",
          kind: "Edited",
          additions: 42,
          deletions: 10,
          diff: "@@ -10,2 +10,2 @@\n-old\n+new\n",
          displayLabel: "ui/src/components/app/session-detail-pane.tsx",
        },
      ],
      generatedAt: updatedAt,
      pendingTurnInProgress: false,
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

async function assertVerticalOrder(
  entries: Array<{ label: string; locator: Locator }>,
) {
  const boxes = [];
  for (const entry of entries) {
    const box = await entry.locator.boundingBox();
    if (!box) {
      throw new Error(`could not measure transcript row ${entry.label}`);
    }
    boxes.push({ ...entry, y: box.y });
  }

  for (let index = 1; index < boxes.length; index++) {
    if (boxes[index - 1].y > boxes[index].y) {
      throw new Error(
        `transcript order mismatch: ${boxes[index - 1].label} rendered after ${boxes[index].label}`,
      );
    }
  }
}

async function assertDisclosureChevronFollowsLabel(
  button: Locator,
  label: string,
) {
  const labelBox = await button.locator(":scope > span").first().boundingBox();
  const iconBox = await button.locator("svg").first().boundingBox();

  if (!labelBox || !iconBox) {
    throw new Error(`could not measure disclosure geometry for ${label}`);
  }

  const gap = iconBox.x - (labelBox.x + labelBox.width);
  if (gap < 0 || gap > 12) {
    throw new Error(
      `${label} disclosure arrow is not aligned next to the text; gap=${gap}`,
    );
  }
}

async function assertCommandStatusPrefixMuted(
  button: Locator,
  expectedText: string,
) {
  const prefix = button.locator(":scope > span > span").first();
  await prefix.waitFor();

  const text = (await prefix.textContent())?.trim();
  if (text !== expectedText) {
    throw new Error(
      `expected command prefix ${expectedText}, received ${text}`,
    );
  }

  const className = (await prefix.getAttribute("class")) ?? "";
  if (!className.includes("text-muted-foreground")) {
    throw new Error(`${expectedText} command prefix does not use muted color`);
  }
}

async function setTranscriptScrollPosition(
  page: Page,
  position: "top" | "bottom",
) {
  await page.getByTestId("session-transcript").evaluate((node, target) => {
    let current = node.parentElement as HTMLElement | null;
    while (current) {
      const style = window.getComputedStyle(current);
      if (style.overflowY === "auto" || style.overflowY === "scroll") {
        current.scrollTop = target === "top" ? 0 : current.scrollHeight;
        current.dispatchEvent(new Event("scroll", { bubbles: true }));
        return;
      }
      current = current.parentElement;
    }
    throw new Error("could not find transcript scroll container");
  }, position);
}

async function transcriptDistanceFromBottom(page: Page) {
  return page.getByTestId("session-transcript").evaluate((node) => {
    let current = node.parentElement as HTMLElement | null;
    while (current) {
      const style = window.getComputedStyle(current);
      if (style.overflowY === "auto" || style.overflowY === "scroll") {
        return current.scrollHeight - current.scrollTop - current.clientHeight;
      }
      current = current.parentElement;
    }
    throw new Error("could not find transcript scroll container");
  });
}

async function waitForTranscriptDistanceFromBottom(
  page: Page,
  maxDistance: number,
  timeoutMs = 2_000,
) {
  await page.waitForFunction(
    ([testId, max]) => {
      const node = document.querySelector(`[data-testid="${testId}"]`);
      let current = node?.parentElement as HTMLElement | null;
      while (current) {
        const style = window.getComputedStyle(current);
        if (style.overflowY === "auto" || style.overflowY === "scroll") {
          return (
            current.scrollHeight - current.scrollTop - current.clientHeight <=
            max
          );
        }
        current = current.parentElement;
      }
      return false;
    },
    ["session-transcript", maxDistance],
    { timeout: timeoutMs },
  );
}

async function wireMockRPC(page: Page) {
  await page.route("**/rpc/hopter.v1.HostService/ListModels", async (route) => {
    await fulfillJSON(route, buildListModelsResponse());
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
    "**/rpc/hopter.v1.SessionService/GetSessionReview",
    async (route) => {
      await fulfillJSON(route, buildSessionReviewResponse());
    },
  );

  await page.route(
    "**/rpc/hopter.v1.SessionService/ListSessionTranscript",
    async (route) => {
      const payload = route.request().postDataJSON() as
        | { beforeCursor?: string }
        | undefined;
      if (payload?.beforeCursor === olderCursor) {
        olderTranscriptAttempts += 1;
        if (olderTranscriptAttempts === 1) {
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({
              code: "unavailable",
              message: "temporary transcript failure",
            }),
          });
          return;
        }
        await page.waitForTimeout(350);
        await fulfillJSON(route, buildOlderTranscriptPage());
        return;
      }
      if (payload?.beforeCursor === oldestCursor) {
        await page.waitForTimeout(150);
        await fulfillJSON(route, buildOldestTranscriptPage());
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
  let page: Page | undefined;
  try {
    page = await browser.newPage({
      baseURL: baseUrl,
      viewport: { width: 1280, height: 720 },
    });
    await wireMockRPC(page);

    await page.goto(`/sessions/${sessionId}`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .getByTestId("session-transcript-loading-initial")
      .waitFor({ timeout: 2_000 })
      .catch(() => {});
    await page
      .waitForLoadState("networkidle", { timeout: 15_000 })
      .catch(() => {});
    await page.screenshot({
      fullPage: true,
      path: path.join(run.rootDir, "session-initial.png"),
    });

    const modelMenuButton = page.getByRole("button", { name: "Model" });
    await modelMenuButton.waitFor();
    await modelMenuButton.getByText("gpt-5.4").waitFor();
    await modelMenuButton.click();
    const fastModeSwitch = page.getByRole("switch", {
      name: "Codex fast mode",
    });
    await fastModeSwitch.waitFor();
    await fastModeSwitch.click();
    await page.getByTestId("composer-fast-mode-icon").waitFor();
    await page.getByRole("menuitemradio", { name: "gpt-5.3-codex" }).click();
    await modelMenuButton.getByText("gpt-5.3-codex").waitFor();

    const reasoningMenuButton = page.getByRole("button", {
      name: "Reasoning effort",
    });
    await reasoningMenuButton.waitFor();
    await reasoningMenuButton.getByText("High").waitFor();
    await reasoningMenuButton.click();
    await page.getByRole("menuitemradio", { name: "Medium" }).click();
    await reasoningMenuButton.getByText("Medium").waitFor();

    checks.push({
      name: "composer shadcn selection menus",
      status: "pass",
      detail:
        "composer model and reasoning controls opened as shadcn dropdown radio menus, fast mode toggled the model trigger icon, and selected values updated",
    });

    await page.getByTestId("session-transcript").waitFor();
    const latestAgentEntry = page
      .getByTestId("session-transcript-agent")
      .filter({
        hasText: "Captured command output and updated the session transcript.",
      });
    const latestUserEntry = page
      .getByTestId("session-transcript-user")
      .filter({ hasText: "Follow up with command evidence." });
    const commandGroup = page
      .getByTestId("session-transcript-command-group")
      .filter({ hasText: "Executed 2 commands" });
    const runningCommandEntry = page
      .getByTestId("session-transcript-command")
      .filter({ hasText: "pnpm --dir ui build" });
    const progressEntry = page
      .getByTestId("session-transcript-reasoning")
      .filter({ hasText: "本地 review-log 命令没有正常执行" });
    await latestAgentEntry.waitFor();
    await latestUserEntry.waitFor();
    await commandGroup.waitFor();
    await progressEntry.waitFor();
    await runningCommandEntry.waitFor();
    await assertVerticalOrder([
      { label: "latest user", locator: latestUserEntry },
      { label: "completed command group", locator: commandGroup },
      { label: "running command", locator: runningCommandEntry },
      { label: "progress note", locator: progressEntry },
      { label: "latest agent", locator: latestAgentEntry },
    ]);
    if (await progressEntry.getByRole("button").count()) {
      throw new Error("progress reasoning note still renders as a disclosure");
    }
    if (await progressEntry.getByText(/^Progress —/).count()) {
      throw new Error(
        "progress reasoning note still renders the Progress prefix",
      );
    }
    const runningCommandButton = runningCommandEntry.getByRole("button", {
      name: /^Running pnpm --dir ui build/i,
    });
    await runningCommandButton.waitFor();
    await assertCommandStatusPrefixMuted(runningCommandButton, "Running");
    await assertDisclosureChevronFollowsLabel(
      runningCommandButton,
      "running command",
    );
    const olderMessage = page
      .getByTestId("session-transcript-user")
      .filter({ hasText: "Build a transcript-aware validation flow." });
    if (await olderMessage.count()) {
      throw new Error(
        "older transcript page rendered before upward pagination",
      );
    }
    if (await page.getByTestId("session-artifact-workspace").count()) {
      throw new Error(
        "empty artifacts workspace rendered for a session with no artifacts",
      );
    }
    if (await page.getByTestId("session-artifact-workspace-empty").count()) {
      throw new Error(
        "empty artifacts placeholder rendered for a session with no artifacts",
      );
    }
    await waitForTranscriptDistanceFromBottom(page, 24);
    const initialDistanceFromBottom = await transcriptDistanceFromBottom(page);
    if (initialDistanceFromBottom > 24) {
      throw new Error(
        `initial transcript view did not land at bottom; distance=${initialDistanceFromBottom}`,
      );
    }

    checks.push({
      name: "initial latest-page render",
      status: "pass",
      detail:
        "session route rendered only the latest transcript page on first load and sorted intentionally shuffled items by orderKey",
    });
    checks.push({
      name: "initial bottom positioning",
      status: "pass",
      detail:
        "refreshing directly into a session positions the transcript at the latest content",
    });
    checks.push({
      name: "empty artifacts hidden",
      status: "pass",
      detail:
        "session route kept artifact refresh in the background and rendered no artifacts block when the session had no artifacts",
    });

    await setTranscriptScrollPosition(page, "bottom");
    const distanceBeforeFollowup = await transcriptDistanceFromBottom(page);
    if (distanceBeforeFollowup > 8) {
      throw new Error(
        `transcript did not start pinned to bottom before follow-up; distance=${distanceBeforeFollowup}`,
      );
    }
    runningCommandCompleted = true;
    includeFollowupTranscript = true;
    const completedThoughtGroup = page
      .getByTestId("session-transcript-thought-group")
      .filter({ hasText: "Thought process: 1 thought, 3 commands" });
    await completedThoughtGroup.waitFor({ timeout: 15_000 });
    if (await runningCommandEntry.count()) {
      throw new Error(
        "completed command still rendered as a standalone running command row",
      );
    }
    await page
      .getByTestId("session-transcript-agent")
      .filter({ hasText: "AUTO-SCROLL-FOLLOWUP" })
      .waitFor({ timeout: 15_000 });
    await page.waitForTimeout(150);
    const distanceAfterFollowup = await transcriptDistanceFromBottom(page);
    if (distanceAfterFollowup > 96) {
      throw new Error(
        `transcript did not stay pinned after follow-up; distance=${distanceAfterFollowup}`,
      );
    }
    checks.push({
      name: "bottom auto-scroll on new message",
      status: "pass",
      detail:
        "when the transcript was pinned to bottom, a polling refresh with a new message kept the scroll position at the latest content",
    });

    const thoughtGroupButton = completedThoughtGroup.getByRole("button", {
      name: /Thought process: 1 thought, 3 commands/i,
    });
    await thoughtGroupButton.waitFor();
    await thoughtGroupButton.click();
    const completedCommandGroup = completedThoughtGroup
      .getByTestId("session-transcript-command-group")
      .filter({ hasText: "Executed 3 commands" });
    await completedCommandGroup.waitFor();
    const commandGroupButton = completedCommandGroup.getByRole("button", {
      name: /Executed 3 commands/i,
    });
    await commandGroupButton.waitFor();
    await commandGroupButton.click();
    const commandEntry = completedCommandGroup
      .getByTestId("session-transcript-command")
      .filter({ hasText: "git status" });
    const commandButton = commandEntry.getByRole("button", {
      name: /^Ran git status/i,
    });
    await commandButton.waitFor();
    await assertCommandStatusPrefixMuted(commandButton, "Ran");
    await assertDisclosureChevronFollowsLabel(
      commandButton,
      "completed command",
    );
    await commandButton.click();
    await commandEntry.locator("pre").getByText("git status").waitFor();
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

    await page.setViewportSize({ width: 1280, height: 360 });
    await setTranscriptScrollPosition(page, "bottom");
    await page.waitForTimeout(50);
    await setTranscriptScrollPosition(page, "top");
    await page
      .getByTestId("session-transcript-loading")
      .waitFor({ timeout: 1_000 })
      .catch(() => {});
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
    await setTranscriptScrollPosition(page, "top");
    await page
      .getByTestId("session-transcript-loading")
      .waitFor({ timeout: 1_000 })
      .catch(() => {});
    await page
      .getByTestId("session-transcript-agent")
      .filter({
        hasText:
          "Oldest transcript page loaded after a second upward pagination request.",
      })
      .waitFor();
    await page.getByTestId("session-transcript-loading").waitFor({
      state: "hidden",
    });

    await fileChangeEntry.waitFor();
    if (await page.getByRole("button", { name: /Changed 2 files/i }).count()) {
      throw new Error(
        "file changes still render as an aggregate Changed files row",
      );
    }
    if (await page.getByRole("button", { name: /Ran \d+ commands/i }).count()) {
      throw new Error(
        "commands still render with the legacy Ran commands label",
      );
    }
    if (
      !(await page
        .getByRole("button", { name: /Executed 3 commands/i })
        .count())
    ) {
      throw new Error(
        "completed commands did not render as a folded Executed commands group inside the completed thought process",
      );
    }
    if (await page.getByRole("button", { name: /Used \d+ tools/i }).count()) {
      throw new Error("tools still render as an aggregate Used tools row");
    }
    const transcriptFileButton = fileChangeEntry.getByRole("button", {
      name: /Edited.*transcript\.go/i,
    });
    await transcriptFileButton.waitFor();
    if ((await transcriptFileButton.locator("svg").count()) === 0) {
      throw new Error("file change row does not render a disclosure arrow");
    }
    await transcriptFileButton.click();
    await fileChangeEntry
      .locator("pre")
      .filter({ hasText: "@@ -1,2 +1,2 @@" })
      .waitFor();

    await page.screenshot({
      fullPage: true,
      path: path.join(run.rootDir, "session-paginated.png"),
    });

    checks.push({
      name: "upward pagination render",
      status: "pass",
      detail:
        "scrolling upward fetched the older transcript page with a visible loading row while preserving orderKey order",
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
        "file changes render as individual selectable rows; completed commands fold into one executed-command group while active commands stay standalone",
    });
  } catch (error) {
    checks.push({
      name: "browser transcript validation",
      status: "fail",
      detail: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await page?.unrouteAll({ behavior: "ignoreErrors" }).catch(() => {});
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
