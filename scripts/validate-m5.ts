import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, devices } from "playwright";
import { Database } from "bun:sqlite";
import { loadConfig } from "../src/server/config/load-config.ts";
import { runMigrations } from "../src/server/db/migrate.ts";
import { ProjectRepository } from "../src/server/repositories/project-repository.ts";
import { SessionRepository } from "../src/server/repositories/session-repository.ts";
import { AuthSessionRepository } from "../src/server/repositories/auth-session-repository.ts";
import { ProjectService } from "../src/server/services/project-service.ts";
import { SessionService } from "../src/server/services/session-service.ts";
import { AuthService } from "../src/server/services/auth-service.ts";
import { CodexDetectionService } from "../src/server/services/codex-detection-service.ts";
import { HostHealthService } from "../src/server/services/host-health-service.ts";
import { EventHub } from "../src/server/ws/event-hub.ts";
import { createFetchHandler } from "../src/server/bootstrap/create-fetch-handler.ts";
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
  const run = createValidationRun("m5");
  await runCommand(["bun", "run", "build:web"], process.cwd());

  const tempRoot = mkdtempSync(path.join(tmpdir(), "orchd-m5-"));
  const repoPath = path.join(tempRoot, "repo");
  mkdirSync(path.join(repoPath, ".git"), { recursive: true });

  const dbPath = path.join(tempRoot, "orchd.sqlite");
  const db = new Database(dbPath, { create: true });
  runMigrations(db, path.resolve(process.cwd(), "src/server/db/migrations"));

  const eventHub = new EventHub();
  const config = loadConfig({
    cwd: process.cwd(),
    env: {
      ...process.env,
      ORCHD_STORAGE_DIR: tempRoot,
      ORCHD_DB_PATH: dbPath,
      ORCHD_ARTIFACTS_DIR: path.join(tempRoot, "artifacts"),
      ORCHD_PORT: "8792",
    },
  });

  const projectRepository = new ProjectRepository(db);
  const sessionRepository = new SessionRepository(db);
  const authRepository = new AuthSessionRepository(db);
  const codexDetectionService = new CodexDetectionService(config.codex.minVersion);
  const projectService = new ProjectService(projectRepository, eventHub);
  const authService = new AuthService(authRepository, config.auth.password, config.auth.sessionTtlDays);
  const hostHealthService = new HostHealthService(config, codexDetectionService, eventHub);
  const sessionService = new SessionService(config, projectRepository, sessionRepository, eventHub);

  const { fetch: appFetch, websocket } = createFetchHandler({
    config,
    authService,
    projectService,
    sessionService,
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

  const browser = await chromium.launch();
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1024 } });
  const mobile = await browser.newContext({ ...devices["iPhone 13"] });

  const page = await desktop.newPage();
  await page.goto(`${baseUrl}/projects/new`, { waitUntil: "networkidle" });
  await page.getByLabel("Name").fill("smoke-project");
  await page.getByLabel("Repo path").fill(repoPath);
  await page.getByRole("button", { name: "Create project" }).click();
  await page.waitForURL(/\/projects\//);
  await page.screenshot({ path: path.join(run.rootDir, "screenshots/e2e-project-created.png"), fullPage: true });

  await page.getByLabel("Title").fill("Smoke session");
  await page.getByLabel("Prompt").fill('Reply with the exact text "SUMMARY_OK" and do not use any tools.');
  await page.getByRole("button", { name: "Start session" }).click();
  await page.waitForURL(/\/sessions\//);
  const sessionId = page.url().split("/sessions/")[1]!;

  await waitFor(async () => {
    const detail = await fetch(`${baseUrl}/api/sessions/${sessionId}`).then((response) => response.json()) as { data: { latestSummary: string | null } };
    return detail.data.latestSummary?.includes("SUMMARY_OK") ?? false;
  });

  await page.reload({ waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(run.rootDir, "screenshots/e2e-session-summary.png"), fullPage: true });

  await sessionService.injectPendingApprovalForValidation(sessionId);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Approve" }).click();
  run.writeJson("e2e/approval-forwarded.json", sessionService.getValidationApprovalForward(sessionId));

  const validationTurnId = sessionService.injectActiveTurnForValidation(sessionId);
  await page.getByPlaceholder("Do not refactor unrelated files. Focus on reconnect handling.").fill("Follow-up input from mobile/browser.");
  await page.getByRole("button", { name: "Send input" }).click();
  await waitFor(async () => sessionService.getValidationSteerForward(sessionId) !== null, 10_000, 500);
  run.writeJson("e2e/input-forwarded.json", sessionService.getValidationSteerForward(sessionId));

  await page.getByRole("button", { name: "Interrupt" }).click();
  await waitFor(async () => sessionService.getValidationInterruptForward(sessionId) !== null, 10_000, 500);
  run.writeJson("e2e/interrupt-forwarded.json", sessionService.getValidationInterruptForward(sessionId));
  run.writeJson("e2e/turn-context.json", { validationTurnId });

  const mobilePage = await mobile.newPage();
  await mobilePage.goto(`${baseUrl}/sessions/${sessionId}`, { waitUntil: "networkidle" });
  await mobilePage.screenshot({ path: path.join(run.rootDir, "screenshots/session-mobile-actions.png"), fullPage: true });

  await desktop.setOffline(true);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(run.rootDir, "screenshots/session-reconnecting.png"), fullPage: true });
  await desktop.setOffline(false);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(run.rootDir, "screenshots/session-reconnected.png"), fullPage: true });

  await browser.close();
  await sessionService.shutdown();
  server.stop(true);

  const latestM0 = readFileSync(path.resolve(process.cwd(), "storage/artifacts/validation/latest-m0.txt"), "utf8").trim();
  const latestM1 = readFileSync(path.resolve(process.cwd(), "storage/artifacts/validation/latest-m1.txt"), "utf8").trim();
  const latestM2 = readFileSync(path.resolve(process.cwd(), "storage/artifacts/validation/latest-m2.txt"), "utf8").trim();
  const latestM3 = readFileSync(path.resolve(process.cwd(), "storage/artifacts/validation/latest-m3.txt"), "utf8").trim();
  const latestM4 = readFileSync(path.resolve(process.cwd(), "storage/artifacts/validation/latest-m4.txt"), "utf8").trim();

  run.writeJson("bundle/evidence-index.json", {
    latestM0,
    latestM1,
    latestM2,
    latestM3,
    latestM4,
    currentM5: run.rootDir,
  });

  run.writeJson("summary.json", {
    runId: run.runId,
    e2eEvidence: [
      "screenshots/e2e-project-created.png",
      "screenshots/e2e-session-summary.png",
      "e2e/approval-forwarded.json",
      "e2e/input-forwarded.json",
      "e2e/interrupt-forwarded.json",
      "screenshots/session-mobile-actions.png",
      "screenshots/session-reconnecting.png",
      "screenshots/session-reconnected.png",
    ],
    bundleEvidence: [
      "bundle/evidence-index.json",
    ],
  });

  writeFileSync(path.resolve(process.cwd(), "storage/artifacts/validation/latest-m5.txt"), `${run.rootDir}\n`);
  console.log(`M5 validation evidence: ${run.rootDir}`);
}

await main();
