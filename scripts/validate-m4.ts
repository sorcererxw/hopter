import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { loadConfig } from "../src/server/config/load-config.ts";
import { ProjectRepository } from "../src/server/repositories/project-repository.ts";
import { SessionRepository } from "../src/server/repositories/session-repository.ts";
import { AuthSessionRepository } from "../src/server/repositories/auth-session-repository.ts";
import { BindingService } from "../src/server/services/binding-service.ts";
import { BackendSessionService } from "../src/server/services/backend-session-service.ts";
import { AuthService } from "../src/server/services/auth-service.ts";
import { CodexDetectionService } from "../src/server/services/codex-detection-service.ts";
import { HostHealthService } from "../src/server/services/host-health-service.ts";
import { EventHub } from "../src/server/ws/event-hub.ts";
import { createFetchHandler } from "../src/server/bootstrap/create-fetch-handler.ts";
import { createValidationRun, runCommand } from "./lib/validation.ts";

async function main(): Promise<void> {
  const run = createValidationRun("m4");
  await runCommand(["bun", "run", "build:web"], process.cwd());

  const tempRoot = mkdtempSync(path.join(tmpdir(), "orchd-m4-"));
  const repoPath = path.join(tempRoot, "repo");
  mkdirSync(path.join(repoPath, ".git"), { recursive: true });

  const eventHub = new EventHub();
  const config = loadConfig({
    cwd: process.cwd(),
    env: {
      ...process.env,
      ORCHD_STORAGE_DIR: tempRoot,
      ORCHD_ARTIFACTS_DIR: path.join(tempRoot, "artifacts"),
      ORCHD_AUTH_PASSWORD: "secret-pass",
      ORCHD_PORT: "8791",
      ORCHD_ACCESS_MODE: "self_managed_remote",
      ORCHD_TRUST_PROXY: "true",
    },
  });

  const projectRepository = new ProjectRepository();
  const sessionRepository = new SessionRepository();
  const authRepository = new AuthSessionRepository();
  const codexDetectionService = new CodexDetectionService(config.codex.minVersion);
  const bindingService = new BindingService(projectRepository, eventHub);
  const authService = new AuthService(authRepository, config.auth.password, config.auth.sessionTtlDays);
  const hostHealthService = new HostHealthService(config, codexDetectionService, eventHub);
  const backendSessionService = new BackendSessionService(config, projectRepository, sessionRepository, eventHub);

  const projectId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const now = new Date().toISOString();

  projectRepository.create({
    id: projectId,
    name: "restart-recovery-project",
    repoPath,
    hostId: config.server.hostId,
    defaultBackend: "codex",
    createdAt: now,
    updatedAt: now,
  });

  sessionRepository.create({
    id: sessionId,
    projectId,
    backend: "codex",
    backendSessionId: "missing-thread",
    title: "Recovered session",
    status: "degraded",
    lastSummary: "Pre-restart summary",
    attentionReason: "live_attachment_lost",
    degraded: true,
    lastEventAt: now,
    createdAt: now,
    updatedAt: now,
  });

  const { fetch: appFetch, websocket } = createFetchHandler({
    config,
    authService,
    bindingService,
    backendSessionService,
    codexDetectionService,
    hostHealthService,
    eventHub,
  });

  const server = Bun.serve({
    hostname: config.server.host,
    port: config.server.port,
    fetch: appFetch,
    websocket,
  });
  const baseUrl = `http://${server.hostname}:${server.port}`;

  const anonymousBindings = await fetch(`${baseUrl}/api/bindings`);
  run.writeJson("auth/anonymous-bindings.json", {
    status: anonymousBindings.status,
    body: await anonymousBindings.json(),
  });

  const badLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "wrong" }),
  });
  run.writeJson("auth/login-failure.json", {
    status: badLogin.status,
    body: await badLogin.json(),
  });

  const goodLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "secret-pass" }),
  });
  const loginCookie = goodLogin.headers.get("set-cookie")?.split(";")[0] ?? "";
  run.writeJson("auth/login-success.json", {
    status: goodLogin.status,
    body: await goodLogin.json(),
    setCookie: goodLogin.headers.get("set-cookie"),
  });

  const authMe = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { cookie: loginCookie },
  });
  run.writeJson("auth/me-authenticated.json", {
    status: authMe.status,
    body: await authMe.json(),
  });

  const degradedSession = await fetch(`${baseUrl}/api/backend-sessions/${sessionId}`, {
    headers: { cookie: loginCookie },
  });
  run.writeJson("recovery/session-degraded.json", {
    status: degradedSession.status,
    body: await degradedSession.json(),
  });

  const logout = await fetch(`${baseUrl}/api/auth/logout`, {
    method: "POST",
    headers: { cookie: loginCookie },
  });
  run.writeJson("auth/logout.json", {
    status: logout.status,
    body: await logout.json(),
  });

  const authMeAfterLogout = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { cookie: loginCookie },
  });
  run.writeJson("auth/me-after-logout.json", {
    status: authMeAfterLogout.status,
    body: await authMeAfterLogout.json(),
  });

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(run.rootDir, "screenshots/login-page.png"), fullPage: true });
  await page.getByLabel("Password").fill("secret-pass");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: path.join(run.rootDir, "screenshots/dashboard-authenticated.png"), fullPage: true });
  await page.goto(`${baseUrl}/backend-sessions/${sessionId}`, { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(run.rootDir, "screenshots/session-degraded.png"), fullPage: true });
  await browser.close();

  run.writeJson("summary.json", {
    runId: run.runId,
    authEvidence: [
      "auth/anonymous-bindings.json",
      "auth/login-failure.json",
      "auth/login-success.json",
      "auth/me-authenticated.json",
      "auth/logout.json",
      "auth/me-after-logout.json",
    ],
    degradedRecoveryEvidence: [
      "recovery/session-degraded.json",
      "screenshots/session-degraded.png",
    ],
  });

  await backendSessionService.shutdown();
  server.stop(true);
  writeFileSync(path.resolve(process.cwd(), "storage/artifacts/validation/latest-m4.txt"), `${run.rootDir}\n`);
  console.log(`M4 validation evidence: ${run.rootDir}`);
}

await main();
