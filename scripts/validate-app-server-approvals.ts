import path from "node:path";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

import { createValidationRun } from "./lib/validation.ts";
import {
  combineValidationStatus,
  renderValidationSummary,
  type ValidationCheck,
  type ValidationStatus,
} from "./lib/rebuild-validation.ts";

const BASE_URL = process.env.HOPTER_BASE_URL?.trim() || "http://127.0.0.1:8787";
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

type ProbeResult = {
  sessionId: string;
  metaSnapshots: SessionMeta[];
  transcriptItems: TranscriptItem[];
  tracePath: string;
  serverRequestCount: number;
  serverRequestMethods: string[];
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

function tracePathForSession(sessionId: string) {
  return path.resolve(REPO_ROOT, "storage", "runtime", "app-server-traces", `${sessionId}.jsonl`);
}

function readTraceSummary(tracePath: string) {
  const serverRequestMethods: string[] = [];
  if (!existsSync(tracePath)) {
    return { serverRequestCount: 0, serverRequestMethods };
  }

  for (const line of readFileSync(tracePath, "utf8").split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const entry = JSON.parse(line) as { kind?: string; method?: string };
    if (entry.kind === "server_request") {
      serverRequestMethods.push(entry.method ?? "");
    }
  }

  return {
    serverRequestCount: serverRequestMethods.length,
    serverRequestMethods,
  };
}

function includesToken(items: TranscriptItem[] | undefined, kind: string, token: string) {
  return (items ?? []).some((item) => item.kind === kind && item.body.includes(token));
}

async function runProbe(
  project: Project,
  title: string,
  prompt: string,
  finalToken: string,
  timeoutMs = 120_000
): Promise<ProbeResult> {
  const created = await createSession(project.id, prompt, title);
  const sessionId = created.session?.id;
  if (!sessionId) {
    throw new Error(`${title}: session id missing`);
  }

  const metaSnapshots: SessionMeta[] = [];
  const deadline = Date.now() + timeoutMs;
  let transcriptItems: TranscriptItem[] = [];
  let lastError = "";

  while (Date.now() < deadline) {
    try {
      const [metaResponse, transcriptResponse] = await Promise.all([
        getSessionMeta(sessionId),
        listTranscript(sessionId),
      ]);
      const meta = metaResponse.session;
      if (meta) {
        metaSnapshots.push(meta);
      }
      transcriptItems = transcriptResponse.page?.items ?? [];

      if (includesToken(transcriptItems, "SESSION_TRANSCRIPT_ITEM_KIND_AGENT_MESSAGE", finalToken)) {
        const tracePath = tracePathForSession(sessionId);
        const trace = readTraceSummary(tracePath);
        return {
          sessionId,
          metaSnapshots,
          transcriptItems,
          tracePath,
          serverRequestCount: trace.serverRequestCount,
          serverRequestMethods: trace.serverRequestMethods,
        };
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await Bun.sleep(500);
  }

  throw new Error(`${title}: timed out waiting for ${finalToken}${lastError ? ` (${lastError})` : ""}`);
}

function waitingApprovalSeen(metaSnapshots: SessionMeta[]) {
  return metaSnapshots.some(
    (meta) =>
      meta.status === "SESSION_STATUS_WAITING_APPROVAL" &&
      Boolean(meta.pendingApprovalId || meta.pending_approval_id)
  );
}

async function main() {
  const run = createValidationRun("app_server_approvals");
  const checks: ValidationCheck[] = [];

  const projects = (await listProjects()).projects ?? [];
  const project =
    projects.find((candidate) => candidate.rootPath === REPO_ROOT) ?? projects[0];

  checks.push({
    name: "project lookup",
    status: project ? "pass" : "fail",
    detail: project ? `${project.name} (${project.rootPath})` : "no project available",
  });

  if (!project) {
    throw new Error("No project available for approval probes");
  }

  const commandToken = `CMD-ACK-${Date.now()}`;
  const commandInputPath = path.resolve(REPO_ROOT, `tmp/approval-command-${commandToken}.txt`);
  writeFileSync(commandInputPath, `${commandToken}\n`);
  const commandRelativePath = path.relative(REPO_ROOT, commandInputPath);
  const commandPrompt = [
    `Use the shell tool to read the file ${commandRelativePath}.`,
    "Do not guess. Use a command execution tool.",
    `Reply with exactly ${commandToken}.`,
  ].join(" ");

  const commandResult = await runProbe(
    project,
    `approval command probe ${new Date().toISOString()}`,
    commandPrompt,
    commandToken
  );
  run.writeJson("command/meta.json", commandResult.metaSnapshots);
  run.writeJson("command/transcript.json", commandResult.transcriptItems);
  if (existsSync(commandResult.tracePath)) {
    run.writeText("command/app-server-trace.jsonl", readFileSync(commandResult.tracePath, "utf8"));
  }

  checks.push({
    name: "command probe produced command execution transcript",
    status: includesToken(commandResult.transcriptItems, "SESSION_TRANSCRIPT_ITEM_KIND_COMMAND_EXECUTION", commandRelativePath)
      ? "pass"
      : "fail",
    detail: commandRelativePath,
  });
  checks.push({
    name: "command probe surfaced waiting approval state",
    status: waitingApprovalSeen(commandResult.metaSnapshots) ? "pass" : "fail",
    detail: waitingApprovalSeen(commandResult.metaSnapshots)
      ? "waiting approval observed in session meta"
      : "session never entered waiting_approval",
  });
  checks.push({
    name: "command probe raw server request observed",
    status: commandResult.serverRequestCount > 0 ? "pass" : "fail",
    detail: `server_request count = ${commandResult.serverRequestCount}${commandResult.serverRequestMethods.length ? ` (${commandResult.serverRequestMethods.join(", ")})` : ""}`,
  });

  const fileToken = `FILE-ACK-${Date.now()}`;
  const fileDoneToken = `FILE-DONE-${fileToken}`;
  const fileRelativePath = `tmp/approval-file-${fileToken}.txt`;
  const fileAbsolutePath = path.resolve(REPO_ROOT, fileRelativePath);
  rmSync(fileAbsolutePath, { force: true });
  const filePrompt = [
    `Use apply_patch or the file editing tool to create the file ${fileRelativePath}.`,
    `The file must contain exactly one line: ${fileToken}.`,
    "Do not merely describe the change. Actually write the file.",
    `After the file has been created, reply with exactly ${fileDoneToken}.`,
  ].join(" ");

  const fileResult = await runProbe(
    project,
    `approval file probe ${new Date().toISOString()}`,
    filePrompt,
    fileDoneToken
  );
  run.writeJson("file/meta.json", fileResult.metaSnapshots);
  run.writeJson("file/transcript.json", fileResult.transcriptItems);
  if (existsSync(fileResult.tracePath)) {
    run.writeText("file/app-server-trace.jsonl", readFileSync(fileResult.tracePath, "utf8"));
  }

  checks.push({
    name: "file probe materialized change on disk",
    status:
      existsSync(fileAbsolutePath) &&
      readFileSync(fileAbsolutePath, "utf8").trim() === fileToken
        ? "pass"
        : "fail",
    detail:
      existsSync(fileAbsolutePath)
        ? fileAbsolutePath
        : `${fileAbsolutePath} was not created`,
  });
  checks.push({
    name: "file probe produced file change transcript",
    status: includesToken(fileResult.transcriptItems, "SESSION_TRANSCRIPT_ITEM_KIND_FILE_CHANGE", fileRelativePath)
      ? "pass"
      : "fail",
    detail: fileRelativePath,
  });
  checks.push({
    name: "file probe surfaced waiting approval state",
    status: waitingApprovalSeen(fileResult.metaSnapshots) ? "pass" : "fail",
    detail: waitingApprovalSeen(fileResult.metaSnapshots)
      ? "waiting approval observed in session meta"
      : "session never entered waiting_approval",
  });
  checks.push({
    name: "file probe raw server request observed",
    status: fileResult.serverRequestCount > 0 ? "pass" : "fail",
    detail: `server_request count = ${fileResult.serverRequestCount}${fileResult.serverRequestMethods.length ? ` (${fileResult.serverRequestMethods.join(", ")})` : ""}`,
  });

  const permissionStatus: ValidationStatus = "blocked";
  checks.push({
    name: "permissions probe",
    status: permissionStatus,
    detail:
      "Current runtime hardcodes danger-full-access sandbox, so permission-specific approval prompts cannot be honestly exercised in this lane.",
  });

  rmSync(fileAbsolutePath, { force: true });
  rmSync(commandInputPath, { force: true });

  const overallStatus = combineValidationStatus(checks.map((check) => check.status));
  run.writeJson("report.json", {
    runId: run.runId,
    status: overallStatus,
    checks,
    baseUrl: BASE_URL,
  });
  run.writeText(
    "summary.md",
    renderValidationSummary("App-server approval probes", checks, [
      "This lane isolates command-execution and file-change approval behavior and inspects both session meta transitions and raw app-server server_request traces.",
    ])
  );
  writeFileSync(
    path.resolve(process.cwd(), "storage/artifacts/validation/latest-app-server-approvals.txt"),
    `${run.rootDir}\n`
  );
  console.log(`App-server approval validation evidence: ${run.rootDir}`);

  if (overallStatus !== "pass") {
    process.exitCode = 1;
  }
}

await main();
