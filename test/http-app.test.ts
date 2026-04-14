import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync } from "node:fs";
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

function makeTestApp() {
  const root = mkdtempSync(path.join(tmpdir(), "orchd-app-"));
  const db = new Database(path.join(root, "orchd.sqlite"), { create: true });
  runMigrations(db, path.resolve(process.cwd(), "src/server/db/migrations"));

  const config = loadConfig({
    cwd: process.cwd(),
    env: {
      ...process.env,
      ORCHD_STORAGE_DIR: root,
      ORCHD_DB_PATH: path.join(root, "orchd.sqlite"),
      ORCHD_ARTIFACTS_DIR: path.join(root, "artifacts"),
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

  return {
    root,
    config,
    app: createApp({
      config,
      authService,
      projectService,
      sessionService,
      codexDetectionService,
      hostHealthService,
    }),
  };
}

describe("http app", () => {
  test("returns host status and backend listing", async () => {
    const { app } = makeTestApp();

    const host = await app.request("http://local/api/host/status");
    const hostPayload = await host.json();
    expect(hostPayload.ok).toBe(true);
    expect(hostPayload.data.hostId).toBe("host_local");

    const backends = await app.request("http://local/api/backends");
    const backendsPayload = await backends.json();
    expect(backendsPayload.ok).toBe(true);
    expect(Array.isArray(backendsPayload.data)).toBe(true);
  });

  test("creates, lists, and reads projects", async () => {
    const { app, root } = makeTestApp();
    const repoPath = path.join(root, "repo");
    mkdirSync(path.join(repoPath, ".git"), { recursive: true });

    const created = await app.request("http://local/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "repo",
        repoPath,
        defaultBackend: "codex",
      }),
    });

    expect(created.status).toBe(201);
    const createdPayload = await created.json();
    expect(createdPayload.ok).toBe(true);
    const projectId = createdPayload.data.project.id;

    const listed = await app.request("http://local/api/projects");
    const listedPayload = await listed.json();
    expect(listedPayload.data.items).toHaveLength(1);

    const detail = await app.request(`http://local/api/projects/${projectId}`);
    const detailPayload = await detail.json();
    expect(detailPayload.data.project.repoPath).toBe(repoPath);
    expect(detailPayload.data.health.status).toBeDefined();
  });

  test("serves the static app shell", async () => {
    const { app } = makeTestApp();
    const response = await app.request("http://local/");
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("<div id=\"root\"></div>");
    expect(body).toContain("/main.js");
  });
});
