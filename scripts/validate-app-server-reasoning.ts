import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";

import { readDevState, waitForHttpOk } from "./lib/devloop.ts";
import {
  combineValidationStatus,
  renderValidationSummary,
  type ValidationCheck,
} from "./lib/rebuild-validation.ts";
import { createValidationRun } from "./lib/validation.ts";

const BASE_URL = "http://127.0.0.1:8787";
const HEALTH_URL = `${BASE_URL}/healthz`;
const REPO_ROOT = process.cwd();

type Project = {
  id: string;
  name: string;
  rootPath: string;
};

type SessionMeta = {
  id: string;
  status: string;
};

type TranscriptItem = {
  body: string;
  displayBody?: string;
  display_body?: string;
  id: string;
  kind: string;
  status: string;
};

type WorkspaceEventEnvelope = {
  type?: string;
  sessionId?: string;
  session_id?: string;
  payload?: {
    sessionLivePatch?: SessionLivePatchEnvelope;
    session_live_patch?: SessionLivePatchEnvelope;
  };
};

type SessionLivePatchEnvelope = {
  kind?: string;
  draftDelta?: string;
  draft_delta?: string;
  draftItemId?: string;
  draft_item_id?: string;
  finalItem?: TranscriptItem;
  final_item?: TranscriptItem;
  requiresRefetch?: boolean;
  requires_refetch?: boolean;
};

type CapturedSSEEvent = {
  elapsedMs: number;
  event: string;
  parsed?: WorkspaceEventEnvelope;
  rawDataLength: number;
  ts: string;
};

type TranscriptEntrySample = {
  domIndex: number;
  testId: string;
  text: string;
  visible: boolean;
};

type ReasoningDomSample = {
  elapsedMs: number;
  entries: TranscriptEntrySample[];
  reasoningBeforeFirstAgent: boolean;
  reasoningDisclosureAriaExpanded: string | null;
  reasoningDisclosureName: string;
  reasoningDisclosureVisible: boolean;
  reasoningExpandedBodyVisible: boolean;
  rawReasoningTextLength: number;
  rawReasoningVisible: boolean;
  reasoningText: string;
  reasoningTextLength: number;
  reasoningVisible: boolean;
  status: string;
  thinkingVisible: boolean;
  ts: string;
};

type ReasoningDisclosureSample = {
  ariaExpanded: string | null;
  bodyVisible: boolean;
  name: string;
  roleMatched: boolean;
  visible: boolean;
};

type TraceSummaryEntry = {
  contentPresent?: boolean;
  deltaLength?: number;
  direction: string;
  itemId?: string;
  itemType?: string;
  kind: string;
  method: string;
  summaryPresent?: boolean;
  ts: string;
  turnId?: string;
};

const REASONING_PLACEHOLDER_TEXT = new Set([
  "Raw reasoning emitted by Codex.",
  "Reasoning progress emitted by Codex.",
]);

async function rpc<T>(
  service: string,
  method: string,
  body: unknown,
): Promise<T> {
  const response = await fetch(`${BASE_URL}/rpc/${service}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`${service}/${method} returned ${response.status}`);
  }

  return response.json() as Promise<T>;
}

async function listProjects() {
  return rpc<{ projects?: Project[] }>(
    "hopter.v1.ProjectService",
    "ListProjects",
    {},
  );
}

async function createSession(projectId: string, prompt: string, title: string) {
  return rpc<{ session?: { id: string } }>(
    "hopter.v1.SessionService",
    "CreateSession",
    {
      backendKey: "codex",
      model: "gpt-5.4",
      projectId,
      prompt,
      reasoningEffort: "xhigh",
      title,
    },
  );
}

async function getSessionMeta(sessionId: string) {
  return rpc<{ session?: SessionMeta }>(
    "hopter.v1.SessionService",
    "GetSessionMeta",
    { sessionId },
  );
}

async function listTranscript(sessionId: string) {
  return rpc<{ page?: { items?: TranscriptItem[] } }>(
    "hopter.v1.SessionService",
    "ListSessionTranscript",
    { limit: 200, sessionId },
  );
}

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

async function startSSECollector(startedAt: number) {
  const controller = new AbortController();
  const events: CapturedSSEEvent[] = [];

  const streamPromise = (async () => {
    const response = await fetch(`${BASE_URL}/events`, {
      signal: controller.signal,
      headers: { Accept: "text/event-stream" },
    });
    if (!response.ok || !response.body) {
      throw new Error(`GET /events returned ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const chunk = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const parsed = parseSSEChunk(chunk, startedAt);
        if (parsed) {
          events.push(parsed);
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
  })();

  return {
    events,
    async waitForReady(timeoutMs = 10_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (events.some((event) => event.event === "ready")) {
          return;
        }
        await Bun.sleep(100);
      }
      throw new Error("Timed out waiting for SSE ready event");
    },
    async stop() {
      controller.abort();
      try {
        await streamPromise;
      } catch {
        // Abort is the normal shutdown path.
      }
    },
  };
}

function parseSSEChunk(
  chunk: string,
  startedAt: number,
): CapturedSSEEvent | null {
  const lines = chunk.split("\n");
  let event = "message";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (!line || line.startsWith(":")) {
      continue;
    }
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trim());
    }
  }

  const rawData = dataLines.join("\n");
  if (!event && !rawData) {
    return null;
  }

  let parsed: WorkspaceEventEnvelope | undefined;
  if (rawData) {
    try {
      parsed = JSON.parse(rawData) as WorkspaceEventEnvelope;
    } catch {
      parsed = undefined;
    }
  }

  return {
    elapsedMs: Date.now() - startedAt,
    event,
    parsed,
    rawDataLength: rawData.length,
    ts: new Date().toISOString(),
  };
}

function eventSessionId(event: CapturedSSEEvent) {
  return event.parsed?.sessionId ?? event.parsed?.session_id ?? "";
}

function eventPatch(event: CapturedSSEEvent) {
  return (
    event.parsed?.payload?.sessionLivePatch ??
    event.parsed?.payload?.session_live_patch
  );
}

async function sampleReasoningDom(
  page: Page,
  input: {
    startedAt: number;
    status: string;
  },
): Promise<ReasoningDomSample> {
  return page.evaluate((args): ReasoningDomSample => {
    const normalize = (value: string) => value.trim().replace(/\s+/g, " ");
    const timeline = document.querySelector<HTMLElement>(
      '[data-testid="session-transcript"]',
    );
    const scrollContainer = findScrollContainer(timeline);
    const containerRect =
      scrollContainer?.getBoundingClientRect() ??
      document.documentElement.getBoundingClientRect();
    const rows = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-testid="session-transcript"] > [data-index]',
      ),
    );

    const entries = rows.map((row, domIndex) => {
      const tested = Array.from(
        row.querySelectorAll<HTMLElement>("[data-testid]"),
      );
      const primary =
        tested.find((candidate) =>
          [
            "session-transcript-user",
            "session-transcript-pending",
            "session-transcript-agent",
            "session-transcript-reasoning",
            "session-transcript-thinking",
          ].includes(candidate.dataset.testid ?? ""),
        ) ??
        tested[0] ??
        row;
      const rect = row.getBoundingClientRect();
      const visible =
        rect.bottom > containerRect.top + 1 &&
        rect.top < containerRect.bottom - 1 &&
        rect.right > containerRect.left + 1 &&
        rect.left < containerRect.right - 1;

      return {
        domIndex,
        testId: primary.dataset.testid ?? "",
        text: normalize(row.textContent ?? ""),
        visible,
      };
    });

    const reasoningEntries = entries.filter(
      (entry) => entry.testId === "session-transcript-reasoning",
    );
    const reasoningNode = document.querySelector<HTMLElement>(
      '[data-testid="session-transcript-reasoning"]',
    );
    const firstAgentNode = document.querySelector<HTMLElement>(
      '[data-testid="session-transcript-agent"]',
    );
    const reasoningButton =
      reasoningNode?.querySelector<HTMLButtonElement>("button") ?? null;
    const reasoningButtonRect = reasoningButton?.getBoundingClientRect();
    const reasoningButtonVisible = reasoningButtonRect
      ? reasoningButtonRect.bottom > containerRect.top + 1 &&
        reasoningButtonRect.top < containerRect.bottom - 1 &&
        reasoningButtonRect.right > containerRect.left + 1 &&
        reasoningButtonRect.left < containerRect.right - 1
      : false;
    const reasoningExpandedBody = document.querySelector<HTMLElement>(
      '[data-testid="session-transcript-reasoning-body"]',
    );
    const reasoningExpandedBodyRect =
      reasoningExpandedBody?.getBoundingClientRect();
    const rawBlocks = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-testid="session-transcript-reasoning-raw"]',
      ),
    );
    const rawReasoningText = normalize(
      rawBlocks.map((node) => node.textContent ?? "").join("\n"),
    );

    return {
      elapsedMs: Date.now() - args.startedAt,
      entries,
      reasoningBeforeFirstAgent: Boolean(
        reasoningNode &&
        firstAgentNode &&
        (reasoningNode.compareDocumentPosition(firstAgentNode) &
          Node.DOCUMENT_POSITION_FOLLOWING) !==
          0,
      ),
      reasoningDisclosureAriaExpanded:
        reasoningButton?.getAttribute("aria-expanded") ?? null,
      reasoningDisclosureName: normalize(
        reasoningButton?.getAttribute("aria-label") ??
          reasoningButton?.innerText ??
          "",
      ),
      reasoningDisclosureVisible: reasoningButtonVisible,
      reasoningExpandedBodyVisible: reasoningExpandedBodyRect
        ? reasoningExpandedBodyRect.bottom > containerRect.top + 1 &&
          reasoningExpandedBodyRect.top < containerRect.bottom - 1 &&
          reasoningExpandedBodyRect.right > containerRect.left + 1 &&
          reasoningExpandedBodyRect.left < containerRect.right - 1
        : false,
      rawReasoningTextLength: rawReasoningText.length,
      rawReasoningVisible: rawBlocks.some((node) => {
        const rect = node.getBoundingClientRect();
        return (
          rect.bottom > containerRect.top + 1 &&
          rect.top < containerRect.bottom - 1 &&
          rect.right > containerRect.left + 1 &&
          rect.left < containerRect.right - 1
        );
      }),
      reasoningText: reasoningEntries.map((entry) => entry.text).join("\n"),
      reasoningTextLength: reasoningEntries.reduce(
        (total, entry) => total + entry.text.length,
        0,
      ),
      reasoningVisible: reasoningEntries.some((entry) => entry.visible),
      status: args.status,
      thinkingVisible: entries.some(
        (entry) =>
          entry.testId === "session-transcript-thinking" && entry.visible,
      ),
      ts: new Date().toISOString(),
    };

    function findScrollContainer(node: HTMLElement | null) {
      let current = node?.parentElement ?? null;
      while (current) {
        const style = window.getComputedStyle(current);
        if (
          /(auto|scroll)/.test(style.overflowY) &&
          current.scrollHeight > current.clientHeight
        ) {
          return current;
        }
        current = current.parentElement;
      }
      return document.scrollingElement as HTMLElement | null;
    }
  }, input);
}

async function inspectReasoningDisclosure(
  page: Page,
): Promise<ReasoningDisclosureSample> {
  const row = page.getByTestId("session-transcript-reasoning").first();
  if ((await row.count()) === 0) {
    return {
      ariaExpanded: null,
      bodyVisible: false,
      name: "",
      roleMatched: false,
      visible: false,
    };
  }

  await row.scrollIntoViewIfNeeded();
  const button = row
    .getByRole("button", {
      name: /^(Thinking|Reasoning)/,
    })
    .first();
  if ((await button.count()) === 0) {
    return {
      ariaExpanded: null,
      bodyVisible: false,
      name: "",
      roleMatched: false,
      visible: false,
    };
  }

  const [ariaExpanded, bodyVisible, name, visible] = await Promise.all([
    button.getAttribute("aria-expanded"),
    row
      .getByTestId("session-transcript-reasoning-body")
      .isVisible()
      .catch(() => false),
    button.evaluate(
      (node) =>
        node.getAttribute("aria-label") ||
        node.textContent?.trim().replace(/\s+/g, " ") ||
        "",
    ),
    button.isVisible(),
  ]);

  return {
    ariaExpanded,
    bodyVisible,
    name,
    roleMatched: true,
    visible,
  };
}

function tracePath(sessionId: string) {
  return path.resolve(
    REPO_ROOT,
    "storage",
    "runtime",
    "app-server-traces",
    `${sessionId}.jsonl`,
  );
}

function readTraceSummary(sessionId: string) {
  const filePath = tracePath(sessionId);
  if (!existsSync(filePath)) {
    return {
      counts: {},
      entries: [] as TraceSummaryEntry[],
      path: filePath,
      present: false,
      reasoningContentCompleted: false,
      reasoningEventCount: 0,
      reasoningSummaryCompleted: false,
      reasoningSummaryDeltaCount: 0,
      reasoningTextDeltaCount: 0,
    };
  }

  const entries = readFileSync(filePath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line): TraceSummaryEntry | null => {
      const parsed = JSON.parse(line) as {
        direction?: string;
        kind?: string;
        method?: string;
        payload?: {
          params?: {
            contentIndex?: number;
            delta?: string;
            item?: {
              content?: unknown;
              id?: string;
              summary?: unknown;
              type?: string;
            };
            itemId?: string;
            summaryIndex?: number;
            turnId?: string;
          };
        };
        ts?: string;
      };
      const method = parsed.method ?? "";
      if (
        !method.startsWith("item/reasoning/") &&
        method !== "item/started" &&
        method !== "item/completed" &&
        method !== "turn/completed" &&
        method !== "turn/started"
      ) {
        return null;
      }

      const item = parsed.payload?.params?.item;
      const itemType = item?.type;
      if (
        (method === "item/started" || method === "item/completed") &&
        itemType !== "reasoning"
      ) {
        return null;
      }

      return {
        contentPresent: hasContent(item?.content),
        deltaLength: (parsed.payload?.params?.delta ?? "").length || undefined,
        direction: parsed.direction ?? "",
        itemId: parsed.payload?.params?.itemId ?? item?.id,
        itemType,
        kind: parsed.kind ?? "",
        method,
        summaryPresent: hasContent(item?.summary),
        ts: parsed.ts ?? "",
        turnId: parsed.payload?.params?.turnId,
      };
    })
    .filter((entry): entry is TraceSummaryEntry => Boolean(entry));

  const counts = entries.reduce<Record<string, number>>((acc, entry) => {
    acc[entry.method] = (acc[entry.method] ?? 0) + 1;
    return acc;
  }, {});

  return {
    counts,
    entries,
    path: filePath,
    present: true,
    reasoningContentCompleted: entries.some(
      (entry) => entry.method === "item/completed" && entry.contentPresent,
    ),
    reasoningEventCount: entries.length,
    reasoningSummaryCompleted: entries.some(
      (entry) => entry.method === "item/completed" && entry.summaryPresent,
    ),
    reasoningSummaryDeltaCount:
      counts["item/reasoning/summaryTextDelta"] ?? 0,
    reasoningTextDeltaCount: counts["item/reasoning/textDelta"] ?? 0,
  };
}

function hasContent(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.some(hasContent);
  }
  if (typeof value === "object") {
    return Object.values(value).some(hasContent);
  }
  return true;
}

function transcriptHasReasoning(items: TranscriptItem[]) {
  return items.some(transcriptItemHasSubstantiveReasoning);
}

function transcriptHasRawReasoning(items: TranscriptItem[]) {
  return items.some((item) => {
    if (item.kind !== "SESSION_TRANSCRIPT_ITEM_KIND_REASONING") {
      return false;
    }
    const raw = item.displayBody ?? item.display_body ?? "";
    return hasSubstantiveReasoningText(raw);
  });
}

function transcriptItemHasSubstantiveReasoning(item: TranscriptItem | undefined) {
  if (item?.kind !== "SESSION_TRANSCRIPT_ITEM_KIND_REASONING") {
    return false;
  }
  return (
    hasSubstantiveReasoningText(item.body) ||
    hasSubstantiveReasoningText(item.displayBody ?? item.display_body ?? "")
  );
}

function hasSubstantiveReasoningText(value: string | undefined) {
  const normalized = (value ?? "").trim().replace(/\s+/g, " ");
  return normalized.length > 0 && !REASONING_PLACEHOLDER_TEXT.has(normalized);
}

async function main() {
  const run = createValidationRun("app_server_reasoning");
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

  if (!ready.health.ok) {
    finish(run, checks, "", [], []);
    return;
  }

  const samples: ReasoningDomSample[] = [];
  let collector: Awaited<ReturnType<typeof startSSECollector>> | undefined;
  let finalTranscriptItems: TranscriptItem[] = [];
  let finalSeen = false;
  let postRefetchSample: ReasoningDomSample | undefined;
  let postRefetchDisclosureSample: ReasoningDisclosureSample | undefined;
  let postRefetchExpandedDisclosureSample:
    | ReasoningDisclosureSample
    | undefined;
  let postRefetchTranscriptItems: TranscriptItem[] = [];
  let sessionId = "";
  let traceSummary: ReturnType<typeof readTraceSummary> | undefined;

  try {
    const projects = (await listProjects()).projects ?? [];
    const targetProject =
      projects.find((project) => project.rootPath === REPO_ROOT) ?? projects[0];
    checks.push({
      name: "project list includes selectable repo",
      status: targetProject ? "pass" : "fail",
      detail: targetProject
        ? `${targetProject.name} (${targetProject.rootPath})`
        : "no selectable project returned from ProjectService.ListProjects",
    });
    if (!targetProject) {
      throw new Error(
        "No project available for app-server reasoning validation",
      );
    }

    const startedAt = Date.now();
    collector = await startSSECollector(startedAt);
    await collector.waitForReady();

    const promptToken = `REASONING-PROMPT-${Date.now()}`;
    const finalToken = `REASONING-FINAL-${Date.now()}`;
    const prompt = [
      `${promptToken}.`,
      "Use a careful internal approach, but do not reveal hidden chain-of-thought.",
      "Write a public answer of 80 short numbered lines about why remote control planes need clear transcript state.",
      `Every line must include ${promptToken}.`,
      `End with exactly ${finalToken}.`,
      "Do not use tools.",
    ].join(" ");

    const created = await createSession(
      targetProject.id,
      prompt,
      `Reasoning validation ${new Date().toISOString()}`,
    );
    sessionId = created.session?.id ?? "";
    if (!sessionId) {
      throw new Error(
        "SessionService.CreateSession did not return a session id",
      );
    }

    checks.push({
      name: "created real Codex XHigh session",
      status: "pass",
      detail: `${sessionId} model=gpt-5.4 reasoningEffort=xhigh`,
    });

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        baseURL: BASE_URL,
        viewport: { width: 1440, height: 900 },
      });
      await page.goto(`/sessions/${sessionId}`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForSelector('[data-testid="session-transcript"]', {
        timeout: 20_000,
      });
      await page.screenshot({
        fullPage: true,
        path: path.join(screenshotsDir, "initial.png"),
      });

      let status = "";
      let reasoningScreenshot = false;
      let rawScreenshot = false;
      const deadline = Date.now() + 300_000;

      while (Date.now() < deadline) {
        try {
          const [metaResponse, transcriptResponse] = await Promise.all([
            getSessionMeta(sessionId),
            listTranscript(sessionId),
          ]);
          status = metaResponse.session?.status ?? "";
          finalTranscriptItems = transcriptResponse.page?.items ?? [];
          finalSeen = finalTranscriptItems.some(
            (item) =>
              item.kind === "SESSION_TRANSCRIPT_ITEM_KIND_AGENT_MESSAGE" &&
              item.body.includes(finalToken),
          );
        } catch {
          // Session lookup can race creation for a short window.
        }

        const sample = await sampleReasoningDom(page, {
          startedAt,
          status,
        });
        samples.push(sample);

        if (!reasoningScreenshot && sample.reasoningTextLength > 0) {
          reasoningScreenshot = true;
          await page.screenshot({
            fullPage: true,
            path: path.join(screenshotsDir, "reasoning-visible.png"),
          });
        }
        if (!rawScreenshot && sample.rawReasoningTextLength > 0) {
          rawScreenshot = true;
          await page.screenshot({
            fullPage: true,
            path: path.join(screenshotsDir, "raw-reasoning-visible.png"),
          });
        }

        if (finalSeen && /COMPLETED|FAILED|DEGRADED/.test(status)) {
          break;
        }

        await Bun.sleep(150);
      }

      await page.screenshot({
        fullPage: true,
        path: path.join(screenshotsDir, "final.png"),
      });

      if (finalSeen) {
        postRefetchTranscriptItems =
          (await listTranscript(sessionId)).page?.items ?? [];
        await page.goto(`/sessions/${sessionId}`, {
          waitUntil: "domcontentloaded",
        });
        await page.waitForSelector('[data-testid="session-transcript"]', {
          timeout: 20_000,
        });
        await Bun.sleep(1_000);
        postRefetchDisclosureSample = await inspectReasoningDisclosure(page);
        postRefetchSample = await sampleReasoningDom(page, {
          startedAt,
          status,
        });
        samples.push(postRefetchSample);
        await page.screenshot({
          fullPage: true,
          path: path.join(screenshotsDir, "post-refetch.png"),
        });
        if (
          postRefetchDisclosureSample.roleMatched &&
          postRefetchDisclosureSample.visible
        ) {
          await page
            .getByTestId("session-transcript-reasoning")
            .first()
            .getByRole("button", { name: /^(Thinking|Reasoning)/ })
            .first()
            .click();
          await Bun.sleep(250);
          postRefetchExpandedDisclosureSample =
            await inspectReasoningDisclosure(page);
          await page.screenshot({
            fullPage: true,
            path: path.join(screenshotsDir, "post-refetch-expanded.png"),
          });
        }
      }
    } finally {
      await browser.close();
    }

    const sessionEvents = collector.events.filter(
      (event) => eventSessionId(event) === sessionId,
    );
    traceSummary = readTraceSummary(sessionId);
    const reasoningEmitted =
      traceSummary.reasoningSummaryDeltaCount > 0 ||
      traceSummary.reasoningTextDeltaCount > 0 ||
      traceSummary.reasoningSummaryCompleted ||
      traceSummary.reasoningContentCompleted ||
      transcriptHasReasoning(finalTranscriptItems);
    const rawReasoningEmitted =
      traceSummary.reasoningTextDeltaCount > 0 ||
      traceSummary.reasoningContentCompleted ||
      transcriptHasRawReasoning(finalTranscriptItems);
    const postRefetchHasReasoning =
      transcriptHasReasoning(postRefetchTranscriptItems) ||
      Boolean(postRefetchSample?.reasoningTextLength);
    const postRefetchHasRawReasoning =
      transcriptHasRawReasoning(postRefetchTranscriptItems) ||
      Boolean(postRefetchSample?.rawReasoningTextLength);
    const reasoningDomSamples = samples.filter(
      (sample) => sample.reasoningTextLength > 0 || sample.reasoningVisible,
    );
    const rawDomSamples = samples.filter(
      (sample) =>
        sample.rawReasoningTextLength > 0 || sample.rawReasoningVisible,
    );
    const reasoningPatchEvents = sessionEvents.filter((event) => {
      const patch = eventPatch(event);
      const finalItem = patch?.finalItem ?? patch?.final_item;
      return transcriptItemHasSubstantiveReasoning(finalItem);
    });

    checks.push({
      name: "app-server trace captured reasoning events",
      status: reasoningEmitted ? "pass" : "blocked",
      detail: reasoningEmitted
        ? `reasoningEvents=${traceSummary.reasoningEventCount}, summaryDeltas=${traceSummary.reasoningSummaryDeltaCount}, rawTextDeltas=${traceSummary.reasoningTextDeltaCount}`
        : `no substantive reasoning item/delta emitted for ${sessionId}; placeholder-only markers are blocked/no-op for this run`,
    });
    checks.push({
      name: "SSE forwarded reasoning transcript patches",
      status: reasoningEmitted
        ? reasoningPatchEvents.length > 0
          ? "pass"
          : "fail"
        : "blocked",
      detail: reasoningEmitted
        ? `${reasoningPatchEvents.length} reasoning live patches captured`
        : "not required because app-server emitted no reasoning surface",
    });
    checks.push({
      name: "UI DOM rendered reasoning/progress surface",
      status: reasoningEmitted
        ? reasoningDomSamples.length > 0
          ? "pass"
          : "fail"
        : "blocked",
      detail: reasoningEmitted
        ? `reasoningDomSamples=${reasoningDomSamples.length}, thinkingSamples=${samples.filter((sample) => sample.thinkingVisible).length}`
        : "not required because app-server emitted no reasoning surface",
    });
    checks.push({
      name: "completed refetch exposes accessible collapsed reasoning row",
      status: reasoningEmitted
        ? postRefetchHasReasoning &&
          Boolean(postRefetchSample?.reasoningVisible) &&
          Boolean(postRefetchSample?.reasoningBeforeFirstAgent) &&
          Boolean(postRefetchDisclosureSample?.roleMatched) &&
          Boolean(postRefetchDisclosureSample?.visible) &&
          postRefetchDisclosureSample?.ariaExpanded === "false" &&
          !postRefetchSample?.thinkingVisible
          ? "pass"
          : "fail"
        : "blocked",
      detail: reasoningEmitted
        ? [
            `transcriptReasoning=${transcriptHasReasoning(postRefetchTranscriptItems)}`,
            `domReasoningLength=${postRefetchSample?.reasoningTextLength ?? 0}`,
            `reasoningVisible=${postRefetchSample?.reasoningVisible ?? false}`,
            `beforeAgent=${postRefetchSample?.reasoningBeforeFirstAgent ?? false}`,
            `a11yRoleMatched=${postRefetchDisclosureSample?.roleMatched ?? false}`,
            `a11yVisible=${postRefetchDisclosureSample?.visible ?? false}`,
            `ariaExpanded=${postRefetchDisclosureSample?.ariaExpanded ?? "missing"}`,
            `thinkingVisible=${postRefetchSample?.thinkingVisible ?? false}`,
          ].join(", ")
        : "not required because app-server emitted no reasoning surface",
    });
    checks.push({
      name: "completed reasoning disclosure expands",
      status: reasoningEmitted
        ? postRefetchExpandedDisclosureSample?.ariaExpanded === "true" &&
          postRefetchExpandedDisclosureSample.bodyVisible
          ? "pass"
          : "fail"
        : "blocked",
      detail: reasoningEmitted
        ? `ariaExpanded=${postRefetchExpandedDisclosureSample?.ariaExpanded ?? "missing"}, bodyVisible=${postRefetchExpandedDisclosureSample?.bodyVisible ?? false}, name=${postRefetchExpandedDisclosureSample?.name ?? ""}`
        : "not required because app-server emitted no reasoning surface",
    });
    checks.push({
      name: "raw reasoning gated to emitted raw content",
      status: rawReasoningEmitted
        ? rawDomSamples.length > 0 ||
          transcriptHasRawReasoning(finalTranscriptItems)
          ? "pass"
          : "fail"
        : !postRefetchHasRawReasoning
          ? "pass"
          : "fail",
      detail: rawReasoningEmitted
        ? `rawDomSamples=${rawDomSamples.length}, transcriptRaw=${transcriptHasRawReasoning(finalTranscriptItems)}`
        : postRefetchHasRawReasoning
          ? "raw reasoning appeared after refetch despite no raw app-server content"
          : "no raw reasoning text emitted; UI kept raw reasoning hidden after refetch",
    });
    checks.push({
      name: "final public answer completed",
      status: finalSeen ? "pass" : "fail",
      detail: finalSeen
        ? `${sessionId} final token observed`
        : `${sessionId} did not complete with ${finalToken}`,
    });

    run.writeJson("context.json", {
      baseUrl: BASE_URL,
      finalToken,
      promptToken,
      ready,
      sessionId,
      tracePath: traceSummary.path,
    });
    run.writeJson("samples.json", samples);
    run.writeJson("events.json", sessionEvents);
    run.writeJson("trace-summary.json", traceSummary);
    run.writeJson("transcript.json", finalTranscriptItems);
    run.writeJson("post-refetch-transcript.json", postRefetchTranscriptItems);
    run.writeJson("post-refetch-disclosure.json", {
      collapsed: postRefetchDisclosureSample,
      expanded: postRefetchExpandedDisclosureSample,
    });
  } catch (error) {
    checks.push({
      name: "app-server reasoning validation",
      status: "fail",
      detail: error instanceof Error ? error.message : String(error),
    });
    run.writeJson("samples.json", samples);
    if (collector) {
      run.writeJson(
        "events.json",
        collector.events.filter((event) => eventSessionId(event) === sessionId),
      );
    }
    if (sessionId) {
      traceSummary = readTraceSummary(sessionId);
      run.writeJson("trace-summary.json", traceSummary);
      try {
        run.writeJson(
          "transcript.json",
          (await listTranscript(sessionId)).page?.items ?? [],
        );
      } catch {
        // Best-effort failure evidence.
      }
    }
  } finally {
    if (collector) {
      await collector.stop();
    }
  }

  finish(run, checks, sessionId, samples);
}

function finish(
  run: ReturnType<typeof createValidationRun>,
  checks: ValidationCheck[],
  sessionId: string,
  samples: ReasoningDomSample[],
  notes: string[] = [],
) {
  const overallStatus = combineValidationStatus(
    checks.map((check) => check.status),
  );
  run.writeJson("report.json", {
    checks,
    runId: run.runId,
    sampleCount: samples.length,
    sessionId,
    status: overallStatus,
  });
  run.writeText(
    "summary.md",
    renderValidationSummary(
      "App-server reasoning/progress validation",
      checks,
      [
        "This validation creates a real Codex-backed gpt-5.4 XHigh session, captures app-server trace metadata, samples live and post-refetch session DOM, verifies the completed reasoning disclosure is visible and accessible before the final answer, and treats placeholder-only reasoning markers as blocked/no-op instead of a UI rendering failure.",
        ...notes,
      ],
    ),
  );
  writeFileSync(
    path.resolve(
      REPO_ROOT,
      "storage/artifacts/validation/latest-app-server-reasoning.txt",
    ),
    `${run.rootDir}\n`,
  );
  console.log(`App-server reasoning evidence: ${run.rootDir}`);

  if (overallStatus !== "pass") {
    process.exitCode = 1;
  }
}

await main();
