import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import { createApp } from "../src/server/bootstrap/create-app.ts";
import { loadConfig } from "../src/server/config/load-config.ts";
import { runMigrations } from "../src/server/db/migrate.ts";
import { AuthSessionRepository } from "../src/server/repositories/auth-session-repository.ts";
import { ProjectRepository } from "../src/server/repositories/project-repository.ts";
import { SessionRepository } from "../src/server/repositories/session-repository.ts";
import { AuthService } from "../src/server/services/auth-service.ts";
import { CodexDetectionService } from "../src/server/services/codex-detection-service.ts";
import { HostHealthService } from "../src/server/services/host-health-service.ts";
import { ProjectService } from "../src/server/services/project-service.ts";
import { SessionService } from "../src/server/services/session-service.ts";
import { createValidationRun } from "./lib/validation.ts";

async function waitFor(
  fn: () => Promise<boolean>,
  timeoutMs = 120_000,
  intervalMs = 1_500,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await fn()) {
      return;
    }
    await Bun.sleep(intervalMs);
  }
  throw new Error(`Condition was not met within ${timeoutMs}ms`);
}

async function main(): Promise<void> {
  const run = createValidationRun("m2");
  const tempRoot = mkdtempSync(path.join(tmpdir(), "orchd-m2-"));
  const repoPath = path.join(tempRoot, "repo");
  mkdirSync(path.join(repoPath, ".git"), { recursive: true });

  const dbPath = path.join(tempRoot, "orchd.sqlite");
  const db = new Database(dbPath, { create: true });
  runMigrations(db, path.resolve(process.cwd(), "src/server/db/migrations"));

  const config = loadConfig({
    cwd: process.cwd(),
    env: {
      ...process.env,
      ORCHD_STORAGE_DIR: tempRoot,
      ORCHD_DB_PATH: dbPath,
      ORCHD_ARTIFACTS_DIR: path.join(tempRoot, "artifacts"),
      ORCHD_AUTH_PASSWORD: "",
    },
  });

  const projectRepository = new ProjectRepository(db);
  const sessionRepository = new SessionRepository(db);
  const authRepository = new AuthSessionRepository(db);
  const codexDetectionService = new CodexDetectionService(config.codex.minVersion);
  const projectService = new ProjectService(projectRepository);
  const authService = new AuthService(authRepository, config.auth.password, config.auth.sessionTtlDays);
  const hostHealthService = new HostHealthService(config, codexDetectionService);
  const sessionService = new SessionService(config, projectRepository, sessionRepository);

  const app = createApp({
    config,
    authService,
    projectService,
    sessionService,
    codexDetectionService,
    hostHealthService,
  });

  const createdProject = await app.request("http://local/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "m2-repo",
      repoPath,
      defaultBackend: "codex",
    }),
  });
  const projectPayload = await createdProject.json();
  const projectId = projectPayload.data.project.id as string;
  run.writeJson("project/create.json", projectPayload);

  const summarySessionResponse = await app.request(`http://local/api/projects/${projectId}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: "summary session",
      prompt: 'Reply with the exact text "SUMMARY_OK" and do not use any tools.',
    }),
  });
  const summarySessionPayload = await summarySessionResponse.json();
  run.writeJson("session/create-summary.json", summarySessionPayload);
  const summarySessionId = summarySessionPayload.data.session.id as string;

  await waitFor(async () => {
    const response = await app.request(`http://local/api/sessions/${summarySessionId}`);
    const payload = await response.json();
    run.writeJson("session/summary-detail-latest.json", payload);
    return typeof payload.data.latestSummary === "string" && payload.data.latestSummary.includes("SUMMARY_OK");
  });

  const listPayload = await (await app.request(`http://local/api/projects/${projectId}/sessions`)).json();
  run.writeJson("session/list.json", listPayload);

  const summaryArtifactsPayload = await (await app.request(`http://local/api/sessions/${summarySessionId}/artifacts`)).json();
  run.writeJson("session/summary-artifacts.json", summaryArtifactsPayload);

  const firstArtifactId = summaryArtifactsPayload.data.items[0]?.id as string | undefined;
  if (!firstArtifactId) {
    throw new Error("Expected at least one artifact for summary session");
  }
  const artifactDetailPayload = await (await app.request(`http://local/api/artifacts/${firstArtifactId}`)).json();
  run.writeJson("session/summary-artifact-detail.json", artifactDetailPayload);

  const attachPayload = await (await app.request(`http://local/api/sessions/${summarySessionId}/attach`, {
    method: "POST",
  })).json();
  run.writeJson("session/attach.json", attachPayload);

  run.writeJson("approval/create.json", {
    sessionId: summarySessionId,
    mode: "validation-hook",
    note: "Injecting a pending approval into a live session to deterministically validate API forwarding.",
  });
  await sessionService.injectPendingApprovalForValidation(summarySessionId);

  const pendingApprovalPayload = await (await app.request(`http://local/api/sessions/${summarySessionId}`)).json();
  run.writeJson("approval/detail-pending.json", pendingApprovalPayload);

  const approvedPayload = await (await app.request(`http://local/api/sessions/${summarySessionId}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      decision: "approve",
      note: null,
    }),
  })).json();
  run.writeJson("approval/approve-1.json", approvedPayload);

  const forwardedApproval = sessionService.getValidationApprovalForward(summarySessionId);
  run.writeJson("approval/forwarded.json", forwardedApproval);

  const completedApprovalPayload = await (await app.request(`http://local/api/sessions/${summarySessionId}`)).json();
  run.writeJson("approval/detail-complete.json", completedApprovalPayload);
  run.writeJson("summary.json", {
    runId: run.runId,
    sessionCreateAttachEvidence: [
      "session/create-summary.json",
      "session/attach.json",
    ],
    rawToNormalizedEvidence: [
      "session/summary-detail-latest.json",
      "session/summary-artifacts.json",
      "approval/detail-pending.json",
    ],
    approvalEvidence: [
      "approval/create.json",
      "approval/approve-1.json",
      "approval/forwarded.json",
      "approval/detail-complete.json",
    ],
  });

  await sessionService.shutdown();
  writeFileSync(path.resolve(process.cwd(), "storage/artifacts/validation/latest-m2.txt"), `${run.rootDir}\n`);
  console.log(`M2 validation evidence: ${run.rootDir}`);
}

await main();
