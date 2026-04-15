import { writeFileSync } from "node:fs";
import path from "node:path";
import { createValidationRun, runCommand } from "./lib/validation.ts";
import { checkRequiredPaths, combineValidationStatus, renderValidationSummary, type ValidationCheck } from "./lib/rebuild-validation.ts";

async function main(): Promise<void> {
  const run = createValidationRun("go_ui");
  const checks: ValidationCheck[] = [];

  const required = checkRequiredPaths(["ui/package.json"]);
  run.writeJson("preflight/required-paths.json", required);
  checks.push({
    name: "ui package",
    status: required.status,
    detail: required.status === "pass" ? "ui/package.json exists" : `missing: ${required.missing.join(", ")}`,
  });

  const pnpmVersion = await runCommand(["pnpm", "--version"], process.cwd());
  run.writeJson("commands/pnpm-version.json", pnpmVersion);
  checks.push({
    name: "pnpm availability",
    status: pnpmVersion.exitCode === 0 ? "pass" : "blocked",
    detail: pnpmVersion.exitCode === 0 ? pnpmVersion.stdout.trim() : (pnpmVersion.stderr || pnpmVersion.stdout || "pnpm --version failed").trim(),
  });

  if (required.status !== "pass" || pnpmVersion.exitCode !== 0) {
    const overallStatus = combineValidationStatus(checks.map((check) => check.status));
    run.writeJson("report.json", { runId: run.runId, status: overallStatus, checks });
    run.writeText("summary.md", renderValidationSummary("Go rebuild UI validation", checks, [
      "Lane stays blocked until the rebuilt ui/ workspace exists.",
    ]));
    writeFileSync(path.resolve(process.cwd(), "storage/artifacts/validation/latest-go-ui.txt"), `${run.rootDir}\n`);
    console.log(`Go UI validation evidence: ${run.rootDir}`);
    process.exitCode = 1;
    return;
  }

  const build = await runCommand(["pnpm", "--dir", "ui", "build"], process.cwd());
  run.writeJson("commands/pnpm-ui-build.json", build);
  checks.push({
    name: "pnpm --dir ui build",
    status: build.exitCode === 0 ? "pass" : "fail",
    detail: build.exitCode === 0 ? "ui build passed" : (build.stderr || build.stdout || "ui build failed").trim(),
  });

  const dist = checkRequiredPaths(["ui/dist/index.html", "ui/dist/assets"]);
  run.writeJson("dist/required-paths.json", dist);
  checks.push({
    name: "ui dist output",
    status: dist.status,
    detail: dist.status === "pass" ? "ui/dist contains index.html and assets" : `missing: ${dist.missing.join(", ")}`,
  });

  const overallStatus = combineValidationStatus(checks.map((check) => check.status));
  run.writeJson("report.json", { runId: run.runId, status: overallStatus, checks });
  run.writeText("summary.md", renderValidationSummary("Go rebuild UI validation", checks));
  writeFileSync(path.resolve(process.cwd(), "storage/artifacts/validation/latest-go-ui.txt"), `${run.rootDir}\n`);
  console.log(`Go UI validation evidence: ${run.rootDir}`);

  if (overallStatus !== "pass") {
    process.exitCode = 1;
  }
}

await main();
