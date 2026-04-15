import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createApp } from "../src/server/bootstrap/create-app.ts";
import { loadConfig } from "../src/server/config/load-config.ts";
import { AuthSessionRepository } from "../src/server/repositories/auth-session-repository.ts";
import { ProjectRepository } from "../src/server/repositories/project-repository.ts";
import { SessionRepository } from "../src/server/repositories/session-repository.ts";
import { AuthService } from "../src/server/services/auth-service.ts";
import { BackendSessionService } from "../src/server/services/backend-session-service.ts";
import { BindingService } from "../src/server/services/binding-service.ts";
import { CodexDetectionService } from "../src/server/services/codex-detection-service.ts";
import { HostHealthService } from "../src/server/services/host-health-service.ts";
import { HostFilesystemService } from "../src/server/services/host-filesystem-service.ts";
import { createValidationRun } from "./lib/validation.ts";

async function waitFor(fn: () => Promise<boolean>, timeoutMs = 120_000, intervalMs = 1_500): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await fn()) return;
    await Bun.sleep(intervalMs);
  }
  throw new Error(`Condition was not met within ${timeoutMs}ms`);
}

async function main(): Promise<void> {
  const run = createValidationRun("m2");
  const tempRoot = mkdtempSync(path.join(tmpdir(), "orchd-m2-"));
  const repoPath = path.join(tempRoot, "repo");
  mkdirSync(path.join(repoPath, ".git"), { recursive: true });

  const config = loadConfig({
    cwd: process.cwd(),
    env: {
      ...process.env,
      ORCHD_STORAGE_DIR: tempRoot,
      ORCHD_ARTIFACTS_DIR: path.join(tempRoot, "artifacts"),
      ORCHD_AUTH_PASSWORD: "",
    },
  });

  const projectRepository = new ProjectRepository();
  const sessionRepository = new SessionRepository();
  const authRepository = new AuthSessionRepository();
  const codexDetectionService = new CodexDetectionService(config.codex.minVersion);
  const bindingService = new BindingService(projectRepository);
  const authService = new AuthService(authRepository, config.auth.password, config.auth.sessionTtlDays);
  const hostHealthService = new HostHealthService(config, codexDetectionService);
  const hostFilesystemService = new HostFilesystemService(config, projectRepository);
  const backendSessionService = new BackendSessionService(config, projectRepository, sessionRepository);

  const app = createApp({
    config,
    authService,
    bindingService,
    backendSessionService,
    codexDetectionService,
    hostHealthService,
    hostFilesystemService,
  });

  const createdBinding = await app.request("http://local/api/bindings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "m2-repo",
      repoPath,
      defaultBackend: "codex",
    }),
  });
  const bindingPayload = await createdBinding.json() as { data: { binding: { id: string } } };
  const bindingId = bindingPayload.data.binding.id;
  run.writeJson("binding/create.json", bindingPayload);

  const summarySessionResponse = await app.request(`http://local/api/bindings/${bindingId}/backend-sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: "summary session",
      prompt: 'Reply with the exact text "SUMMARY_OK" and do not use any tools.',
    }),
  });
  const summarySessionPayload = await summarySessionResponse.json() as { data: { handle: { id: string } } };
  run.writeJson("session/create-summary.json", summarySessionPayload);
  const summarySessionId = summarySessionPayload.data.handle.id;

  await waitFor(async () => {
    const response = await app.request(`http://local/api/backend-sessions/${summarySessionId}`);
    const payload = await response.json() as { data: { latestSummary: string | null } };
    run.writeJson("session/summary-detail-latest.json", payload);
    return typeof payload.data.latestSummary === "string" && payload.data.latestSummary.includes("SUMMARY_OK");
  });

  run.writeJson("session/list.json", await (await app.request(`http://local/api/bindings/${bindingId}/backend-sessions`)).json());
  const summaryArtifactsPayload = await (await app.request(`http://local/api/backend-sessions/${summarySessionId}/artifacts`)).json() as { data: { items: Array<{ id: string }> } };
  run.writeJson("session/summary-artifacts.json", summaryArtifactsPayload);

  const firstArtifactId = summaryArtifactsPayload.data.items[0]?.id;
  if (!firstArtifactId) throw new Error("Expected at least one artifact for summary session");
  run.writeJson("session/summary-artifact-detail.json", await (await app.request(`http://local/api/artifacts/${firstArtifactId}`)).json());
  run.writeJson("session/attach.json", await (await app.request(`http://local/api/backend-sessions/${summarySessionId}/attach`, { method: "POST" })).json());

  run.writeJson("approval/create.json", {
    sessionId: summarySessionId,
    mode: "validation-hook",
    note: "Injecting a pending approval into a live session to deterministically validate API forwarding.",
  });
  await backendSessionService.injectPendingApprovalForValidation(summarySessionId);

  run.writeJson("approval/detail-pending.json", await (await app.request(`http://local/api/backend-sessions/${summarySessionId}`)).json());
  run.writeJson("approval/approve-1.json", await (await app.request(`http://local/api/backend-sessions/${summarySessionId}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision: "approve", note: null }),
  })).json());
  run.writeJson("approval/forwarded.json", backendSessionService.getValidationApprovalForward(summarySessionId));
  run.writeJson("approval/detail-complete.json", await (await app.request(`http://local/api/backend-sessions/${summarySessionId}`)).json());

  run.writeJson("summary.json", {
    runId: run.runId,
    sessionCreateAttachEvidence: ["session/create-summary.json", "session/attach.json"],
    rawToNormalizedEvidence: ["session/summary-detail-latest.json", "session/summary-artifacts.json", "approval/detail-pending.json"],
    approvalEvidence: ["approval/create.json", "approval/approve-1.json", "approval/forwarded.json", "approval/detail-complete.json"],
  });

  await backendSessionService.shutdown();
  writeFileSync(path.resolve(process.cwd(), "storage/artifacts/validation/latest-m2.txt"), `${run.rootDir}\n`);
  console.log(`M2 validation evidence: ${run.rootDir}`);
}

await main();
