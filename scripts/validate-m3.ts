import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, devices } from "playwright";
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
import { createValidationRun, runCommand } from "./lib/validation.ts";

async function waitFor(
  fn: () => Promise<boolean>,
  timeoutMs = 120_000,
  intervalMs = 1_000,
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
  const run = createValidationRun("m3");
  await runCommand(["bun", "run", "build:web"], process.cwd());

  const tempRoot = mkdtempSync(path.join(tmpdir(), "orchd-m3-"));
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
      ORCHD_PORT: "8790",
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

  const server = Bun.serve({
    hostname: config.server.host,
    port: config.server.port,
    fetch: app.fetch,
  });
  const baseUrl = `http://${server.hostname}:${server.port}`;

  const createProjectResponse = await fetch(`${baseUrl}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "m3-repo",
      repoPath,
      defaultBackend: "codex",
    }),
  });
  const projectPayload = await createProjectResponse.json() as { data: { project: { id: string } } };
  const projectId = projectPayload.data.project.id;
  run.writeJson("setup/project.json", projectPayload);

  const createSessionResponse = await fetch(`${baseUrl}/api/projects/${projectId}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: "Dashboard proof session",
      prompt: 'Reply with the exact text "SUMMARY_OK" and do not use any tools.',
    }),
  });
  const sessionPayload = await createSessionResponse.json() as { data: { session: { id: string } } };
  const sessionId = sessionPayload.data.session.id;
  run.writeJson("setup/session.json", sessionPayload);

  await waitFor(async () => {
    const response = await fetch(`${baseUrl}/api/sessions/${sessionId}`);
    const payload = await response.json() as { data: { latestSummary: string | null } };
    return payload.data.latestSummary?.includes("SUMMARY_OK") ?? false;
  });

  await sessionService.injectPendingApprovalForValidation(sessionId);

  const browser = await chromium.launch();
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1024 } });
  const mobile = await browser.newContext({ ...devices["iPhone 13"] });

  const desktopDashboard = await desktop.newPage();
  await desktopDashboard.goto(baseUrl, { waitUntil: "networkidle" });
  await desktopDashboard.screenshot({ path: path.join(run.rootDir, "screenshots/dashboard-desktop.png"), fullPage: true });
  run.writeJson("assertions/dashboard-desktop.json", {
    hostStatus: await desktopDashboard.getByRole("heading", { name: "Attention now" }).isVisible(),
    projects: await desktopDashboard.getByRole("heading", { name: "Projects" }).isVisible(),
  });

  const desktopProject = await desktop.newPage();
  await desktopProject.goto(`${baseUrl}/projects/${projectId}`, { waitUntil: "networkidle" });
  await desktopProject.screenshot({ path: path.join(run.rootDir, "screenshots/project-desktop.png"), fullPage: true });

  const desktopSession = await desktop.newPage();
  await desktopSession.goto(`${baseUrl}/sessions/${sessionId}`, { waitUntil: "networkidle" });
  await desktopSession.screenshot({ path: path.join(run.rootDir, "screenshots/session-desktop.png"), fullPage: true });

  const mobileSession = await mobile.newPage();
  await mobileSession.goto(`${baseUrl}/sessions/${sessionId}`, { waitUntil: "networkidle" });
  await mobileSession.screenshot({ path: path.join(run.rootDir, "screenshots/session-mobile.png"), fullPage: true });

  run.writeJson("assertions/session.json", {
    statusVisible: await desktopSession.getByRole("heading", { name: "Status" }).isVisible(),
    summaryVisible: await desktopSession.getByRole("heading", { name: "Latest summary" }).isVisible(),
    attentionVisible: await desktopSession.getByRole("heading", { name: "Attention" }).isVisible(),
    artifactsVisible: await desktopSession.getByRole("heading", { name: "Artifacts" }).isVisible(),
    terminalVisible: await desktopSession.getByRole("heading", { name: "Terminal drawer" }).isVisible(),
  });

  await browser.close();
  await sessionService.shutdown();
  server.stop(true);

  run.writeJson("summary.json", {
    runId: run.runId,
    screenshotEvidence: [
      "screenshots/dashboard-desktop.png",
      "screenshots/project-desktop.png",
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
