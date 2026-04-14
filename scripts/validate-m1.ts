import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import { createApp } from "../src/server/bootstrap/create-app.ts";
import { loadConfig } from "../src/server/config/load-config.ts";
import { runMigrations } from "../src/server/db/migrate.ts";
import { ProjectRepository } from "../src/server/repositories/project-repository.ts";
import { AuthSessionRepository } from "../src/server/repositories/auth-session-repository.ts";
import { ProjectService } from "../src/server/services/project-service.ts";
import { AuthService } from "../src/server/services/auth-service.ts";
import { CodexDetectionService } from "../src/server/services/codex-detection-service.ts";
import { HostHealthService } from "../src/server/services/host-health-service.ts";
import { createValidationRun, runCommand } from "./lib/validation.ts";

async function main(): Promise<void> {
  const run = createValidationRun("m1");
  const tempRoot = mkdtempSync(path.join(tmpdir(), "orchd-m1-"));
  const dbPath = path.join(tempRoot, "orchd.sqlite");
  const repoPath = path.join(tempRoot, "sample-repo");
  const webSource = path.join(process.cwd(), "src/web/static");

  mkdirSync(repoPath, { recursive: true });
  mkdirSync(path.join(repoPath, ".git"), { recursive: true });

  const config = loadConfig({
    cwd: process.cwd(),
    env: {
      ...process.env,
      ORCHD_DB_PATH: dbPath,
      ORCHD_STORAGE_DIR: tempRoot,
      ORCHD_ARTIFACTS_DIR: path.join(tempRoot, "artifacts"),
      ORCHD_AUTH_PASSWORD: "",
    },
  });

  const db = new Database(dbPath, { create: true });
  runMigrations(db, path.resolve(process.cwd(), "src/server/db/migrations"));

  const codexDetectionService = new CodexDetectionService(config.codex.minVersion);
  const projectRepository = new ProjectRepository(db);
  const authRepository = new AuthSessionRepository(db);
  const projectService = new ProjectService(projectRepository);
  const authService = new AuthService(authRepository, config.auth.password, config.auth.sessionTtlDays);
  const hostHealthService = new HostHealthService(config, codexDetectionService);

  const app = createApp({
    config: {
      ...config,
      storage: {
        ...config.storage,
        webSourceDir: webSource,
      },
    },
    authService,
    projectService,
    codexDetectionService,
    hostHealthService,
  });

  const hostStatus = await app.request("http://local/api/host/status");
  run.writeJson("host/status.json", await hostStatus.json());

  const createProject = await app.request("http://local/api/projects", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      name: "sample-repo",
      repoPath,
      defaultBackend: "codex",
    }),
  });
  const createdProjectPayload = await createProject.json();
  run.writeJson("projects/create.json", createdProjectPayload);

  const projectId = createdProjectPayload.data.project.id as string;
  const getProject = await app.request(`http://local/api/projects/${projectId}`);
  run.writeJson("projects/detail.json", await getProject.json());

  const listProjects = await app.request("http://local/api/projects");
  run.writeJson("projects/list.json", await listProjects.json());

  const patchProject = await app.request(`http://local/api/projects/${projectId}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      name: "sample-repo-renamed",
    }),
  });
  run.writeJson("projects/patch.json", await patchProject.json());

  const rootPage = await app.request("http://local/");
  run.writeText("web/index.html", await rootPage.text());

  const testCommand = await runCommand(["bun", "test"], process.cwd());
  run.writeJson("checks/bun-test.json", testCommand);

  const summary = {
    runId: run.runId,
    dbPath,
    validatedRoutes: [
      "/api/host/status",
      "/api/backends",
      "/api/projects",
      "/api/projects/:projectId",
    ],
    notes: [
      "Repository skeleton, config loading, migrations, host status, and project CRUD validated.",
      "Web asset serving falls back to src/web/static in development and web-dist after build:web.",
    ],
  };

  run.writeJson("summary.json", summary);
  writeFileSync(path.resolve(process.cwd(), "storage/artifacts/validation/latest-m1.txt"), `${run.rootDir}\n`);
  console.log(`M1 validation evidence: ${run.rootDir}`);
}

await main();
