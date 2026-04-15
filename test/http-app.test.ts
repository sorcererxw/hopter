import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, realpathSync } from "node:fs";
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

function makeTestApp() {
  const root = mkdtempSync(path.join(tmpdir(), "orchd-app-"));

  const config = loadConfig({
    cwd: process.cwd(),
    env: {
      ...process.env,
      ORCHD_STORAGE_DIR: root,
      ORCHD_ARTIFACTS_DIR: path.join(root, "artifacts"),
      ORCHD_AUTH_PASSWORD: "",
      ORCHD_PROJECT_PATH_ALLOWLIST: root,
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

  return {
    root,
    config,
    app: createApp({
      config,
      authService,
      bindingService,
      backendSessionService,
      codexDetectionService,
      hostHealthService,
      hostFilesystemService,
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
    expect(hostPayload.data.storage.artifacts).toBe("healthy");

    const backends = await app.request("http://local/api/backends");
    const backendsPayload = await backends.json();
    expect(backendsPayload.ok).toBe(true);
    expect(Array.isArray(backendsPayload.data)).toBe(true);
  });

  test("creates, lists, and reads bindings", async () => {
    const { app, root } = makeTestApp();
    const repoPath = path.join(root, "repo");
    mkdirSync(path.join(repoPath, ".git"), { recursive: true });

    const created = await app.request("http://local/api/bindings", {
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
    const bindingId = createdPayload.data.binding.id;

    const listed = await app.request("http://local/api/bindings");
    const listedPayload = await listed.json();
    expect(listedPayload.data.items).toHaveLength(1);

    const detail = await app.request(`http://local/api/bindings/${bindingId}`);
    const detailPayload = await detail.json();
    expect(detailPayload.data.binding.repoPath).toBe(realpathSync(repoPath));
    expect(detailPayload.data.health.status).toBeDefined();
  });


  test("lists host filesystem roots and directories", async () => {
    const { app, root } = makeTestApp();
    const repoPath = path.join(root, "repo");
    const nested = path.join(repoPath, "nested");
    mkdirSync(path.join(repoPath, ".git"), { recursive: true });
    mkdirSync(nested, { recursive: true });

    const roots = await app.request("http://local/api/host/fs/roots");
    const rootsPayload = await roots.json();
    expect(rootsPayload.ok).toBe(true);
    expect(Array.isArray(rootsPayload.data.items)).toBe(true);

    const listing = await app.request(`http://local/api/host/fs/list?path=${encodeURIComponent(root)}`);
    const listingPayload = await listing.json();
    expect(listingPayload.ok).toBe(true);
    expect(listingPayload.data.currentPath).toBe(realpathSync(root));
    expect(listingPayload.data.entries.some((entry: { path: string; isRepo: boolean }) => entry.path === realpathSync(repoPath) && entry.isRepo)).toBe(true);

    const recent = await app.request("http://local/api/host/fs/recent-repos");
    const recentPayload = await recent.json();
    expect(recentPayload.ok).toBe(true);
    expect(Array.isArray(recentPayload.data.items)).toBe(true);
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
