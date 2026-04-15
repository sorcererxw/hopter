import { execSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";

import { createValidationRun, runCommand } from "./lib/validation.ts";
import { combineValidationStatus, renderValidationSummary, type ValidationCheck } from "./lib/rebuild-validation.ts";

const PORT = Number.parseInt(process.env.ORCHD_PROJECT_PICKER_PORT?.trim() || "8890", 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;

type Fixture = {
  rootDir: string;
  workspaceDir: string;
  orgDir: string;
  repoDir: string;
  notesDir: string;
};

function createFixture(): Fixture {
  const tempRoot = mkdtempSync(path.join(tmpdir(), "orchd-project-picker-"));
  const workspaceDir = path.join(tempRoot, "workspace");
  const orgDir = path.join(workspaceDir, "example-org");
  const repoDir = path.join(orgDir, "demo-repo");
  const notesDir = path.join(orgDir, "notes");

  mkdirSync(repoDir, { recursive: true });
  mkdirSync(notesDir, { recursive: true });
  writeFileSync(path.join(notesDir, "ideas.md"), "not a git repo\n");

  execSync("git init -q", { cwd: repoDir });
  writeFileSync(path.join(repoDir, "README.md"), "# demo repo\n");
  execSync("git add README.md && git commit -qm 'init'", { cwd: repoDir });

  return {
    rootDir: realpathSync(tempRoot),
    workspaceDir: realpathSync(workspaceDir),
    orgDir: realpathSync(orgDir),
    repoDir: realpathSync(repoDir),
    notesDir: realpathSync(notesDir),
  };
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
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

async function main(): Promise<void> {
  const run = createValidationRun("project_picker");
  const checks: ValidationCheck[] = [];

  const uiBuild = await runCommand(["pnpm", "--dir", "ui", "build"], process.cwd());
  run.writeJson("commands/ui-build.json", uiBuild);
  checks.push({
    name: "ui build",
    status: uiBuild.exitCode === 0 ? "pass" : "fail",
    detail: uiBuild.exitCode === 0 ? "ui/dist built successfully" : (uiBuild.stderr || uiBuild.stdout || "ui build failed").trim(),
  });

  const goTest = await runCommand(["go", "test", "./..."], process.cwd());
  run.writeJson("commands/go-test.json", goTest);
  checks.push({
    name: "go test ./...",
    status: goTest.exitCode === 0 ? "pass" : "fail",
    detail: goTest.exitCode === 0 ? "Go packages passed" : (goTest.stderr || goTest.stdout || "go test failed").trim(),
  });

  const binaryDir = path.join(run.rootDir, "bin");
  mkdirSync(binaryDir, { recursive: true });
  const binaryPath = path.join(binaryDir, "orchd");
  const goBuild = await runCommand(["go", "build", "-o", binaryPath, "./cmd/orchd"], process.cwd());
  run.writeJson("commands/go-build.json", goBuild);
  checks.push({
    name: "go build ./cmd/orchd",
    status: goBuild.exitCode === 0 ? "pass" : "fail",
    detail: goBuild.exitCode === 0 ? `built ${binaryPath}` : (goBuild.stderr || goBuild.stdout || "go build failed").trim(),
  });

  if (uiBuild.exitCode !== 0 || goTest.exitCode !== 0 || goBuild.exitCode !== 0) {
    const overallStatus = combineValidationStatus(checks.map((check) => check.status));
    run.writeJson("report.json", { runId: run.runId, status: overallStatus, checks });
    run.writeText("summary.md", renderValidationSummary("Project picker validation", checks));
    writeFileSync(path.resolve(process.cwd(), "storage/artifacts/validation/latest-project-picker.txt"), `${run.rootDir}\n`);
    console.log(`Project picker validation evidence: ${run.rootDir}`);
    process.exitCode = 1;
    return;
  }

  const fixture = createFixture();
  run.writeJson("fixture.json", fixture);

  const serverEnv = {
    ...process.env,
    ORCHD_HOST: "127.0.0.1",
    ORCHD_PORT: String(PORT),
  };
  const server =
    typeof Bun !== "undefined"
      ? Bun.spawn([binaryPath], {
          cwd: process.cwd(),
          stdout: "pipe",
          stderr: "pipe",
          env: serverEnv,
        })
      : spawn(binaryPath, {
          cwd: process.cwd(),
          stdio: ["ignore", "pipe", "pipe"],
          env: serverEnv,
        });

  try {
    const healthy = await waitForHttp(`${BASE_URL}/healthz`);
    checks.push({
      name: "server health",
      status: healthy ? "pass" : "fail",
      detail: healthy ? `${BASE_URL}/healthz returned 200` : "health check did not become ready",
    });

    if (!healthy) {
      throw new Error(`server did not become healthy at ${BASE_URL}`);
    }

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ baseURL: BASE_URL, viewport: { width: 1600, height: 1000 } });
      const picker = page.getByTestId("project-picker-dialog");
      const pathInput = page.getByTestId("project-picker-path-input");

      await page.goto("/projects/new", { waitUntil: "domcontentloaded" });
      await picker.waitFor();
      await page.screenshot({ path: path.join(run.rootDir, "screenshots/01-initial-dialog.png"), fullPage: true });

      checks.push({
        name: "initial picker renders",
        status:
          (await picker.isVisible()) &&
          (await pathInput.isVisible()) &&
          (await page.getByTestId("project-picker-preview").isVisible())
            ? "pass"
            : "fail",
        detail: "dialog, path field, and preview pane are visible",
      });

      await pathInput.fill(fixture.orgDir);
      await pathInput.press("Enter");
      await page.getByRole("button", { name: /^demo-repo/ }).first().waitFor();
      await page.screenshot({ path: path.join(run.rootDir, "screenshots/02-multi-column-browser.png"), fullPage: true });

      const columnCount = await page.locator('[data-testid^="project-picker-column-"]').count();
      checks.push({
        name: "multi-column hierarchy",
        status: columnCount >= 3 ? "pass" : "fail",
        detail: `visible directory columns: ${columnCount}`,
      });

      await pathInput.fill(fixture.notesDir);
      await pathInput.press("Enter");
      await page.getByText("This folder is visible, but it is not a git repository yet.").waitFor();
      await page.screenshot({ path: path.join(run.rootDir, "screenshots/03-invalid-folder-state.png"), fullPage: true });

      checks.push({
        name: "invalid folder state",
        status:
          (await page.getByTestId("project-create-submit").isDisabled()) &&
          (await page.getByText("This folder is visible, but it is not a git repository yet.").isVisible())
            ? "pass"
            : "fail",
        detail: "non-repo folder keeps primary action disabled and explains why",
      });

      await pathInput.fill(fixture.repoDir);
      await pathInput.press("Enter");
      await page.getByText("Ready to open as a project.").waitFor();
      await page.screenshot({ path: path.join(run.rootDir, "screenshots/04-repo-selected.png"), fullPage: true });

      const autofilledName = await page.getByTestId("project-name-input").inputValue();
      const selectedPathValue = await pathInput.inputValue();
      checks.push({
        name: "repo preview metadata",
        status:
          autofilledName === "demo-repo" &&
          selectedPathValue === fixture.repoDir &&
          (await page.getByTestId("project-create-submit").isEnabled())
            ? "pass"
            : "fail",
        detail: `name field autofilled as ${autofilledName || "<empty>"} with path ${selectedPathValue}`,
      });

      await page.getByTestId("project-create-submit").evaluate((button) => {
        (button as HTMLButtonElement).click();
      });
      await page.waitForURL((url) => new URL(url).pathname === "/", { timeout: 20_000 });
      await page.screenshot({ path: path.join(run.rootDir, "screenshots/05-project-created.png"), fullPage: true });

      checks.push({
        name: "project creation flow",
        status:
          (await page.getByTestId("home-workspace-pane").isVisible()) &&
          (await page.getByText(/1 projects/).isVisible())
            ? "pass"
            : "fail",
        detail: "opening the selected repo returns to the workspace with the new project registered",
      });
    } finally {
      await browser.close();
    }
  } finally {
    server.kill();
    const [stdout, stderr] =
      typeof Bun !== "undefined"
        ? await Promise.all([
            new Response((server as Bun.Subprocess<"pipe", "pipe", "ignore">).stdout).text(),
            new Response((server as Bun.Subprocess<"pipe", "pipe", "ignore">).stderr).text(),
          ])
        : await Promise.all([
            new Promise<string>((resolve) => {
              let output = "";
              (server.stdout as NodeJS.ReadableStream).on("data", (chunk) => {
                output += chunk.toString();
              });
              (server.stdout as NodeJS.ReadableStream).on("end", () => resolve(output));
            }),
            new Promise<string>((resolve) => {
              let output = "";
              (server.stderr as NodeJS.ReadableStream).on("data", (chunk) => {
                output += chunk.toString();
              });
              (server.stderr as NodeJS.ReadableStream).on("end", () => resolve(output));
            }),
          ]);
    run.writeText("server/stdout.log", stdout);
    run.writeText("server/stderr.log", stderr);
  }

  const overallStatus = combineValidationStatus(checks.map((check) => check.status));
  run.writeJson("report.json", { runId: run.runId, status: overallStatus, checks });
  run.writeText("summary.md", renderValidationSummary("Project picker validation", checks, [
    "Screenshots capture the initial dialog, deep column navigation, invalid folder handling, repo-ready preview, and the post-create workspace state.",
  ]));
  writeFileSync(path.resolve(process.cwd(), "storage/artifacts/validation/latest-project-picker.txt"), `${run.rootDir}\n`);
  console.log(`Project picker validation evidence: ${run.rootDir}`);

  if (overallStatus !== "pass") {
    process.exitCode = 1;
  }
}

await main();
