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
  kind: string;
};

type WorkspaceEventEnvelope = {
  type?: string;
  sessionId?: string;
  session_id?: string;
  payload?: {
    sessionLivePatch?: {
      kind?: string;
      draftDelta?: string;
      draftItemId?: string;
      requiresRefetch?: boolean;
    };
    session_live_patch?: {
      kind?: string;
      draft_delta?: string;
      draft_item_id?: string;
      requires_refetch?: boolean;
    };
  };
};

type CapturedSSEEvent = {
  elapsedMs: number;
  event: string;
  parsed?: WorkspaceEventEnvelope;
  rawDataLength: number;
  ts: string;
};

type TranscriptEntrySample = {
  bottom: number;
  domIndex: number;
  height: number;
  testId: string;
  text: string;
  textLength: number;
  top: number;
  visible: boolean;
};

type VisibleStreamingSample = {
  agentIndex: number;
  agentText: string;
  agentTextLength: number;
  agentVisible: boolean;
  distanceFromBottom: number;
  elapsedMs: number;
  entries: TranscriptEntrySample[];
  promptIndex: number;
  scrollHeight: number;
  scrollTop: number;
  status: string;
  thinkingOnlyVisible: boolean;
  thinkingVisible: boolean;
  ts: string;
  visibleText: string;
};

type TraceSummaryEntry = {
  deltaLength?: number;
  direction: string;
  itemId?: string;
  kind: string;
  method: string;
  phase?: string;
  ts: string;
  turnId?: string;
};

async function rpc<T>(service: string, method: string, body: unknown): Promise<T> {
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

async function createSession(
  projectId: string,
  prompt: string,
  title: string,
  options?: { model?: string; reasoningEffort?: string },
) {
  return rpc<{ session?: { id: string } }>(
    "hopter.v1.SessionService",
    "CreateSession",
    {
      backendKey: "codex",
      model: options?.model,
      projectId,
      prompt,
      reasoningEffort: options?.reasoningEffort,
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

function includesToken(
  items: TranscriptItem[] | undefined,
  kind: string,
  token: string,
) {
  return (items ?? []).some(
    (item) => item.kind === kind && item.body.includes(token),
  );
}

function isTransientLookupError(error: unknown) {
  return error instanceof Error && /returned 404/.test(error.message);
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

async function waitForInitialTurn(
  sessionId: string,
  replyToken: string,
  timeoutMs = 120_000,
) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = "";

  while (Date.now() < deadline) {
    try {
      const [metaResponse, transcriptResponse] = await Promise.all([
        getSessionMeta(sessionId),
        listTranscript(sessionId),
      ]);
      lastStatus = metaResponse.session?.status ?? "";
      if (
        includesToken(
          transcriptResponse.page?.items,
          "SESSION_TRANSCRIPT_ITEM_KIND_AGENT_MESSAGE",
          replyToken,
        ) &&
        /COMPLETED|FAILED|DEGRADED/.test(lastStatus)
      ) {
        return lastStatus;
      }
    } catch (error) {
      if (!isTransientLookupError(error)) {
        throw error;
      }
    }
    await Bun.sleep(1_000);
  }

  throw new Error(
    `Timed out waiting for initial assistant token ${replyToken}; last status=${lastStatus}`,
  );
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

function parseSSEChunk(chunk: string, startedAt: number): CapturedSSEEvent | null {
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

function eventPatchKind(event: CapturedSSEEvent) {
  return eventPatch(event)?.kind ?? "";
}

function eventDraftDeltaLength(event: CapturedSSEEvent) {
  const patch = eventPatch(event);
  return (patch?.draftDelta ?? patch?.draft_delta ?? "").length;
}

async function sampleVisibleTranscript(
  page: Page,
  input: {
    baselineCount: number;
    promptToken: string;
    startedAt: number;
    status: string;
  },
): Promise<VisibleStreamingSample> {
  return page.evaluate((args): VisibleStreamingSample => {
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
            "session-transcript-thinking",
          ].includes(candidate.dataset.testid ?? ""),
        ) ?? tested[0] ?? row;
      const rect = row.getBoundingClientRect();
      const visible =
        rect.bottom > containerRect.top + 1 &&
        rect.top < containerRect.bottom - 1 &&
        rect.right > containerRect.left + 1 &&
        rect.left < containerRect.right - 1;
      const text = normalize(row.textContent ?? "");

      return {
        bottom: rect.bottom,
        domIndex,
        height: rect.height,
        testId: primary.dataset.testid ?? "",
        text,
        textLength: text.length,
        top: rect.top,
        visible,
      };
    });

    const promptIndex =
      entries.find(
        (entry) =>
          (entry.testId === "session-transcript-user" ||
            entry.testId === "session-transcript-pending") &&
          entry.text.includes(args.promptToken),
      )?.domIndex ?? -1;
    const agentEntry = entries.find(
      (entry) =>
        entry.testId === "session-transcript-agent" &&
        entry.domIndex >= args.baselineCount,
    );
    const visibleEntries = entries.filter((entry) => entry.visible);
    const thinkingVisible = visibleEntries.some(
      (entry) => entry.testId === "session-transcript-thinking",
    );
    const agentVisible = Boolean(agentEntry?.visible);
    const scrollHeight = scrollContainer?.scrollHeight ?? 0;
    const scrollTop = scrollContainer?.scrollTop ?? 0;
    const clientHeight = scrollContainer?.clientHeight ?? window.innerHeight;

    return {
      agentIndex: agentEntry?.domIndex ?? -1,
      agentText: agentEntry?.text ?? "",
      agentTextLength: agentEntry?.textLength ?? 0,
      agentVisible,
      distanceFromBottom: scrollHeight - scrollTop - clientHeight,
      elapsedMs: Date.now() - args.startedAt,
      entries,
      promptIndex,
      scrollHeight,
      scrollTop,
      status: args.status,
      thinkingOnlyVisible:
        thinkingVisible &&
        !visibleEntries.some(
          (entry) =>
            entry.testId === "session-transcript-agent" &&
            entry.domIndex >= args.baselineCount,
        ),
      thinkingVisible,
      ts: new Date().toISOString(),
      visibleText: visibleEntries.map((entry) => entry.text).join("\n"),
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
            delta?: string;
            item?: {
              id?: string;
              phase?: string;
              type?: string;
            };
            itemId?: string;
            turnId?: string;
          };
        };
        ts?: string;
      };
      const method = parsed.method ?? "";
      if (
        method !== "item/agentMessage/delta" &&
        method !== "item/completed" &&
        method !== "item/started" &&
        method !== "turn/completed" &&
        method !== "turn/started" &&
        method !== "thread/status/changed"
      ) {
        return null;
      }

      return {
        deltaLength:
          method === "item/agentMessage/delta"
            ? (parsed.payload?.params?.delta ?? "").length
            : undefined,
        direction: parsed.direction ?? "",
        itemId:
          parsed.payload?.params?.itemId ?? parsed.payload?.params?.item?.id,
        kind: parsed.kind ?? "",
        method,
        phase: parsed.payload?.params?.item?.phase,
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
  };
}

function increasingAgentLengths(samples: VisibleStreamingSample[]) {
  const unique = new Set(
    samples
      .filter((sample) => sample.agentTextLength > 0)
      .map((sample) => sample.agentTextLength),
  );
  return unique.size;
}

async function main() {
  const run = createValidationRun("session_visible_streaming");
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
    finish(run, checks, "", []);
    return;
  }

  const samples: VisibleStreamingSample[] = [];
  const sendPayloads: unknown[] = [];
  let sessionId = "";
  let finalTranscriptItems: TranscriptItem[] = [];
  let traceSummary: ReturnType<typeof readTraceSummary> | undefined;
  let collector:
    | Awaited<ReturnType<typeof startSSECollector>>
    | undefined;

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
      throw new Error("No project available for visible streaming validation");
    }

    const baselineToken = `VISIBLE-BASELINE-${Date.now()}`;
    const created = await createSession(
      targetProject.id,
      `Reply with exactly ${baselineToken}. Do not use tools.`,
      `Visible streaming validation ${new Date().toISOString()}`,
      { model: "gpt-5.4", reasoningEffort: "low" },
    );
    sessionId = created.session?.id ?? "";
    if (!sessionId) {
      throw new Error("SessionService.CreateSession did not return a session id");
    }

    const initialStatus = await waitForInitialTurn(sessionId, baselineToken);
    checks.push({
      name: "baseline turn completed",
      status: "pass",
      detail: `${sessionId} -> ${initialStatus}`,
    });

    const promptToken = `VISIBLE-PROMPT-${Date.now()}`;
    const agentToken = `VISIBLE-AGENT-${Date.now()}`;
    const finalToken = `VISIBLE-FINAL-${Date.now()}`;
    const followUpPrompt = [
      `${promptToken}.`,
      "Write a public answer of 160 short numbered lines.",
      `Every line must include ${agentToken}.`,
      `End with exactly ${finalToken}.`,
      "Do not use tools.",
      "Do not include hidden reasoning or chain-of-thought.",
    ].join(" ");

    const browser = await chromium.launch({ headless: true });
    const startedAt = Date.now();
    collector = await startSSECollector(startedAt);
    try {
      await collector.waitForReady();
      const page = await browser.newPage({
        baseURL: BASE_URL,
        viewport: { width: 1440, height: 900 },
      });
      page.on("request", (request) => {
        if (request.url().includes("/hopter.v1.SessionService/SendSessionInput")) {
          try {
            sendPayloads.push(request.postDataJSON());
          } catch {
            sendPayloads.push(request.postData());
          }
        }
      });

      await page.goto(`/sessions/${sessionId}`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector('[data-testid="session-composer"]', {
        timeout: 20_000,
      });
      await page.waitForSelector('[data-testid="session-transcript"]', {
        timeout: 20_000,
      });
      await page.screenshot({
        fullPage: true,
        path: path.join(screenshotsDir, "before-submit.png"),
      });

      const baselineCount = await page
        .locator('[data-testid="session-transcript"] > [data-index]')
        .count();

      await page.getByTestId("session-prompt-input").fill(followUpPrompt);
      const submittedAt = Date.now();
      await page.getByTestId("session-followup-submit").click({ noWaitAfter: true });

      let status = "";
      let firstAgentScreenshot = false;
      let midStreamScreenshot = false;
      let finalSeen = false;
      const deadline = Date.now() + 240_000;

      while (Date.now() < deadline) {
        if (samples.length % 8 === 0) {
          try {
            const [metaResponse, transcriptResponse] = await Promise.all([
              getSessionMeta(sessionId),
              listTranscript(sessionId),
            ]);
            status = metaResponse.session?.status ?? "";
            finalTranscriptItems = transcriptResponse.page?.items ?? [];
            finalSeen = includesToken(
              finalTranscriptItems,
              "SESSION_TRANSCRIPT_ITEM_KIND_AGENT_MESSAGE",
              finalToken,
            );
          } catch (error) {
            if (!isTransientLookupError(error)) {
              throw error;
            }
          }
        }

        const sample = await sampleVisibleTranscript(page, {
          baselineCount,
          promptToken,
          startedAt: submittedAt,
          status,
        });
        samples.push(sample);

        if (!firstAgentScreenshot && sample.agentTextLength > 0) {
          firstAgentScreenshot = true;
          await page.screenshot({
            fullPage: true,
            path: path.join(screenshotsDir, "first-visible-agent.png"),
          });
        }
        if (!midStreamScreenshot && sample.agentTextLength > 500) {
          midStreamScreenshot = true;
          await page.screenshot({
            fullPage: true,
            path: path.join(screenshotsDir, "mid-stream.png"),
          });
        }

        if (finalSeen && /COMPLETED|FAILED|DEGRADED/.test(status)) {
          break;
        }

        await Bun.sleep(100);
      }

      await page.screenshot({
        fullPage: true,
        path: path.join(screenshotsDir, "final.png"),
      });
    } finally {
      await browser.close();
      await collector.stop();
    }

    const sessionEvents = collector.events.filter(
      (event) => eventSessionId(event) === sessionId,
    );
    const draftEvents = sessionEvents.filter(
      (event) =>
        eventPatchKind(event) === "SESSION_LIVE_PATCH_KIND_DRAFT_DELTA",
    );
    const firstCompletionSample = samples.find((sample) =>
      /COMPLETED|FAILED|DEGRADED/.test(sample.status),
    );
    const preCompletionSamples = firstCompletionSample
      ? samples.filter(
          (sample) => sample.elapsedMs < firstCompletionSample.elapsedMs,
        )
      : samples;
    const firstAgentSample = samples.find(
      (sample) => sample.agentTextLength > 0,
    );
    const visibleAgentSamples = preCompletionSamples.filter(
      (sample) => sample.agentVisible && sample.agentTextLength > 0,
    );
    const thinkingOnlySamples = preCompletionSamples.filter(
      (sample) => sample.thinkingOnlyVisible,
    );

    traceSummary = readTraceSummary(sessionId);

    checks.push({
      name: "browser submitted gpt-5.4 XHigh follow-up",
      status:
        sendPayloads.some(
          (payload) =>
            typeof payload === "object" &&
            payload !== null &&
            (payload as { model?: string }).model === "gpt-5.4" &&
            (payload as { reasoningEffort?: string }).reasoningEffort ===
              "xhigh",
        )
          ? "pass"
          : "fail",
      detail: JSON.stringify(sendPayloads.at(0) ?? null),
    });
    checks.push({
      name: "app-server trace contains public answer deltas",
      status:
        traceSummary.present &&
        (traceSummary.counts["item/agentMessage/delta"] ?? 0) > 0
          ? "pass"
          : "fail",
      detail: traceSummary.present
        ? `${traceSummary.counts["item/agentMessage/delta"] ?? 0} item/agentMessage/delta events; payload text redacted in trace-summary.json`
        : `missing trace at ${traceSummary.path}`,
    });
    checks.push({
      name: "SSE draft delta patches captured",
      status: draftEvents.length > 0 ? "pass" : "fail",
      detail:
        draftEvents.length > 0
          ? `${draftEvents.length} draft patches; first at ${draftEvents[0]?.ts}, total draft chars=${draftEvents.reduce(
              (total, event) => total + eventDraftDeltaLength(event),
              0,
            )}`
          : "no draft delta patch captured for session",
    });
    checks.push({
      name: "visible transcript shows growing assistant output before completion",
      status:
        increasingAgentLengths(preCompletionSamples) >= 3 &&
        visibleAgentSamples.length > 0
          ? "pass"
          : "fail",
      detail: firstAgentSample
        ? `first agent sample ${firstAgentSample.elapsedMs}ms, unique pre-completion lengths=${increasingAgentLengths(
            preCompletionSamples,
          )}, visible agent samples=${visibleAgentSamples.length}`
        : "no assistant output row sampled before completion",
    });
    checks.push({
      name: "thinking-only state appears before first public answer delta",
      status:
        thinkingOnlySamples.length > 0 && firstAgentSample
          ? "pass"
          : "warn",
      detail:
        thinkingOnlySamples.length > 0 && firstAgentSample
          ? `${thinkingOnlySamples.length} thinking-only samples before first agent sample at ${firstAgentSample.elapsedMs}ms`
          : "run did not capture a distinct thinking-only phase",
    });
    checks.push({
      name: "final transcript contains submitted prompt and final assistant token",
      status:
        includesToken(
          finalTranscriptItems,
          "SESSION_TRANSCRIPT_ITEM_KIND_USER_MESSAGE",
          promptToken,
        ) &&
        includesToken(
          finalTranscriptItems,
          "SESSION_TRANSCRIPT_ITEM_KIND_AGENT_MESSAGE",
          finalToken,
        )
          ? "pass"
          : "fail",
      detail: `samples=${samples.length}`,
    });

    run.writeJson("context.json", {
      baseUrl: BASE_URL,
      ready,
      sendPayloads,
      sessionId,
      tracePath: traceSummary.path,
    });
    run.writeJson("samples.json", samples);
    run.writeJson("events.json", sessionEvents);
    run.writeJson("trace-summary.json", traceSummary);
  } catch (error) {
    checks.push({
      name: "session visible streaming validation",
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
    }
  }

  finish(run, checks, sessionId, samples);
}

function finish(
  run: ReturnType<typeof createValidationRun>,
  checks: ValidationCheck[],
  sessionId: string,
  samples: VisibleStreamingSample[],
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
    renderValidationSummary("Session visible streaming validation", checks, [
      "This validation creates a real Codex-backed session, submits a long follow-up through the browser composer, samples visible transcript rows while it runs, captures SSE live-patch metadata, and writes a payload-redacted app-server trace summary.",
    ]),
  );
  writeFileSync(
    path.resolve(
      REPO_ROOT,
      "storage/artifacts/validation/latest-session-visible-streaming.txt",
    ),
    `${run.rootDir}\n`,
  );
  console.log(`Session visible streaming evidence: ${run.rootDir}`);

  if (overallStatus !== "pass") {
    process.exitCode = 1;
  }
}

await main();
