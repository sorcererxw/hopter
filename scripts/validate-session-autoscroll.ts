import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Page, type Route } from "playwright";

import { readDevState, waitForHttpOk } from "./lib/devloop.ts";
import {
  combineValidationStatus,
  renderValidationSummary,
  type ValidationCheck,
} from "./lib/rebuild-validation.ts";
import { createValidationRun } from "./lib/validation.ts";

const BASE_URL = "http://127.0.0.1:8787";
const HEALTH_URL = `${BASE_URL}/healthz`;
const SESSION_ID = "sess_autoscroll";
const PROJECT_ID = "proj_autoscroll";
const UPDATED_AT = "2026-04-22T09:00:00Z";

type ScrollMetrics = {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
  distanceFromBottom: number;
};

async function waitForReady(timeoutMs = 45_000) {
  const started = Date.now();
  let lastState = readDevState();

  while (Date.now() - started < timeoutMs) {
    lastState = readDevState();
    if (lastState?.status === "ready") {
      const health = await waitForHttpOk(HEALTH_URL, 2_500, 125);
      if (health.ok) {
        return { health, state: lastState };
      }
    }

    if (lastState?.status === "build_failed") {
      return {
        health: { error: lastState.lastError || "build failed", ok: false },
        state: lastState,
      };
    }

    await Bun.sleep(250);
  }

  return {
    health: { error: "timed out waiting for dev state ready", ok: false },
    state: lastState,
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
      await fulfillJSON(route, {
        projects: [
          {
            id: PROJECT_ID,
            name: "autoscroll-project",
            rootPath: "/tmp/autoscroll-project",
            defaultBackend: "codex",
            createdAt: UPDATED_AT,
            updatedAt: UPDATED_AT,
          },
        ],
      });
    },
  );

  await page.route(
    "**/rpc/hopter.v1.SessionService/ListSessions",
    async (route) => {
      await fulfillJSON(route, {
        sessions: [
          {
            id: SESSION_ID,
            title: "Auto-scroll Probe",
            project: {
              id: PROJECT_ID,
              name: "autoscroll-project",
              rootPath: "/tmp/autoscroll-project",
            },
            status: "SESSION_STATUS_RUNNING",
            attentionRequired: false,
            updatedAt: UPDATED_AT,
          },
        ],
      });
    },
  );

  await page.route(
    "**/rpc/hopter.v1.SessionService/GetSessionMeta",
    async (route) => {
      await fulfillJSON(route, {
        session: {
          id: SESSION_ID,
          title: "Auto-scroll Probe",
          project: {
            id: PROJECT_ID,
            name: "autoscroll-project",
            rootPath: "/tmp/autoscroll-project",
          },
          status: "SESSION_STATUS_RUNNING",
          summary: "Streaming a long assistant draft.",
          attentionRequired: false,
          attentionReason: "",
          lastInputHint: "Generate a long streamed answer.",
          updatedAt: UPDATED_AT,
          artifacts: [],
          backendKey: "codex",
          hasMoreBefore: false,
          latestPageSizeHint: 50,
        },
      });
    },
  );

  await page.route(
    "**/rpc/hopter.v1.SessionService/GetSessionReview",
    async (route) => {
      await fulfillJSON(route, {
        review: {
          sessionId: SESSION_ID,
          projectId: PROJECT_ID,
          available: false,
          reason: "not available in auto-scroll validation",
          files: [],
          fullPatch: "",
          pendingTurnInProgress: true,
          turnId: "",
          generatedAt: UPDATED_AT,
        },
      });
    },
  );

  await page.route(
    "**/rpc/hopter.v1.SessionService/ListSessionTranscript",
    async (route) => {
      await fulfillJSON(route, buildTranscriptPage());
    },
  );
}

function buildTranscriptPage() {
  return {
    page: {
      items: [
        {
          id: "user-1",
          orderKey: "000000000000:000000000000:user-1",
          kind: "SESSION_TRANSCRIPT_ITEM_KIND_USER_MESSAGE",
          title: "You",
          body: "Generate a long streamed answer.",
          displayBody: "Generate a long streamed answer.",
          status: "",
        },
        ...Array.from({ length: 28 }, (_, index) => ({
          id: `agent-filler-${index}`,
          orderKey: `000000000000:${String(index + 1).padStart(12, "0")}:agent-filler-${index}`,
          kind: "SESSION_TRANSCRIPT_ITEM_KIND_AGENT_MESSAGE",
          title: "Codex",
          body: `Baseline transcript row ${index + 1}. This filler makes the transcript scrollable before live streaming begins.`,
          displayBody: `Baseline transcript row ${index + 1}. This filler makes the transcript scrollable before live streaming begins.`,
          status: "",
        })),
      ],
      hasMoreBefore: false,
      nextBeforeCursor: "",
      snapshotUpdatedAt: UPDATED_AT,
    },
  };
}

async function installMockEventSource(page: Page) {
  await page.addInitScript(() => {
    type Listener = (event: MessageEvent<string>) => void;

    class MockEventSource {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSED = 2;

      onerror: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent<string>) => void) | null = null;
      onopen: ((event: Event) => void) | null = null;
      readyState = MockEventSource.CONNECTING;
      url: string;
      withCredentials = false;
      private listeners = new Map<string, Set<Listener>>();

      constructor(url: string, init?: EventSourceInit) {
        this.url = url;
        this.withCredentials = Boolean(init?.withCredentials);
        (
          window as typeof window & {
            __hopterMockEventSource?: MockEventSource;
          }
        ).__hopterMockEventSource = this;
        window.setTimeout(() => {
          this.readyState = MockEventSource.OPEN;
          this.onopen?.(new Event("open"));
        }, 0);
      }

      addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        const listeners = this.listeners.get(type) ?? new Set<Listener>();
        listeners.add(listener as Listener);
        this.listeners.set(type, listeners);
      }

      removeEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject,
      ) {
        this.listeners.get(type)?.delete(listener as Listener);
      }

      close() {
        this.readyState = MockEventSource.CLOSED;
      }

      emit(type: string, payload: unknown) {
        const event = new MessageEvent<string>(type, {
          data: JSON.stringify(payload),
        });
        if (type === "message") {
          this.onmessage?.(event);
        }
        for (const listener of this.listeners.get(type) ?? []) {
          listener(event);
        }
      }
    }

    (
      window as typeof window & {
        EventSource: typeof EventSource;
        __hopterEmitWorkspace?: (payload: unknown) => void;
      }
    ).EventSource = MockEventSource as unknown as typeof EventSource;
    (
      window as typeof window & {
        __hopterEmitWorkspace?: (payload: unknown) => void;
        __hopterMockEventSource?: MockEventSource;
      }
    ).__hopterEmitWorkspace = (payload: unknown) => {
      window.__hopterMockEventSource?.emit("workspace", payload);
    };
  });
}

async function scrollToTranscriptBottom(page: Page) {
  await page.getByTestId("session-transcript").evaluate((node) => {
    const findScrollContainer = (target: Element) => {
      let current = target.parentElement as HTMLElement | null;
      while (current) {
        const style = window.getComputedStyle(current);
        if (style.overflowY === "auto" || style.overflowY === "scroll") {
          return current;
        }
        current = current.parentElement;
      }
      throw new Error("could not find transcript scroll container");
    };
    const container = findScrollContainer(node);
    container.scrollTop = container.scrollHeight;
    container.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
}

async function scrollToTranscriptTop(page: Page) {
  await page.getByTestId("session-transcript").evaluate((node) => {
    const findScrollContainer = (target: Element) => {
      let current = target.parentElement as HTMLElement | null;
      while (current) {
        const style = window.getComputedStyle(current);
        if (style.overflowY === "auto" || style.overflowY === "scroll") {
          return current;
        }
        current = current.parentElement;
      }
      throw new Error("could not find transcript scroll container");
    };
    const container = findScrollContainer(node);
    container.scrollTop = 0;
    container.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
}

async function transcriptMetrics(page: Page): Promise<ScrollMetrics> {
  return page.getByTestId("session-transcript").evaluate((node) => {
    const findScrollContainer = (target: Element) => {
      let current = target.parentElement as HTMLElement | null;
      while (current) {
        const style = window.getComputedStyle(current);
        if (style.overflowY === "auto" || style.overflowY === "scroll") {
          return current;
        }
        current = current.parentElement;
      }
      throw new Error("could not find transcript scroll container");
    };
    const container = findScrollContainer(node);
    return {
      clientHeight: container.clientHeight,
      scrollHeight: container.scrollHeight,
      scrollTop: container.scrollTop,
      distanceFromBottom:
        container.scrollHeight - container.scrollTop - container.clientHeight,
    };
  });
}

async function waitForTranscriptDistance(page: Page, maxDistance: number) {
  await page.waitForFunction(
    ([testId, max]) => {
      const node = document.querySelector(`[data-testid="${testId}"]`);
      if (!node) {
        return false;
      }
      const findScrollContainer = (target: Element) => {
        let current = target.parentElement as HTMLElement | null;
        while (current) {
          const style = window.getComputedStyle(current);
          if (style.overflowY === "auto" || style.overflowY === "scroll") {
            return current;
          }
          current = current.parentElement;
        }
        throw new Error("could not find transcript scroll container");
      };
      const container = findScrollContainer(node);
      return (
        container.scrollHeight - container.scrollTop - container.clientHeight <=
        max
      );
    },
    ["session-transcript", maxDistance],
    { timeout: 2_000 },
  );
}

async function emitDraftDelta(page: Page, delta: string) {
  await page.evaluate(
    ({ sessionId, draftDelta }) => {
      (
        window as typeof window & {
          __hopterEmitWorkspace?: (payload: unknown) => void;
        }
      ).__hopterEmitWorkspace?.({
        payload: {
          sessionLivePatch: {
            draftDelta,
            draftItemId: "draft-autoscroll",
            kind: "SESSION_LIVE_PATCH_KIND_DRAFT_DELTA",
          },
        },
        sessionId,
        type: "WORKSPACE_EVENT_TYPE_SESSION_CHANGED",
      });
    },
    { draftDelta: delta, sessionId: SESSION_ID },
  );
}

function draftDelta(start: number, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const line = start + index;
    return `AUTO-SCROLL-STREAM-LINE-${String(line).padStart(3, "0")}: streamed content should keep the transcript pinned while the user is already at the latest message.\n\n`;
  }).join("");
}

async function isScrollToLatestVisible(page: Page) {
  return page
    .locator('button[aria-label="Scroll to latest message"]')
    .evaluate((node) => {
      const style = window.getComputedStyle(node);
      return (
        style.opacity !== "0" &&
        style.pointerEvents !== "none" &&
        node.getAttribute("aria-hidden") !== "true"
      );
    });
}

async function main() {
  const run = createValidationRun("session_autoscroll");
  const checks: ValidationCheck[] = [];
  const screenshotsDir = path.join(run.rootDir, "screenshots");
  mkdirSync(screenshotsDir, { recursive: true });

  const ready = await waitForReady();
  checks.push({
    name: "dev loop ready",
    status: ready.health.ok ? "pass" : "fail",
    detail: ready.health.ok
      ? `state=${ready.state?.status} and ${HEALTH_URL} returned 200`
      : ready.health.error || "dev loop did not become ready",
  });

  let initialMetrics: ScrollMetrics | undefined;
  let afterPinnedStreamMetrics: ScrollMetrics | undefined;
  let afterUserScrollMetrics: ScrollMetrics | undefined;
  let afterUserAwayStreamMetrics: ScrollMetrics | undefined;

  if (ready.health.ok) {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        baseURL: BASE_URL,
        viewport: { width: 1280, height: 520 },
      });
      await installMockEventSource(page);
      await wireMockRPC(page);

      await page.goto(`/sessions/${SESSION_ID}`, {
        waitUntil: "domcontentloaded",
      });
      await page.getByTestId("session-composer").waitFor({ timeout: 20_000 });
      await page.getByTestId("session-transcript").waitFor({ timeout: 20_000 });
      await scrollToTranscriptBottom(page);
      await waitForTranscriptDistance(page, 24);
      initialMetrics = await transcriptMetrics(page);
      await page.screenshot({
        fullPage: true,
        path: path.join(screenshotsDir, "initial-pinned.png"),
      });

      await emitDraftDelta(page, draftDelta(1, 18));
      await page
        .getByTestId("session-transcript-agent")
        .filter({ hasText: "AUTO-SCROLL-STREAM-LINE-018" })
        .waitFor({ timeout: 5_000 });
      await page.waitForTimeout(450);
      afterPinnedStreamMetrics = await transcriptMetrics(page);
      await page.screenshot({
        fullPage: true,
        path: path.join(screenshotsDir, "after-pinned-stream.png"),
      });

      const pinnedPass =
        afterPinnedStreamMetrics.distanceFromBottom <= 96 &&
        !(await isScrollToLatestVisible(page));
      checks.push({
        name: "pinned transcript follows streamed draft growth",
        status: pinnedPass ? "pass" : "fail",
        detail: `distance=${afterPinnedStreamMetrics.distanceFromBottom}, scrollTop=${afterPinnedStreamMetrics.scrollTop}, scrollHeight=${afterPinnedStreamMetrics.scrollHeight}`,
      });

      await scrollToTranscriptTop(page);
      await page.waitForTimeout(100);
      afterUserScrollMetrics = await transcriptMetrics(page);
      await emitDraftDelta(page, draftDelta(19, 6));
      await page
        .getByTestId("session-transcript-agent")
        .filter({ hasText: "AUTO-SCROLL-STREAM-LINE-024" })
        .waitFor({ timeout: 5_000 });
      await page.waitForTimeout(450);
      afterUserAwayStreamMetrics = await transcriptMetrics(page);
      await page.screenshot({
        fullPage: true,
        path: path.join(screenshotsDir, "after-user-away-stream.png"),
      });

      const userAwayPass =
        afterUserScrollMetrics.distanceFromBottom > 160 &&
        afterUserAwayStreamMetrics.distanceFromBottom > 160;
      checks.push({
        name: "user-scrolled transcript is not forced back to bottom",
        status: userAwayPass ? "pass" : "fail",
        detail: `before=${afterUserScrollMetrics.distanceFromBottom}, after=${afterUserAwayStreamMetrics.distanceFromBottom}`,
      });
    } catch (error) {
      checks.push({
        name: "browser auto-scroll scenario",
        status: "fail",
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      await browser.close();
    }
  }

  const overallStatus = combineValidationStatus(
    checks.map((check) => check.status),
  );
  run.writeJson("report.json", {
    checks,
    metrics: {
      afterPinnedStreamMetrics,
      afterUserAwayStreamMetrics,
      afterUserScrollMetrics,
      initialMetrics,
    },
    runId: run.runId,
    status: overallStatus,
  });
  run.writeText(
    "summary.md",
    renderValidationSummary("Session auto-scroll validation", checks, [
      "This browser validation opens the session detail route with the composer visible, injects live draft deltas through the same EventSource invalidation path used by SSE, and measures the real transcript scroll container.",
    ]),
  );
  writeFileSync(
    path.resolve(
      process.cwd(),
      "storage/artifacts/validation/latest-session-autoscroll.txt",
    ),
    `${run.rootDir}\n`,
  );
  console.log(`Session auto-scroll evidence: ${run.rootDir}`);

  if (overallStatus !== "pass") {
    process.exitCode = 1;
  }
}

await main();
