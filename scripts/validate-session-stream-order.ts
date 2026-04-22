import { mkdirSync, writeFileSync } from "node:fs";
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

type TranscriptEntrySample = {
  domIndex: number;
  testId: string;
  text: string;
};

type TranscriptOrderSample = {
  agentIndex: number;
  elapsedMs: number;
  entries: TranscriptEntrySample[];
  promptIndex: number;
  status: string;
  ts: string;
};

async function rpc<T>(service: string, method: string, body: unknown): Promise<T> {
  const response = await fetch(`${BASE_URL}/rpc/${service}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
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
      reasoningEffort: "low",
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
    {
      limit: 200,
      sessionId,
    },
  );
}

function isTransientLookupError(error: unknown) {
  return error instanceof Error && /returned 404/.test(error.message);
}

function includesToken(items: TranscriptItem[] | undefined, kind: string, token: string) {
  return (items ?? []).some(
    (item) => item.kind === kind && item.body.includes(token),
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

async function sampleTranscriptOrder(
  page: Page,
  input: {
    agentToken: string;
    baselineCount: number;
    promptToken: string;
    startedAt: number;
    status: string;
  },
) {
  return page.evaluate((args): TranscriptOrderSample => {
    const normalize = (value: string) => value.trim().replace(/\s+/g, " ");
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
        ) ?? tested[0];

      return {
        domIndex,
        testId: primary?.dataset.testid ?? "",
        text: normalize(row.textContent ?? ""),
      };
    });

    const promptIndex =
      entries.find(
        (entry) =>
          (entry.testId === "session-transcript-user" ||
            entry.testId === "session-transcript-pending") &&
          entry.text.includes(args.promptToken),
      )?.domIndex ?? -1;
    const tokenAgentIndex =
      entries.find(
        (entry) =>
          entry.testId === "session-transcript-agent" &&
          entry.text.includes(args.agentToken),
      )?.domIndex ?? -1;
    const anyNewAgentIndex =
      entries.find(
        (entry) =>
          entry.testId === "session-transcript-agent" &&
          entry.domIndex >= args.baselineCount,
      )?.domIndex ?? -1;

    return {
      agentIndex: tokenAgentIndex >= 0 ? tokenAgentIndex : anyNewAgentIndex,
      elapsedMs: Date.now() - args.startedAt,
      entries,
      promptIndex,
      status: args.status,
      ts: new Date().toISOString(),
    };
  }, input);
}

async function main() {
  const run = createValidationRun("session_stream_order");
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
    const overallStatus = combineValidationStatus(
      checks.map((check) => check.status),
    );
    run.writeJson("report.json", { checks, state: ready.state, status: overallStatus });
    run.writeText(
      "summary.md",
      renderValidationSummary("Session stream order validation", checks),
    );
    writeFileSync(
      path.resolve(
        REPO_ROOT,
        "storage/artifacts/validation/latest-session-stream-order.txt",
      ),
      `${run.rootDir}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const samples: TranscriptOrderSample[] = [];
  const sendPayloads: unknown[] = [];
  let sessionId = "";
  let violation: TranscriptOrderSample | undefined;

  try {
    const projectResponse = await listProjects();
    const projects = projectResponse.projects ?? [];
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
      throw new Error("No project available for stream order validation");
    }

    const initialReplyToken = `ORDER-BASELINE-ACK-${Date.now()}`;
    const created = await createSession(
      targetProject.id,
      `Reply with exactly ${initialReplyToken}.`,
      `Stream order validation ${new Date().toISOString()}`,
    );
    sessionId = created.session?.id ?? "";
    if (!sessionId) {
      throw new Error("SessionService.CreateSession did not return a session id");
    }

    const initialStatus = await waitForInitialTurn(sessionId, initialReplyToken);
    checks.push({
      name: "baseline turn completed",
      status: "pass",
      detail: `${sessionId} -> ${initialStatus}`,
    });

    const promptToken = `ORDER-PROMPT-${Date.now()}`;
    const agentToken = `ORDER-AGENT-${Date.now()}`;
    const finalToken = `ORDER-FINAL-${Date.now()}`;
    const followUpPrompt = [
      `${promptToken}.`,
      "Use reasoning effort XHigh for this browser-submitted follow-up.",
      `Write 120 numbered lines. The first line must start with ${agentToken}.`,
      `Every line should include ${agentToken}.`,
      `After the numbered lines, end with exactly ${finalToken}.`,
      "Do not use tools.",
    ].join(" ");

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        baseURL: BASE_URL,
        viewport: { width: 1440, height: 1024 },
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
      const startedAt = Date.now();
      await page.getByTestId("session-followup-submit").click({ noWaitAfter: true });
      await page.screenshot({
        fullPage: true,
        path: path.join(screenshotsDir, "after-submit.png"),
      });

      let status = "";
      let finalTranscriptItems: TranscriptItem[] = [];
      let finalSeen = false;
      const deadline = Date.now() + 240_000;

      while (Date.now() < deadline) {
        if (samples.length % 10 === 0) {
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

        const sample = await sampleTranscriptOrder(page, {
          agentToken,
          baselineCount,
          promptToken,
          startedAt,
          status,
        });
        samples.push(sample);

        if (
          !violation &&
          sample.agentIndex >= 0 &&
          sample.promptIndex >= 0 &&
          sample.agentIndex < sample.promptIndex
        ) {
          violation = sample;
          await page.screenshot({
            fullPage: true,
            path: path.join(screenshotsDir, "ordering-violation.png"),
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

      checks.push({
        name: "browser submitted XHigh follow-up",
        status:
          sendPayloads.some(
            (payload) =>
              typeof payload === "object" &&
              payload !== null &&
              "reasoningEffort" in payload &&
              (payload as { reasoningEffort?: string }).reasoningEffort ===
                "xhigh",
          )
            ? "pass"
            : "fail",
        detail: JSON.stringify(sendPayloads.at(0) ?? null),
      });

      checks.push({
        name: "streaming overlap sampled",
        status:
          samples.some(
            (sample) => sample.promptIndex >= 0 && sample.agentIndex >= 0,
          )
            ? "pass"
            : "fail",
        detail: `samples=${samples.length}`,
      });

      checks.push({
        name: "assistant never rendered above submitted prompt",
        status: violation ? "fail" : "pass",
        detail: violation
          ? `agent index ${violation.agentIndex} before prompt index ${violation.promptIndex} at ${violation.elapsedMs}ms`
          : "no sampled DOM frame placed the streaming assistant before the submitted prompt",
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
        detail: `status=${status}`,
      });
    } finally {
      await browser.close();
    }

    run.writeJson("context.json", {
      baseUrl: BASE_URL,
      ready,
      sendPayloads,
      sessionId,
    });
    run.writeJson("samples.json", samples);
    if (violation) {
      run.writeJson("violation.json", violation);
    }
  } catch (error) {
    checks.push({
      name: "session stream order validation",
      status: "fail",
      detail: error instanceof Error ? error.message : String(error),
    });
    run.writeJson("samples.json", samples);
    if (violation) {
      run.writeJson("violation.json", violation);
    }
  }

  const overallStatus = combineValidationStatus(
    checks.map((check) => check.status),
  );
  run.writeJson("report.json", {
    checks,
    runId: run.runId,
    sessionId,
    status: overallStatus,
  });
  run.writeText(
    "summary.md",
    renderValidationSummary("Session stream order validation", checks, [
      "This validation creates a real Codex-backed session, submits a long follow-up through the browser composer, and samples transcript DOM order while the assistant streams.",
    ]),
  );
  writeFileSync(
    path.resolve(
      REPO_ROOT,
      "storage/artifacts/validation/latest-session-stream-order.txt",
    ),
    `${run.rootDir}\n`,
  );
  console.log(`Session stream order evidence: ${run.rootDir}`);

  if (overallStatus !== "pass") {
    process.exitCode = 1;
  }
}

await main();
