import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { chromium } from "playwright";

import { createValidationRun, runCommand } from "./lib/validation.ts";
import {
  combineValidationStatus,
  renderValidationSummary,
  type ValidationCheck,
} from "./lib/rebuild-validation.ts";

const PACKAGE_PORT = 8896;
const DIRECT_PORT = 8897;
const DEV_PROXY_URL = "http://127.0.0.1:5173";

async function waitForHttp(
  url: string,
  timeoutMs = 20_000,
  intervalMs = 500
): Promise<boolean> {
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

function spawnServer(binaryPath: string, port: number) {
  return Bun.spawn([
    binaryPath,
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--dev-proxy-url",
    DEV_PROXY_URL,
  ], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });
}

async function main(): Promise<void> {
  const run = createValidationRun("update_ui");
  const checks: ValidationCheck[] = [];

  const uiBuild = await runCommand(["pnpm", "--dir", "ui", "build"], process.cwd());
  run.writeJson("commands/ui-build.json", uiBuild);
  checks.push({
    name: "ui build",
    status: uiBuild.exitCode === 0 ? "pass" : "fail",
    detail:
      uiBuild.exitCode === 0
        ? "ui/dist built successfully"
        : (uiBuild.stderr || uiBuild.stdout || "ui build failed").trim(),
  });

  const packageBinaryPath = path.join(run.rootDir, "bin", "hopter-package");
  const directBinaryPath = path.join(run.rootDir, "bin", "hopter-direct");
  const packageGoBuild = await runCommand(
    [
      "go",
      "build",
      "-ldflags",
      "-X main.installSource=homebrew_formula",
      "-o",
      packageBinaryPath,
      "./cmd/hopter",
    ],
    process.cwd()
  );
  run.writeJson("commands/go-build-package.json", packageGoBuild);
  checks.push({
    name: "go build package-managed binary",
    status: packageGoBuild.exitCode === 0 ? "pass" : "fail",
    detail:
      packageGoBuild.exitCode === 0
        ? `built ${packageBinaryPath}`
        : (packageGoBuild.stderr || packageGoBuild.stdout || "go build failed").trim(),
  });
  const directGoBuild = await runCommand(
    ["go", "build", "-ldflags", "-X main.installSource=direct", "-o", directBinaryPath, "./cmd/hopter"],
    process.cwd()
  );
  run.writeJson("commands/go-build-direct.json", directGoBuild);
  checks.push({
    name: "go build direct binary",
    status: directGoBuild.exitCode === 0 ? "pass" : "fail",
    detail:
      directGoBuild.exitCode === 0
        ? `built ${directBinaryPath}`
        : (directGoBuild.stderr || directGoBuild.stdout || "go build failed").trim(),
  });

  if (uiBuild.exitCode !== 0 || packageGoBuild.exitCode !== 0 || directGoBuild.exitCode !== 0) {
    const overallStatus = combineValidationStatus(checks.map((check) => check.status));
    run.writeJson("report.json", { runId: run.runId, status: overallStatus, checks });
    run.writeText("summary.md", renderValidationSummary("Update UI validation", checks));
    writeFileSync(
      path.resolve(process.cwd(), "storage/artifacts/validation/latest-update-ui.txt"),
      `${run.rootDir}\n`
    );
    console.log(`Update UI validation evidence: ${run.rootDir}`);
    process.exitCode = 1;
    return;
  }

  mkdirSync(path.join(run.rootDir, "screenshots"), { recursive: true });

  const packageServer = spawnServer(packageBinaryPath, PACKAGE_PORT);
  const directServer = spawnServer(directBinaryPath, DIRECT_PORT);

  try {
    const packageReady = await waitForHttp(`http://127.0.0.1:${PACKAGE_PORT}/healthz`);
    const directReady = await waitForHttp(`http://127.0.0.1:${DIRECT_PORT}/healthz`);
    checks.push({
      name: "package-managed server health",
      status: packageReady ? "pass" : "fail",
      detail: packageReady
        ? `http://127.0.0.1:${PACKAGE_PORT}/healthz returned 200`
        : "package-managed validation server did not become healthy",
    });
    checks.push({
      name: "direct server health",
      status: directReady ? "pass" : "fail",
      detail: directReady
        ? `http://127.0.0.1:${DIRECT_PORT}/healthz returned 200`
        : "direct validation server did not become healthy",
    });

    if (!packageReady || !directReady) {
      throw new Error("validation server did not become healthy");
    }

    const browser = await chromium.launch({ headless: true });
    try {
      const packagePage = await browser.newPage({
        baseURL: `http://127.0.0.1:${PACKAGE_PORT}`,
        viewport: { width: 1440, height: 900 },
      });
      await packagePage.goto("/", { waitUntil: "domcontentloaded" });
      await packagePage.waitForTimeout(2_000);

      const packageRailRow = packagePage.locator("[data-rail-row]").first();
      const packageUpdateButton = packageRailRow.getByRole("button", {
        name: /update/i,
      });
      await packageUpdateButton.click();
      await packagePage.getByText("Upgrade on host").waitFor({ timeout: 5_000 });
      await packagePage.screenshot({
        path: path.join(run.rootDir, "screenshots", "package-managed-update.png"),
        fullPage: true,
      });

      const packageCommandText = (
        await packagePage.getByText("brew upgrade hopter").textContent()
      )?.trim();
      checks.push({
        name: "package-managed update dialog",
        status: packageCommandText === "brew upgrade hopter" ? "pass" : "fail",
        detail: packageCommandText
          ? `dialog rendered command: ${packageCommandText}`
          : "package-managed dialog did not show brew command",
      });

      const directPage = await browser.newPage({
        baseURL: `http://127.0.0.1:${DIRECT_PORT}`,
        viewport: { width: 1440, height: 900 },
      });
      await directPage.goto("/", { waitUntil: "domcontentloaded" });
      await directPage.waitForTimeout(2_000);

      const directRailRow = directPage.locator("[data-rail-row]").first();
      const directUpdateButton = directRailRow.getByRole("button", {
        name: /update/i,
      });
      const directVisible = (await directUpdateButton.count()) > 0;
      await directPage.screenshot({
        path: path.join(run.rootDir, "screenshots", "direct-update-entry.png"),
        fullPage: true,
      });

      checks.push({
        name: "direct update entry visible",
        status: directVisible ? "pass" : "fail",
        detail: directVisible
          ? "direct install shows update affordance in top rail row"
          : "direct install did not render update affordance",
      });
    } finally {
      await browser.close();
    }
  } finally {
    packageServer.kill();
    directServer.kill();
    const [packageStdout, packageStderr, directStdout, directStderr] = await Promise.all([
      new Response(packageServer.stdout).text(),
      new Response(packageServer.stderr).text(),
      new Response(directServer.stdout).text(),
      new Response(directServer.stderr).text(),
    ]);
    run.writeText("server/package-managed-stdout.log", packageStdout);
    run.writeText("server/package-managed-stderr.log", packageStderr);
    run.writeText("server/direct-stdout.log", directStdout);
    run.writeText("server/direct-stderr.log", directStderr);
  }

  const overallStatus = combineValidationStatus(checks.map((check) => check.status));
  run.writeJson("report.json", { runId: run.runId, status: overallStatus, checks });
  run.writeText(
    "summary.md",
    renderValidationSummary("Update UI validation", checks, [
      "Screenshots capture the package-managed command dialog and the direct-install update entry in the top rail row.",
    ])
  );
  writeFileSync(
    path.resolve(process.cwd(), "storage/artifacts/validation/latest-update-ui.txt"),
    `${run.rootDir}\n`
  );
  console.log(`Update UI validation evidence: ${run.rootDir}`);

  if (overallStatus !== "pass") {
    process.exitCode = 1;
  }
}

await main();
