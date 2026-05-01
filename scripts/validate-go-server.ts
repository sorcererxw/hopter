import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createValidationRun, runCommand } from "./lib/validation.ts";
import { checkRequiredPaths, combineValidationStatus, renderValidationSummary, type ValidationCheck } from "./lib/rebuild-validation.ts";

const serverPort = "8787";
const serverBaseUrl = `http://127.0.0.1:${serverPort}`;
const HEALTH_URL = `${serverBaseUrl}/healthz`;
const READY_URL = `${serverBaseUrl}/readyz`;

async function waitForHttp(url: string, timeoutMs = 20_000, intervalMs = 500): Promise<{ ok: boolean; status?: number; body?: string; error?: string }> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      const body = await response.text();
      return { ok: response.ok, status: response.status, body };
    } catch (error) {
      await Bun.sleep(intervalMs);
      if (Date.now() - started >= timeoutMs) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  }
  return { ok: false, error: `Timed out waiting for ${url}` };
}

async function main(): Promise<void> {
  const run = createValidationRun("go_server");
  const checks: ValidationCheck[] = [];

  const required = checkRequiredPaths(["go.mod", "cmd/hopter/main.go"]);
  run.writeJson("preflight/required-paths.json", required);
  checks.push({
    name: "required Go entry files",
    status: required.status,
    detail: required.status === "pass" ? "go.mod and cmd/hopter/main.go exist" : `missing: ${required.missing.join(", ")}`,
  });

  const goVersion = await runCommand(["go", "version"], process.cwd());
  run.writeJson("commands/go-version.json", goVersion);
  checks.push({
    name: "go availability",
    status: goVersion.exitCode === 0 ? "pass" : "blocked",
    detail: goVersion.exitCode === 0 ? goVersion.stdout.trim() : (goVersion.stderr || goVersion.stdout || "go version failed").trim(),
  });

  if (required.status !== "pass" || goVersion.exitCode !== 0) {
    const overallStatus = combineValidationStatus(checks.map((check) => check.status));
    run.writeJson("report.json", { runId: run.runId, status: overallStatus, checks, healthUrl: HEALTH_URL, readyUrl: READY_URL });
    run.writeText("summary.md", renderValidationSummary("Go rebuild server validation", checks, [
      "Lane stays blocked until the Go module and entrypoint exist.",
      `Expected health probe target: ${HEALTH_URL}`,
      `Expected ready probe target: ${READY_URL}`,
    ]));
    writeFileSync(path.resolve(process.cwd(), "storage/artifacts/validation/latest-go-server.txt"), `${run.rootDir}\n`);
    console.log(`Go server validation evidence: ${run.rootDir}`);
    process.exitCode = 1;
    return;
  }

  const goTest = await runCommand(["go", "test", "./..."], process.cwd());
  run.writeJson("commands/go-test.json", goTest);
  checks.push({
    name: "go test ./...",
    status: goTest.exitCode === 0 ? "pass" : "fail",
    detail: goTest.exitCode === 0 ? "go test passed" : (goTest.stderr || goTest.stdout || "go test failed").trim(),
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

  if (goTest.exitCode !== 0 || goBuild.exitCode !== 0) {
    const overallStatus = combineValidationStatus(checks.map((check) => check.status));
    run.writeJson("report.json", { runId: run.runId, status: overallStatus, checks, healthUrl: HEALTH_URL, readyUrl: READY_URL });
    run.writeText("summary.md", renderValidationSummary("Go rebuild server validation", checks, [
      "Compilation must pass before runtime probes can be trusted.",
    ]));
    writeFileSync(path.resolve(process.cwd(), "storage/artifacts/validation/latest-go-server.txt"), `${run.rootDir}\n`);
    console.log(`Go server validation evidence: ${run.rootDir}`);
    process.exitCode = 1;
    return;
  }

  const server = Bun.spawn([binaryPath, "--port", serverPort], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });

  const health = await waitForHttp(HEALTH_URL);
  run.writeJson("probes/healthz.json", health);
  checks.push({
    name: "health probe",
    status: health.ok ? "pass" : "fail",
    detail: health.ok ? `health returned ${health.status}` : (health.error || `health returned ${health.status}`),
  });

  const ready = await waitForHttp(READY_URL, 5_000, 500);
  run.writeJson("probes/readyz.json", ready);
  checks.push({
    name: "ready probe",
    status: ready.ok ? "pass" : "blocked",
    detail: ready.ok ? `ready returned ${ready.status}` : (ready.error || `ready returned ${ready.status}`),
  });

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

  const overallStatus = combineValidationStatus(checks.map((check) => check.status));
  run.writeJson("report.json", { runId: run.runId, status: overallStatus, checks, healthUrl: HEALTH_URL, readyUrl: READY_URL });
  run.writeText("summary.md", renderValidationSummary("Go rebuild server validation", checks, [
    "When this lane is green, it proves the Go entrypoint can compile, boot, and answer health probes.",
  ]));
  writeFileSync(path.resolve(process.cwd(), "storage/artifacts/validation/latest-go-server.txt"), `${run.rootDir}\n`);
  console.log(`Go server validation evidence: ${run.rootDir}`);

  if (overallStatus !== "pass") {
    process.exitCode = 1;
  }
}

await main();
