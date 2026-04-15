import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, devices } from "playwright";

import { createFetchHandler } from "../src/server/bootstrap/create-fetch-handler.ts";
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
import { EventHub } from "../src/server/ws/event-hub.ts";
import { createValidationRun, runCommand } from "./lib/validation.ts";

async function main(): Promise<void> {
  const run = createValidationRun("web-shell");
  const build = await runCommand(["bun", "run", "build:web"], process.cwd());
  run.writeJson("commands/build-web.json", build);

  const tempRoot = mkdtempSync(path.join(tmpdir(), "orchd-web-shell-"));
  const repoPath = path.join(tempRoot, "repo");
  mkdirSync(path.join(repoPath, ".git"), { recursive: true });

  const config = loadConfig({
    cwd: process.cwd(),
    env: {
      ...process.env,
      ORCHD_STORAGE_DIR: tempRoot,
      ORCHD_ARTIFACTS_DIR: path.join(tempRoot, "artifacts"),
      ORCHD_AUTH_PASSWORD: "",
      ORCHD_PORT: "8794",
    },
  });

  const eventHub = new EventHub();
  const projectRepository = new ProjectRepository();
  const sessionRepository = new SessionRepository();
  const authRepository = new AuthSessionRepository();
  const codexDetectionService = new CodexDetectionService(config.codex.minVersion);
  const bindingService = new BindingService(projectRepository, eventHub);
  const authService = new AuthService(authRepository, config.auth.password, config.auth.sessionTtlDays);
  const hostHealthService = new HostHealthService(config, codexDetectionService, eventHub);
const hostFilesystemService = new HostFilesystemService(config, projectRepository);
  const backendSessionService = new BackendSessionService(config, projectRepository, sessionRepository, eventHub);

  const now = new Date().toISOString();
  const binding = projectRepository.create({
    id: crypto.randomUUID(),
    name: "template-snake",
    repoPath,
    hostId: config.server.hostId,
    defaultBackend: "codex",
    createdAt: now,
    updatedAt: now,
  });

  const session = sessionRepository.create({
    id: crypto.randomUUID(),
    projectId: binding.id,
    backend: "codex",
    backendSessionId: "thread-web-shell",
    title: "Build mobile reconnect flow",
    status: "waiting_approval",
    lastSummary: "Codex inspected the reconnect path and prepared a patch. Waiting on approval before it writes files.",
    attentionReason: "approval_required",
    degraded: false,
    lastEventAt: now,
    createdAt: now,
    updatedAt: now,
  });

  await backendSessionService.injectPendingApprovalForValidation(session.id);
  await (backendSessionService as any).applyPatch(session.id, {
    artifactText: {
      kind: "summary",
      label: "Session summary",
      content: "Codex is about to patch reconnect handling and add a defensive session shell update.",
    },
  });
  await (backendSessionService as any).applyPatch(session.id, {
    artifactText: {
      kind: "test_output",
      label: "Validation output",
      content: "PASS reconnect-banner\nPASS mobile-composer-shell\nPASS session-hierarchy",
    },
  });

  const { fetch, websocket } = createFetchHandler({
    config,
    authService,
    bindingService,
    backendSessionService,
    codexDetectionService,
    hostHealthService,
    hostFilesystemService,
    eventHub,
  });

  const server = Bun.serve({
    hostname: config.server.host,
    port: config.server.port,
    fetch,
    websocket,
  });
  const baseUrl = `http://${server.hostname}:${server.port}`;

  const browser = await chromium.launch();
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1024 } });
  const mobile = await browser.newContext({ ...devices["iPhone 13"] });

  const dashboard = await desktop.newPage();
  await dashboard.goto(baseUrl, { waitUntil: "networkidle" });
  await dashboard.screenshot({ path: path.join(run.rootDir, "screenshots/dashboard-desktop.png"), fullPage: true });

  const repoContext = await desktop.newPage();
  await repoContext.goto(`${baseUrl}/bindings/${binding.id}`, { waitUntil: "networkidle" });
  await repoContext.screenshot({ path: path.join(run.rootDir, "screenshots/repo-context-desktop.png"), fullPage: true });

  const addRepo = await desktop.newPage();
  await addRepo.goto(`${baseUrl}/bindings/new`, { waitUntil: "networkidle" });
  await addRepo.screenshot({ path: path.join(run.rootDir, "screenshots/add-repo-dialog.png"), fullPage: true });
  await addRepo.screenshot({ path: path.join(run.rootDir, "screenshots/add-repo-dialog-browsing.png"), fullPage: true });

  const sessionPage = await desktop.newPage();
  await sessionPage.goto(`${baseUrl}/backend-sessions/${session.id}`, { waitUntil: "networkidle" });
  await sessionPage.screenshot({ path: path.join(run.rootDir, "screenshots/session-desktop.png"), fullPage: true });

  const mobileSession = await mobile.newPage();
  await mobileSession.goto(`${baseUrl}/backend-sessions/${session.id}`, { waitUntil: "networkidle" });
  await mobileSession.screenshot({ path: path.join(run.rootDir, "screenshots/session-mobile.png"), fullPage: true });

  const mobileHome = await mobile.newPage();
  await mobileHome.goto(baseUrl, { waitUntil: "networkidle" });
  await mobileHome.getByRole("button", { name: "Open session navigation" }).click();
  await mobileHome.screenshot({ path: path.join(run.rootDir, "screenshots/mobile-drawer-open.png"), fullPage: true });

  run.writeJson("assertions/shell-ui.json", {
    dashboardHasHeader: await dashboard.getByRole("heading", { name: "Something needs you" }).first().isVisible(),
    dashboardHasNewSession: await dashboard.getByRole("button", { name: "New session" }).first().isVisible(),
    addRepoDialogVisible: await addRepo.getByText("Finder-style host browser").first().isVisible(),
    addRepoDialogHasBrowser: await addRepo.getByLabel("Selected path").isVisible(),
    sessionHasPendingApproval: await sessionPage.getByRole("button", { name: "Approve" }).isVisible(),
    sessionHasArtifacts: await sessionPage.getByRole("heading", { name: "Artifacts" }).isVisible(),
    sessionHasComposer: await sessionPage.getByRole("button", { name: "Send" }).isVisible(),
    mobileDrawerVisible: await mobileHome.getByText("Session-first remote Codex UI").first().isVisible(),
  });

  await browser.close();
  await backendSessionService.shutdown();
  server.stop(true);

  run.writeJson("summary.json", {
    runId: run.runId,
    screenshots: [
      "screenshots/dashboard-desktop.png",
      "screenshots/repo-context-desktop.png",
      "screenshots/add-repo-dialog.png",
      "screenshots/add-repo-dialog-browsing.png",
      "screenshots/session-desktop.png",
      "screenshots/session-mobile.png",
      "screenshots/mobile-drawer-open.png",
    ],
    assertions: ["assertions/shell-ui.json"],
  });

  writeFileSync(path.resolve(process.cwd(), "storage/artifacts/validation/latest-web-shell.txt"), `${run.rootDir}\n`);
  console.log(`web-shell validation evidence: ${run.rootDir}`);
}

await main();
