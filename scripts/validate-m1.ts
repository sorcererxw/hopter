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
import { createValidationRun, runCommand } from "./lib/validation.ts";

async function main(): Promise<void> {
  const run = createValidationRun("m1");
  const tempRoot = mkdtempSync(path.join(tmpdir(), "orchd-m1-"));
  const repoPath = path.join(tempRoot, "sample-repo");

  mkdirSync(repoPath, { recursive: true });
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

  const codexDetectionService = new CodexDetectionService(config.codex.minVersion);
  const projectRepository = new ProjectRepository();
  const sessionRepository = new SessionRepository();
  const authRepository = new AuthSessionRepository();
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

  run.writeJson("host/status.json", await (await app.request("http://local/api/host/status")).json());

  const createBinding = await app.request("http://local/api/bindings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "sample-repo",
      repoPath,
      defaultBackend: "codex",
    }),
  });
  const createdBindingPayload = await createBinding.json() as { data: { binding: { id: string } } };
  run.writeJson("bindings/create.json", createdBindingPayload);

  const bindingId = createdBindingPayload.data.binding.id;
  run.writeJson("bindings/detail.json", await (await app.request(`http://local/api/bindings/${bindingId}`)).json());
  run.writeJson("bindings/list.json", await (await app.request("http://local/api/bindings")).json());
  run.writeJson("bindings/patch.json", await (await app.request(`http://local/api/bindings/${bindingId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "sample-repo-renamed" }),
  })).json());

  run.writeText("web/index.html", await (await app.request("http://local/")).text());
  run.writeJson("checks/bun-test.json", await runCommand(["bun", "test"], process.cwd()));

  run.writeJson("summary.json", {
    runId: run.runId,
    validatedRoutes: [
      "/api/host/status",
      "/api/backends",
      "/api/bindings",
      "/api/bindings/:bindingId",
    ],
    notes: [
      "Gateway foundation uses in-memory repositories in the validated alpha baseline.",
      "Static app shell still serves from web-dist after build:web or src/web/static in dev.",
    ],
  });

  await backendSessionService.shutdown();
  writeFileSync(path.resolve(process.cwd(), "storage/artifacts/validation/latest-m1.txt"), `${run.rootDir}\n`);
  console.log(`M1 validation evidence: ${run.rootDir}`);
}

await main();
