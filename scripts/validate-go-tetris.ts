import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { chromium, type Page } from "playwright";

import { createValidationRun, runCommand } from "./lib/validation.ts";
import { combineValidationStatus, renderValidationSummary, type ValidationCheck } from "./lib/rebuild-validation.ts";

const PORT = 8787;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function createTempRepo(): string {
  const tempRoot = mkdtempSync(path.join(tmpdir(), "hopter-go-tetris-"));
  const repoPath = path.join(tempRoot, "repo");
  mkdirSync(repoPath, { recursive: true });
  execSync("git init -q", { cwd: repoPath });
  writeFileSync(path.join(repoPath, "README.md"), "# tetris demo\n");
  execSync("git add README.md && git commit -qm 'init'", { cwd: repoPath });
  return repoPath;
}

async function waitForHttp(url: string, timeoutMs = 20_000, intervalMs = 500): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return true;
      }
    } catch {}
    await Bun.sleep(intervalMs);
  }
  return false;
}

async function fillProject(page: Page, repoPath: string): Promise<void> {
  await page.goto("/projects/new", { waitUntil: "domcontentloaded" });
  await page.getByTestId("project-name-input").fill("tetris-demo");
  await page.getByTestId("project-root-input").fill(repoPath);
  await page.getByTestId("project-backend-input").fill("codex");
  await page.getByTestId("project-create-submit").click({ noWaitAfter: true });
  const started = Date.now();
  while (new URL(page.url()).pathname !== "/") {
    if (Date.now() - started > 20_000) {
      throw new Error("Timed out waiting to return to workspace after project creation");
    }
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(1_000);
}

async function createSession(page: Page): Promise<string> {
  await page.getByTestId("session-title-input").fill("Build Tetris");
  await page.getByTestId("session-prompt-input").fill(
    [
      "Create a self-contained browser Tetris game in a single index.html file in this repo root.",
      "Requirements: arrow keys move, up rotates, down soft drops, space hard drops, visible score, line clears, game over state, restart button, responsive layout, no external dependencies.",
      "When finished, summarize what you built.",
    ].join(" "),
  );
  await page.getByTestId("session-create-submit").click({ noWaitAfter: true });
  const started = Date.now();
  while (!new URL(page.url()).pathname.startsWith("/sessions/")) {
    if (Date.now() - started > 30_000) {
      throw new Error("Timed out waiting for the selected session route");
    }
    await page.waitForTimeout(200);
  }
  const match = page.url().match(/\/sessions\/([^/?#]+)/);
  if (!match) {
    throw new Error("Failed to extract session id from URL");
  }
  return match[1];
}

async function waitForSessionAndFile(page: Page, repoPath: string, runRoot: string): Promise<{
  summary: string;
  status: string;
  filePath: string;
}> {
  const filePath = path.join(repoPath, "index.html");
  let lastSummary = "";
  let lastStatus = "";

  for (let attempt = 0; attempt < 72; attempt += 1) {
    await page.waitForTimeout(5_000);
    await page.screenshot({ path: path.join(runRoot, `screenshots/session-${String(attempt).padStart(2, "0")}.png`), fullPage: true });

    lastSummary = (await page.getByTestId("session-summary").textContent())?.trim() ?? "";
    lastStatus = (await page.getByTestId("session-status").textContent())?.trim() ?? "";

    const terminalStatus = /completed|failed|degraded/.test(lastStatus.toLowerCase())
    if (existsSync(filePath) && terminalStatus && !lastSummary.includes("Timed out waiting for Codex turn completion")) {
      return {
        summary: lastSummary,
        status: lastStatus,
        filePath,
      };
    }
  }

  throw new Error(`Timed out waiting for Codex to produce ${filePath}`);
}

async function verifyTetrisArtifact(browser: import("playwright").Browser, filePath: string, runRoot: string): Promise<{ ok: boolean; details: Record<string, unknown> }> {
  const page = await browser.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(`file://${filePath}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1_500);
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(300);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(300);
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(300);
  await page.keyboard.press("Space");
  await page.waitForTimeout(800);

  await page.screenshot({ path: path.join(runRoot, "screenshots/tetris-artifact.png"), fullPage: true });

  const text = await page.textContent("body").catch(() => "");
  const html = readFileSync(filePath, "utf8");
  const hasCanvas = html.includes("<canvas");
  const hasTetrisWord = /tetris|score|lines|restart/i.test(`${text}\n${html}`);
  const ok = pageErrors.length === 0 && (hasCanvas || hasTetrisWord);

  await page.close();

  return {
    ok,
    details: {
      hasCanvas,
      hasTetrisWord,
      pageErrors,
    },
  };
}

async function requestRepair(page: Page, details: Record<string, unknown>, attempt: number) {
  await page.getByTestId("session-prompt-input").fill(
    `The generated Tetris still has runtime issues on load (attempt ${attempt}). Details: ${JSON.stringify(details)}. Please fix index.html so the game loads without JS errors and remains playable.`,
  )
  await page.getByTestId("session-followup-submit").click({ noWaitAfter: true })
}

async function main(): Promise<void> {
  const run = createValidationRun("go_tetris");
  const checks: ValidationCheck[] = [];

  const uiBuild = await runCommand(["pnpm", "--dir", "ui", "build"], process.cwd());
  run.writeJson("commands/ui-build.json", uiBuild);
  checks.push({
    name: "ui production build",
    status: uiBuild.exitCode === 0 ? "pass" : "fail",
    detail: uiBuild.exitCode === 0 ? "ui/dist built successfully" : (uiBuild.stderr || uiBuild.stdout || "ui build failed").trim(),
  });

  const buildDir = path.join(run.rootDir, "bin");
  mkdirSync(buildDir, { recursive: true });
  const binaryPath = path.join(buildDir, "hopter");
  const goBuild = await runCommand(["go", "build", "-o", binaryPath, "./cmd/hopter"], process.cwd());
  run.writeJson("commands/go-build.json", goBuild);
  checks.push({
    name: "go build ./cmd/hopter",
    status: goBuild.exitCode === 0 ? "pass" : "fail",
    detail: goBuild.exitCode === 0 ? `built ${binaryPath}` : (goBuild.stderr || goBuild.stdout || "go build failed").trim(),
  });

  if (uiBuild.exitCode !== 0 || goBuild.exitCode !== 0) {
    const overallStatus = combineValidationStatus(checks.map((check) => check.status));
    run.writeJson("report.json", { runId: run.runId, status: overallStatus, checks, baseUrl: BASE_URL });
    run.writeText("summary.md", renderValidationSummary("Go rebuild Tetris proof validation", checks, [
      "Both the Go binary and ui/dist must build before the browser-driven proof can run.",
    ]));
    writeFileSync(path.resolve(process.cwd(), "storage/artifacts/validation/latest-go-tetris.txt"), `${run.rootDir}\n`);
    console.log(`Go Tetris validation evidence: ${run.rootDir}`);
    process.exitCode = 1;
    return;
  }

  const repoPath = createTempRepo();
  run.writeText("repo-path.txt", `${repoPath}\n`);

  const server = Bun.spawn([binaryPath, "--host", "127.0.0.1", "--port", String(PORT)], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });

  try {
    const healthy = await waitForHttp(`${BASE_URL}/healthz`);
    checks.push({
      name: "Go origin health",
      status: healthy ? "pass" : "fail",
      detail: healthy ? "health returned 200" : "health probe failed",
    });

    if (!healthy) {
      throw new Error(`Go server failed to become healthy at ${BASE_URL}`);
    }

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ baseURL: BASE_URL });
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1_000);
      await page.screenshot({ path: path.join(run.rootDir, "screenshots/workspace-root.png"), fullPage: true });

      checks.push({
        name: "workspace shell selectors",
        status:
          (await page.getByTestId("session-list").isVisible()) &&
          (await page.getByTestId("session-composer").isVisible()) &&
          (await page.getByTestId("project-create-trigger").isVisible())
            ? "pass"
            : "fail",
        detail: "workspace shell rendered",
      });

      await fillProject(page, repoPath);
      checks.push({
        name: "project creation via UI",
        status: "pass",
        detail: "created project from /projects/new and returned to /",
      });

      const sessionId = await createSession(page);
      run.writeText("session-id.txt", `${sessionId}\n`);
      checks.push({
        name: "session creation via UI",
        status: "pass",
        detail: `navigated to /sessions/${sessionId} after submit`,
      });

      let sessionResult = await waitForSessionAndFile(page, repoPath, run.rootDir);
      run.writeJson("session-result.json", sessionResult);
      checks.push({
        name: "Codex produced Tetris artifact",
        status: existsSync(sessionResult.filePath) ? "pass" : "fail",
        detail: `${path.basename(sessionResult.filePath)} created with session summary: ${sessionResult.summary.slice(0, 120)}`,
      });

      let artifactCheck = await verifyTetrisArtifact(browser, sessionResult.filePath, run.rootDir);
      for (let attempt = 1; attempt <= 2 && !artifactCheck.ok; attempt += 1) {
        await requestRepair(page, artifactCheck.details, attempt)
        sessionResult = await waitForSessionAndFile(page, repoPath, run.rootDir)
        run.writeJson(`session-repair-${attempt}.json`, sessionResult)
        artifactCheck = await verifyTetrisArtifact(browser, sessionResult.filePath, run.rootDir)
      }

      run.writeJson("artifact-check.json", artifactCheck.details);
      checks.push({
        name: "generated Tetris artifact is browser-runnable",
        status: artifactCheck.ok ? "pass" : "fail",
        detail: artifactCheck.ok ? "artifact opened and responded to keyboard smoke input" : JSON.stringify(artifactCheck.details),
      });
    } finally {
      await browser.close();
    }
  } catch (error) {
    checks.push({
      name: "browser-driven Tetris proof",
      status: "fail",
      detail: error instanceof Error ? error.message : String(error),
    });
  } finally {
    server.kill();
    const killTimeout = setTimeout(() => {
      try {
        server.kill("SIGKILL");
      } catch {}
    }, 2_000);
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(server.stdout).text(),
      new Response(server.stderr).text(),
      server.exited,
    ]);
    clearTimeout(killTimeout);
    run.writeJson("commands/go-run.json", {
      command: [binaryPath],
      stdout,
      stderr,
      exitCode,
    });
  }

  const overallStatus = combineValidationStatus(checks.map((check) => check.status));
  run.writeJson("report.json", { runId: run.runId, status: overallStatus, checks, baseUrl: BASE_URL });
  run.writeText("summary.md", renderValidationSummary("Go rebuild Tetris proof validation", checks, [
    "This lane proves the browser can create a project, create a Codex-backed session, and reach a generated Tetris artifact.",
  ]));
  writeFileSync(path.resolve(process.cwd(), "storage/artifacts/validation/latest-go-tetris.txt"), `${run.rootDir}\n`);
  console.log(`Go Tetris validation evidence: ${run.rootDir}`);

  if (overallStatus !== "pass") {
    process.exitCode = 1;
  }
}

await main();
