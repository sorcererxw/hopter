import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, devices } from "playwright";
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
import { createValidationRun, runCommand } from "./lib/validation.ts";

async function main(): Promise<void> {
  const run = createValidationRun("m3");
  await runCommand(["bun", "run", "build:web"], process.cwd());

  const tempRoot = mkdtempSync(path.join(tmpdir(), "orchd-m3-"));
  const repoPath = path.join(tempRoot, "repo");
  mkdirSync(path.join(repoPath, ".git"), { recursive: true });

  const config = loadConfig({
    cwd: process.cwd(),
    env: {
      ...process.env,
      ORCHD_STORAGE_DIR: tempRoot,
      ORCHD_ARTIFACTS_DIR: path.join(tempRoot, "artifacts"),
      ORCHD_AUTH_PASSWORD: "",
      ORCHD_PORT: "8790",
    },
  });

  const projectRepository = new ProjectRepository();
  const sessionRepository = new SessionRepository();
  const authRepository = new AuthSessionRepository();
  const codexDetectionService = new CodexDetectionService(config.codex.minVersion);
  const bindingService = new BindingService(projectRepository);
  const authService = new AuthService(authRepository, config.auth.password, config.auth.sessionTtlDays);
  const hostHealthService = new HostHealthService(config, codexDetectionService);
  const backendSessionService = new BackendSessionService(config, projectRepository, sessionRepository);
  const app = createApp({
    config,
    authService,
    bindingService,
    backendSessionService,
    codexDetectionService,
    hostHealthService,
  });

  const now = new Date().toISOString();
  const bindingId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  projectRepository.create({
    id: bindingId,
    name: "m3-repo",
    repoPath,
    hostId: config.server.hostId,
    defaultBackend: "codex",
    createdAt: now,
    updatedAt: now,
  });
  sessionRepository.create({
    id: sessionId,
    projectId: bindingId,
    backend: "codex",
    backendSessionId: "thread-m3",
    title: "Dashboard proof session",
    status: "running",
    lastSummary: "SUMMARY_OK",
    attentionReason: null,
    degraded: false,
    lastEventAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await backendSessionService.injectPendingApprovalForValidation(sessionId);

  const server = Bun.serve({
    hostname: config.server.host,
    port: config.server.port,
    fetch: app.fetch,
  });
  const baseUrl = `http://${server.hostname}:${server.port}`;

  const browser = await chromium.launch();
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1024 } });
  const mobile = await browser.newContext({ ...devices["iPhone 13"] });

  const desktopDashboard = await desktop.newPage();
  await desktopDashboard.goto(baseUrl, { waitUntil: "networkidle" });
  await desktopDashboard.screenshot({ path: path.join(run.rootDir, "screenshots/dashboard-desktop.png"), fullPage: true });
  run.writeJson("assertions/dashboard-desktop.json", {
    attentionNow: await desktopDashboard.getByRole("heading", { name: "Attention now" }).isVisible(),
    bindings: await desktopDashboard.getByRole("heading", { name: "Bindings" }).isVisible(),
  });

  const desktopBinding = await desktop.newPage();
  await desktopBinding.goto(`${baseUrl}/bindings/${bindingId}`, { waitUntil: "networkidle" });
  await desktopBinding.screenshot({ path: path.join(run.rootDir, "screenshots/binding-desktop.png"), fullPage: true });

  const desktopSession = await desktop.newPage();
  await desktopSession.goto(`${baseUrl}/backend-sessions/${sessionId}`, { waitUntil: "networkidle" });
  await desktopSession.screenshot({ path: path.join(run.rootDir, "screenshots/session-desktop.png"), fullPage: true });

  const mobileSession = await mobile.newPage();
  await mobileSession.goto(`${baseUrl}/backend-sessions/${sessionId}`, { waitUntil: "networkidle" });
  await mobileSession.screenshot({ path: path.join(run.rootDir, "screenshots/session-mobile.png"), fullPage: true });

  run.writeJson("assertions/session.json", {
    statusVisible: await desktopSession.getByRole("heading", { name: "Status" }).isVisible(),
    summaryVisible: await desktopSession.getByRole("heading", { name: "Latest summary" }).isVisible(),
    attentionVisible: await desktopSession.getByRole("heading", { name: "Attention" }).isVisible(),
    artifactsVisible: await desktopSession.getByRole("heading", { name: "Artifacts" }).isVisible(),
    terminalVisible: await desktopSession.getByRole("heading", { name: "Terminal drawer" }).isVisible(),
  });

  await browser.close();
  await backendSessionService.shutdown();
  server.stop(true);

  run.writeJson("summary.json", {
    runId: run.runId,
    screenshotEvidence: [
      "screenshots/dashboard-desktop.png",
      "screenshots/binding-desktop.png",
      "screenshots/session-desktop.png",
      "screenshots/session-mobile.png",
    ],
    assertions: [
      "assertions/dashboard-desktop.json",
      "assertions/session.json",
    ],
  });

  writeFileSync(path.resolve(process.cwd(), "storage/artifacts/validation/latest-m3.txt"), `${run.rootDir}\n`);
  console.log(`M3 validation evidence: ${run.rootDir}`);
}

await main();
