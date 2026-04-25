import path from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, type Page } from "playwright";

import { createValidationRun } from "./lib/validation.ts";
import {
  combineValidationStatus,
  renderValidationSummary,
  type ValidationCheck,
} from "./lib/rebuild-validation.ts";

const BASE_URL = "http://127.0.0.1:8787";
const REPO_ROOT = process.cwd();

type Project = {
  id: string;
  name: string;
  rootPath: string;
  defaultBackend?: string;
};

type SessionMeta = {
  id: string;
  status: string;
  summary?: string;
};

type TranscriptItem = {
  kind: string;
  body: string;
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
  return rpc<{ projects?: Project[] }>("hopter.v1.ProjectService", "ListProjects", {});
}

async function createSession(projectId: string, prompt: string, title: string) {
  return rpc<{ session?: { id: string } }>(
    "hopter.v1.SessionService",
    "CreateSession",
    {
      projectId,
      backendKey: "codex",
      prompt,
      title,
    }
  );
}

async function getSessionMeta(sessionId: string) {
  return rpc<{ session?: SessionMeta }>(
    "hopter.v1.SessionService",
    "GetSessionMeta",
    { sessionId }
  );
}

async function listTranscript(sessionId: string) {
  return rpc<{
    page?: {
      items?: TranscriptItem[];
    };
  }>("hopter.v1.SessionService", "ListSessionTranscript", {
    sessionId,
    limit: 200,
  });
}

function includesToken(items: TranscriptItem[] | undefined, kind: string, token: string) {
  return (items ?? []).some(
    (item) => item.kind === kind && item.body.includes(token)
  );
}

async function waitForTurn(sessionId: string, promptToken: string, replyToken: string, timeoutMs = 120_000) {
  const startedAt = Date.now();
  let lastError = "";
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const [meta, transcript] = await Promise.all([
        getSessionMeta(sessionId),
        listTranscript(sessionId),
      ]);
      const items = transcript.page?.items ?? [];
      const userSeen = includesToken(items, "SESSION_TRANSCRIPT_ITEM_KIND_USER_MESSAGE", promptToken);
      const agentSeen = includesToken(items, "SESSION_TRANSCRIPT_ITEM_KIND_AGENT_MESSAGE", replyToken);
      const status = meta.session?.status ?? "";

      if (userSeen && agentSeen && /COMPLETED|FAILED|DEGRADED/.test(status)) {
        return {
          agentSeen,
          status,
          summary: meta.session?.summary ?? "",
          userSeen,
        };
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await Bun.sleep(2_000);
  }

  throw new Error(`Timed out waiting for prompt ${promptToken} -> ${replyToken}${lastError ? ` (${lastError})` : ""}`);
}

async function sendRound(page: Page, sessionId: string, prompt: string, screenshotPath: string) {
  await page.goto(`/sessions/${sessionId}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="session-composer"]', { timeout: 20_000 });
  await page.getByTestId("session-prompt-input").fill(prompt);
  await page.getByTestId("session-followup-submit").click({ noWaitAfter: true });
  await page.screenshot({ path: screenshotPath, fullPage: true });
}

async function main() {
  const run = createValidationRun("session_roundtrip");
  const checks: ValidationCheck[] = [];
  mkdirSync(path.join(run.rootDir, "screenshots"), { recursive: true });

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
      throw new Error("No project available for roundtrip validation");
    }

    const initialReplyToken = `ROUND-0-ACK-${Date.now()}`;
    const created = await createSession(
      targetProject.id,
      `Reply with exactly ${initialReplyToken}.`,
      `Roundtrip validation ${new Date().toISOString()}`
    );
    const sessionId = created.session?.id;
    if (!sessionId) {
      throw new Error("SessionService.CreateSession did not return a session id");
    }

    run.writeText("session-id.txt", `${sessionId}\n`);

    const initialTurn = await waitForTurn(sessionId, "", initialReplyToken);
    checks.push({
      name: "initial session turn completed",
      status: initialTurn.agentSeen ? "pass" : "fail",
      detail: `${sessionId} -> ${initialTurn.status}`,
    });

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ baseURL: BASE_URL });
      const rounds: Array<{
        promptToken: string;
        replyToken: string;
        result?: Awaited<ReturnType<typeof waitForTurn>>;
      }> = [];

      for (let index = 1; index <= 4; index += 1) {
        const promptToken = `ROUND-${index}-PROMPT-${Date.now()}-${index}`;
        const replyToken = `ROUND-${index}-ACK-${Date.now()}-${index}`;
        const prompt = [
          `Round ${index}.`,
          `Acknowledge token: ${promptToken}.`,
          `Reply with exactly ${replyToken}.`,
        ].join(" ");

        await sendRound(
          page,
          sessionId,
          prompt,
          path.join(run.rootDir, "screenshots", `round-${index}.png`)
        );

        const result = await waitForTurn(sessionId, promptToken, replyToken);
        rounds.push({ promptToken, replyToken, result });
        checks.push({
          name: `follow-up round ${index}`,
          status: result.userSeen && result.agentSeen ? "pass" : "fail",
          detail: `${result.status} | ${replyToken}`,
        });
      }

      run.writeJson("rounds.json", rounds);
    } finally {
      await browser.close();
    }
  } catch (error) {
    checks.push({
      name: "session roundtrip validation",
      status: "fail",
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  const overallStatus = combineValidationStatus(checks.map((check) => check.status));
  run.writeJson("report.json", {
    runId: run.runId,
    status: overallStatus,
    checks,
    baseUrl: BASE_URL,
  });
  run.writeText(
    "summary.md",
    renderValidationSummary("Session roundtrip validation", checks, [
      "This lane verifies a fresh session can be created and then accept four follow-up composer sends through the browser UI.",
    ])
  );
  writeFileSync(
    path.resolve(process.cwd(), "storage/artifacts/validation/latest-session-roundtrip.txt"),
    `${run.rootDir}\n`
  );
  console.log(`Session roundtrip validation evidence: ${run.rootDir}`);

  if (overallStatus !== "pass") {
    process.exitCode = 1;
  }
}

await main();
