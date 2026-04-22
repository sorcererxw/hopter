import path from "node:path";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

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
};

type SessionMeta = {
  id: string;
  status: string;
  summary?: string;
  pendingApprovalId?: string;
  pending_approval_id?: string;
};

type TranscriptItem = {
  kind: string;
  body: string;
};

type WorkspaceEventEnvelope = {
  type?: string;
  sessionId?: string;
  session_id?: string;
  payload?: {
    summary?: string;
    sessionLivePatch?: {
      kind?: string;
      draftDelta?: string;
      draftItemId?: string;
      summary?: string;
      requiresRefetch?: boolean;
    };
    session_live_patch?: {
      kind?: string;
      draft_delta?: string;
      draft_item_id?: string;
      summary?: string;
      requires_refetch?: boolean;
    };
  };
};

type CapturedSSEEvent = {
  ts: string;
  event: string;
  rawData: string;
  parsed?: WorkspaceEventEnvelope;
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
  return rpc<{ page?: { items?: TranscriptItem[] } }>(
    "hopter.v1.SessionService",
    "ListSessionTranscript",
    {
      sessionId,
      limit: 200,
    }
  );
}

async function respondToApproval(
  sessionId: string,
  approvalId: string,
  decision: "APPROVAL_DECISION_APPROVE" | "APPROVAL_DECISION_REJECT"
) {
  return rpc(
    "hopter.v1.SessionService",
    "RespondToSessionApproval",
    {
      sessionId,
      approvalId,
      decision,
    }
  );
}

function includesToken(items: TranscriptItem[] | undefined, kind: string, token: string) {
  return (items ?? []).some((item) => item.kind === kind && item.body.includes(token));
}

function getLivePatchKind(event: WorkspaceEventEnvelope | undefined) {
  return (
    event?.payload?.sessionLivePatch?.kind ??
    event?.payload?.session_live_patch?.kind ??
    ""
  );
}

function getDraftDelta(event: WorkspaceEventEnvelope | undefined) {
  return (
    event?.payload?.sessionLivePatch?.draftDelta ??
    event?.payload?.session_live_patch?.draft_delta ??
    ""
  );
}

function requiresRefetch(event: WorkspaceEventEnvelope | undefined) {
  return Boolean(
    event?.payload?.sessionLivePatch?.requiresRefetch ??
      event?.payload?.session_live_patch?.requires_refetch
  );
}

function sessionIdFromEvent(event: WorkspaceEventEnvelope | undefined) {
  return event?.sessionId ?? event?.session_id ?? "";
}

function appServerTracePath(sessionId: string) {
  return path.resolve(REPO_ROOT, "storage", "runtime", "app-server-traces", `${sessionId}.jsonl`);
}

function copyTraceIfPresent(run: ReturnType<typeof createValidationRun>, relativePath: string, sessionId: string) {
  const tracePath = appServerTracePath(sessionId);
  if (!existsSync(tracePath)) {
    return false;
  }
  run.writeText(relativePath, readFileSync(tracePath, "utf8"));
  return true;
}

async function startSSECollector() {
  const controller = new AbortController();
  const events: CapturedSSEEvent[] = [];
  const startedAt = Date.now();

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
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");

      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const chunk = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const parsed = parseSSEChunk(chunk);
        if (parsed) {
          events.push(parsed);
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
  })();

  return {
    events,
    startedAt,
    async waitFor(
      predicate: (events: CapturedSSEEvent[]) => boolean,
      timeoutMs: number,
      label: string
    ) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (predicate(events)) {
          return;
        }
        await Bun.sleep(100);
      }
      throw new Error(`Timed out waiting for ${label}`);
    },
    async stop() {
      controller.abort();
      try {
        await streamPromise;
      } catch {
        // ignore abort noise
      }
    },
  };
}

function parseSSEChunk(chunk: string): CapturedSSEEvent | null {
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
    ts: new Date().toISOString(),
    event,
    rawData,
    parsed,
  };
}

async function waitForMeta(
  sessionId: string,
  predicate: (meta: SessionMeta | undefined) => boolean,
  timeoutMs: number,
  label: string
) {
  const deadline = Date.now() + timeoutMs;
  let lastMeta: SessionMeta | undefined;
  while (Date.now() < deadline) {
    lastMeta = (await getSessionMeta(sessionId)).session;
    if (predicate(lastMeta)) {
      return lastMeta;
    }
    await Bun.sleep(500);
  }
  throw new Error(
    `Timed out waiting for ${label}${lastMeta ? ` (last status: ${lastMeta.status})` : ""}`
  );
}

async function waitForTranscriptToken(
  sessionId: string,
  token: string,
  timeoutMs: number
) {
  const deadline = Date.now() + timeoutMs;
  let lastItems: TranscriptItem[] = [];
  while (Date.now() < deadline) {
    const transcript = await listTranscript(sessionId);
    lastItems = transcript.page?.items ?? [];
    if (includesToken(lastItems, "SESSION_TRANSCRIPT_ITEM_KIND_AGENT_MESSAGE", token)) {
      return lastItems;
    }
    await Bun.sleep(1000);
  }
  throw new Error(`Timed out waiting for transcript token ${token}. Last transcript size: ${lastItems.length}`);
}

async function main() {
  const run = createValidationRun("app_server_runtime");
  const checks: ValidationCheck[] = [];
  try {
    const projects = (await listProjects()).projects ?? [];
    const project =
      projects.find((candidate) => candidate.rootPath === REPO_ROOT) ?? projects[0];

    checks.push({
      name: "project lookup",
      status: project ? "pass" : "fail",
      detail: project ? `${project.name} (${project.rootPath})` : "no project available",
    });

    if (!project) {
      throw new Error("No project available for validation");
    }

    const collector = await startSSECollector();
    try {
      await collector.waitFor(
        (events) => events.some((event) => event.event === "ready"),
        10_000,
        "SSE ready event"
      );

      const streamToken = `STREAM-ACK-${Date.now()}`;
      const streamPrompt = [
        "Write 80 short lines.",
        `Each line must begin with STREAM-LIVE-${streamToken}- and a line number.`,
        `After the numbered lines, end with exactly ${streamToken}.`,
        "Do not use tools.",
      ].join(" ");

      const streamCreated = await createSession(
        project.id,
        streamPrompt,
        `stream validation ${new Date().toISOString()}`
      );
      const streamSessionId = streamCreated.session?.id;
      if (!streamSessionId) {
        throw new Error("stream validation session did not return an id");
      }

      await collector.waitFor(
        (events) =>
          events.some(
            (event) =>
              sessionIdFromEvent(event.parsed) === streamSessionId &&
              getLivePatchKind(event.parsed) === "SESSION_LIVE_PATCH_KIND_DRAFT_DELTA"
          ),
        90_000,
        "stream draft delta patch"
      );

      const firstDraftDelta = collector.events.find(
        (event) =>
          sessionIdFromEvent(event.parsed) === streamSessionId &&
          getLivePatchKind(event.parsed) === "SESSION_LIVE_PATCH_KIND_DRAFT_DELTA"
      );
      const firstSessionFetchAt = Date.now();
      const streamItems = await waitForTranscriptToken(streamSessionId, streamToken, 120_000);
      const streamEvents = collector.events.filter(
        (event) => sessionIdFromEvent(event.parsed) === streamSessionId
      );
      const finalizedEvent = streamEvents.find(
        (event) => getLivePatchKind(event.parsed) === "SESSION_LIVE_PATCH_KIND_MESSAGE_FINALIZED"
      );
      const reconcileEvent = streamEvents.find(
        (event) =>
          getLivePatchKind(event.parsed) === "SESSION_LIVE_PATCH_KIND_RECONCILE_REQUIRED" &&
          requiresRefetch(event.parsed)
      );

      run.writeJson("stream-session/events.json", streamEvents);
      run.writeJson("stream-session/transcript.json", streamItems);
      const streamTraceCopied = copyTraceIfPresent(run, "stream-session/app-server-trace.jsonl", streamSessionId);

      checks.push({
        name: "SSE draft delta arrives before transcript fetch",
        status:
          firstDraftDelta && Date.parse(firstDraftDelta.ts) <= firstSessionFetchAt
            ? "pass"
            : "fail",
        detail: firstDraftDelta
          ? `draft delta at ${firstDraftDelta.ts}, first fetch at ${new Date(firstSessionFetchAt).toISOString()}`
          : "no draft delta event captured",
      });
      checks.push({
        name: "finalized patch observed on SSE",
        status: finalizedEvent ? "pass" : "fail",
        detail: finalizedEvent ? finalizedEvent.ts : "no message_finalized patch captured",
      });
      checks.push({
        name: "reconcile patch observed on SSE",
        status: reconcileEvent ? "pass" : "fail",
        detail: reconcileEvent ? reconcileEvent.ts : "no reconcile_required patch captured",
      });
      checks.push({
        name: "reconciled transcript contains final stream token",
        status: includesToken(streamItems, "SESSION_TRANSCRIPT_ITEM_KIND_AGENT_MESSAGE", streamToken)
          ? "pass"
          : "fail",
        detail: includesToken(streamItems, "SESSION_TRANSCRIPT_ITEM_KIND_AGENT_MESSAGE", streamToken)
          ? streamToken
          : "final transcript missing stream token",
      });
      checks.push({
        name: "stream raw app-server trace captured",
        status: streamTraceCopied ? "pass" : "fail",
        detail: streamTraceCopied ? appServerTracePath(streamSessionId) : "trace file missing",
      });

      const approvalToken = `APPROVAL-ACK-${Date.now()}`;
      const approvalDoneToken = `APPROVAL-DONE-${approvalToken}`;
      const approvalRelativePath = `tmp/approval-validation-${approvalToken}.txt`;
      const approvalAbsolutePath = path.resolve(REPO_ROOT, approvalRelativePath);
      rmSync(approvalAbsolutePath, { force: true });

      const approvalPrompt = [
        `Use apply_patch or the file editing tool to create the file ${approvalRelativePath}.`,
        `The file must contain exactly one line: ${approvalToken}.`,
        "Do not merely describe the change. Actually make the file change.",
        `After the file has been created, reply with exactly ${approvalDoneToken}.`,
      ].join(" ");

      const approvalCreated = await createSession(
        project.id,
        approvalPrompt,
        `approval validation ${new Date().toISOString()}`
      );
      const approvalSessionId = approvalCreated.session?.id;
      if (!approvalSessionId) {
        throw new Error("approval validation session did not return an id");
      }

      let approvalMeta: SessionMeta | undefined;
      let approvalCompletedMeta: SessionMeta | undefined;
      let approvalItems: TranscriptItem[] = [];
      let approvalWaitError = "";
      let approvalId = "";

      try {
        approvalMeta = await waitForMeta(
          approvalSessionId,
          (meta) =>
            Boolean(
              meta &&
                meta.status === "SESSION_STATUS_WAITING_APPROVAL" &&
                (meta.pendingApprovalId || meta.pending_approval_id)
            ),
          90_000,
          "waiting approval state"
        );

        approvalId =
          approvalMeta.pendingApprovalId || approvalMeta.pending_approval_id || "";
        await respondToApproval(
          approvalSessionId,
          approvalId,
          "APPROVAL_DECISION_APPROVE"
        );

        approvalCompletedMeta = await waitForMeta(
          approvalSessionId,
          (meta) =>
            Boolean(
              meta &&
                /SESSION_STATUS_COMPLETED|SESSION_STATUS_RUNNING/.test(meta.status) &&
                !meta.pendingApprovalId &&
                !meta.pending_approval_id
            ),
          120_000,
          "approval session resume"
        );
        approvalItems = await waitForTranscriptToken(
          approvalSessionId,
          approvalDoneToken,
          120_000
        );
      } catch (error) {
        approvalWaitError = error instanceof Error ? error.message : String(error);
      }

      const approvalEvents = collector.events.filter(
        (event) => sessionIdFromEvent(event.parsed) === approvalSessionId
      );

      run.writeJson("approval-session/events.json", approvalEvents);
      run.writeJson("approval-session/meta.json", {
        waiting: approvalMeta,
        completed: approvalCompletedMeta,
        error: approvalWaitError,
      });
      run.writeJson("approval-session/transcript.json", approvalItems);
      const approvalTraceCopied = copyTraceIfPresent(run, "approval-session/app-server-trace.jsonl", approvalSessionId);

      let approvalServerRequestCount = 0;
      if (approvalTraceCopied) {
        approvalServerRequestCount = readFileSync(appServerTracePath(approvalSessionId), "utf8")
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as { kind?: string })
          .filter((entry) => entry.kind === "server_request").length;
      }

      checks.push({
        name: "approval request surfaced with stable approval id",
        status: approvalId ? "pass" : "fail",
        detail: approvalId || approvalWaitError || "pending approval id was empty",
      });
      checks.push({
        name: "approval round-trip completed",
        status:
          includesToken(approvalItems, "SESSION_TRANSCRIPT_ITEM_KIND_AGENT_MESSAGE", approvalDoneToken) &&
          includesToken(approvalItems, "SESSION_TRANSCRIPT_ITEM_KIND_FILE_CHANGE", approvalRelativePath)
            ? "pass"
            : "fail",
        detail:
          includesToken(approvalItems, "SESSION_TRANSCRIPT_ITEM_KIND_AGENT_MESSAGE", approvalDoneToken) &&
          includesToken(approvalItems, "SESSION_TRANSCRIPT_ITEM_KIND_FILE_CHANGE", approvalRelativePath)
            ? `${approvalDoneToken} after file change approval`
            : approvalWaitError || "file change or final approval acknowledgement missing",
      });
      checks.push({
        name: "approved file change materialized on disk",
        status:
          existsSync(approvalAbsolutePath) &&
          readFileSync(approvalAbsolutePath, "utf8").trim() === approvalToken
            ? "pass"
            : "fail",
        detail:
          existsSync(approvalAbsolutePath)
            ? approvalAbsolutePath
            : `${approvalAbsolutePath} was not created`,
      });
      checks.push({
        name: "approval raw app-server trace captured",
        status: approvalTraceCopied ? "pass" : "fail",
        detail: approvalTraceCopied ? appServerTracePath(approvalSessionId) : "trace file missing",
      });
      checks.push({
        name: "approval server request observed in raw trace",
        status: approvalServerRequestCount > 0 ? "pass" : "fail",
        detail: `server_request count = ${approvalServerRequestCount}`,
      });
      rmSync(approvalAbsolutePath, { force: true });
    } finally {
      await collector.stop();
    }
  } catch (error) {
    checks.push({
      name: "app-server runtime validation",
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
    renderValidationSummary("App-server runtime validation", checks, [
      "This lane proves that assistant draft deltas arrive over SSE, that approval requests round-trip through the protocol path, and that reconcile-required patches precede canonical transcript reads.",
    ])
  );
  writeFileSync(
    path.resolve(process.cwd(), "storage/artifacts/validation/latest-app-server-runtime.txt"),
    `${run.rootDir}\n`
  );
  console.log(`App-server runtime validation evidence: ${run.rootDir}`);

  if (overallStatus !== "pass") {
    process.exitCode = 1;
  }
}

await main();
