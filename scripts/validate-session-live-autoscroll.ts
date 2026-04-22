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

type ScrollMetrics = {
  clientHeight: number;
  distanceFromBottom: number;
  scrollHeight: number;
  scrollTop: number;
};

type ScrollSample = ScrollMetrics & {
  assistantVisible: boolean;
  buttonVisible: boolean;
  elapsedMs: number;
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

async function scrollToTranscriptBottom(page: Page) {
  await page.getByTestId("session-transcript").evaluate((node) => {
    const container = findScrollContainer(node);
    container.scrollTop = container.scrollHeight;
    container.dispatchEvent(new Event("scroll", { bubbles: true }));

    function findScrollContainer(target: Element) {
      let current = target.parentElement as HTMLElement | null;
      while (current) {
        const style = window.getComputedStyle(current);
        if (style.overflowY === "auto" || style.overflowY === "scroll") {
          return current;
        }
        current = current.parentElement;
      }
      throw new Error("could not find transcript scroll container");
    }
  });
}

async function waitForTranscriptDistance(page: Page, maxDistance: number) {
  await page.waitForFunction(
    ([testId, max]) => {
      const node = document.querySelector(`[data-testid="${testId}"]`);
      if (!node) {
        return false;
      }
      const container = findScrollContainer(node);
      return (
        container.scrollHeight - container.scrollTop - container.clientHeight <=
        max
      );

      function findScrollContainer(target: Element) {
        let current = target.parentElement as HTMLElement | null;
        while (current) {
          const style = window.getComputedStyle(current);
          if (style.overflowY === "auto" || style.overflowY === "scroll") {
            return current;
          }
          current = current.parentElement;
        }
        throw new Error("could not find transcript scroll container");
      }
    },
    ["session-transcript", maxDistance],
    { timeout: 2_000 },
  );
}

async function sampleScroll(page: Page, input: {
  agentToken: string;
  startedAt: number;
  status: string;
}): Promise<ScrollSample> {
  return page.evaluate((args) => {
    const transcript = document.querySelector(
      '[data-testid="session-transcript"]',
    );
    if (!transcript) {
      throw new Error("session transcript not found");
    }
    const container = findScrollContainer(transcript);
    const latestButton = document.querySelector(
      'button[aria-label="Scroll to latest message"]',
    );
    const buttonStyle = latestButton
      ? window.getComputedStyle(latestButton)
      : undefined;
    const buttonVisible = Boolean(
      latestButton &&
        latestButton.getAttribute("aria-hidden") !== "true" &&
        buttonStyle &&
        buttonStyle.opacity !== "0" &&
        buttonStyle.pointerEvents !== "none",
    );

    return {
      assistantVisible: Boolean(
        Array.from(
          document.querySelectorAll('[data-testid="session-transcript-agent"]'),
        ).some((node) => node.textContent?.includes(args.agentToken)),
      ),
      buttonVisible,
      clientHeight: container.clientHeight,
      distanceFromBottom:
        container.scrollHeight - container.scrollTop - container.clientHeight,
      elapsedMs: Date.now() - args.startedAt,
      scrollHeight: container.scrollHeight,
      scrollTop: container.scrollTop,
      status: args.status,
      ts: new Date().toISOString(),
    };

    function findScrollContainer(target: Element) {
      let current = target.parentElement as HTMLElement | null;
      while (current) {
        const style = window.getComputedStyle(current);
        if (style.overflowY === "auto" || style.overflowY === "scroll") {
          return current;
        }
        current = current.parentElement;
      }
      throw new Error("could not find transcript scroll container");
    }
  }, input);
}

async function main() {
  const run = createValidationRun("session_live_autoscroll");
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

  const samples: ScrollSample[] = [];
  let sessionId = "";
  let finalStatus = "";
  let finalTranscriptItems: TranscriptItem[] = [];

  if (ready.health.ok) {
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
        throw new Error("No project available for live auto-scroll validation");
      }

      const baselineToken = `AUTO-SCROLL-BASELINE-${Date.now()}`;
      const created = await createSession(
        targetProject.id,
        `Reply with exactly ${baselineToken}.`,
        `Live auto-scroll validation ${new Date().toISOString()}`,
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

      const promptToken = `AUTO-SCROLL-PROMPT-${Date.now()}`;
      const agentToken = `AUTO-SCROLL-AGENT-${Date.now()}`;
      const finalToken = `AUTO-SCROLL-FINAL-${Date.now()}`;
      const followUpPrompt = [
        `${promptToken}.`,
        `Write 140 numbered lines. Every line must include ${agentToken}.`,
        `End with exactly ${finalToken}.`,
        "Do not use tools.",
      ].join(" ");

      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage({
          baseURL: BASE_URL,
          viewport: { width: 1440, height: 1024 },
        });

        await page.goto(`/sessions/${sessionId}`, {
          waitUntil: "domcontentloaded",
        });
        await page.waitForSelector('[data-testid="session-composer"]', {
          timeout: 20_000,
        });
        await page.waitForSelector('[data-testid="session-transcript"]', {
          timeout: 20_000,
        });
        await scrollToTranscriptBottom(page);
        await waitForTranscriptDistance(page, 24);
        await page.screenshot({
          fullPage: true,
          path: path.join(screenshotsDir, "before-submit.png"),
        });

        await page.getByTestId("session-prompt-input").fill(followUpPrompt);
        const startedAt = Date.now();
        await page
          .getByTestId("session-followup-submit")
          .click({ noWaitAfter: true });
        await page.screenshot({
          fullPage: true,
          path: path.join(screenshotsDir, "after-submit.png"),
        });

        let finalSeen = false;
        const deadline = Date.now() + 240_000;
        while (Date.now() < deadline) {
          if (samples.length % 5 === 0) {
            try {
              const [metaResponse, transcriptResponse] = await Promise.all([
                getSessionMeta(sessionId),
                listTranscript(sessionId),
              ]);
              finalStatus = metaResponse.session?.status ?? "";
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

          samples.push(
            await sampleScroll(page, {
              agentToken,
              startedAt,
              status: finalStatus,
            }),
          );

          if (finalSeen && /COMPLETED|FAILED|DEGRADED/.test(finalStatus)) {
            break;
          }

          await Bun.sleep(150);
        }

        await page.screenshot({
          fullPage: true,
          path: path.join(screenshotsDir, "final.png"),
        });
      } finally {
        await browser.close();
      }

      const finalSample = samples.at(-1);
      const maxVisibleDistance = Math.max(
        0,
        ...samples
          .filter((sample) => sample.assistantVisible)
          .map((sample) => sample.distanceFromBottom),
      );
      const sawVisibleButton = samples.some(
        (sample) => sample.assistantVisible && sample.buttonVisible,
      );
      const finalPinned = Boolean(
        finalSample && finalSample.distanceFromBottom <= 160 && !finalSample.buttonVisible,
      );

      checks.push({
        name: "streaming assistant sampled",
        status: samples.some((sample) => sample.assistantVisible)
          ? "pass"
          : "fail",
        detail: `samples=${samples.length}`,
      });
      checks.push({
        name: "live transcript stayed pinned to latest",
        status: finalPinned && !sawVisibleButton ? "pass" : "fail",
        detail: `finalDistance=${finalSample?.distanceFromBottom ?? "missing"}, maxVisibleDistance=${maxVisibleDistance}, sawButton=${sawVisibleButton}`,
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
        detail: `status=${finalStatus}`,
      });
    } catch (error) {
      checks.push({
        name: "live auto-scroll scenario",
        status: "fail",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const overallStatus = combineValidationStatus(
    checks.map((check) => check.status),
  );
  run.writeJson("report.json", {
    checks,
    runId: run.runId,
    samples: {
      count: samples.length,
      first: samples[0],
      final: samples.at(-1),
      maxVisibleDistance: Math.max(
        0,
        ...samples
          .filter((sample) => sample.assistantVisible)
          .map((sample) => sample.distanceFromBottom),
      ),
    },
    sessionId,
    status: overallStatus,
  });
  run.writeJson("samples.json", samples);
  run.writeText(
    "summary.md",
    renderValidationSummary("Live session auto-scroll validation", checks, [
      "This validation creates a real Codex-backed session, submits a long follow-up through the browser composer, and samples the session transcript scroll container while the assistant streams.",
    ]),
  );
  writeFileSync(
    path.resolve(
      REPO_ROOT,
      "storage/artifacts/validation/latest-session-live-autoscroll.txt",
    ),
    `${run.rootDir}\n`,
  );
  console.log(`Live session auto-scroll evidence: ${run.rootDir}`);

  if (overallStatus !== "pass") {
    process.exitCode = 1;
  }
}

await main();
