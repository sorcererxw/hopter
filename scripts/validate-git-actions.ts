import { writeFileSync } from "node:fs";
import path from "node:path";

import {
  combineValidationStatus,
  renderValidationSummary,
  type ValidationCheck,
} from "./lib/rebuild-validation.ts";
import { createValidationRun, runCommand } from "./lib/validation.ts";

async function main(): Promise<void> {
  const run = createValidationRun("git_actions");
  const checks: ValidationCheck[] = [];

  const goTests = await runCommand(
    ["go", "test", "./internal/gitops", "./internal/rpc", "./internal/events"],
    process.cwd(),
  );
  run.writeJson("commands/go-test-git-actions.json", goTests);
  checks.push({
    name: "git action Go tests",
    status: goTests.exitCode === 0 ? "pass" : "fail",
    detail:
      goTests.exitCode === 0
        ? "internal gitops/rpc/events tests passed"
        : (goTests.stderr || goTests.stdout || "go test failed").trim(),
  });

  const typecheck = await runCommand(["pnpm", "--dir", "ui", "typecheck"], process.cwd());
  run.writeJson("commands/pnpm-ui-typecheck.json", typecheck);
  checks.push({
    name: "frontend typecheck",
    status: typecheck.exitCode === 0 ? "pass" : "fail",
    detail:
      typecheck.exitCode === 0
        ? "ui typecheck passed"
        : (typecheck.stderr || typecheck.stdout || "ui typecheck failed").trim(),
  });

  const overallStatus = combineValidationStatus(checks.map((check) => check.status));
  run.writeJson("report.json", {
    checks,
    runId: run.runId,
    status: overallStatus,
  });
  run.writeText(
    "summary.md",
    renderValidationSummary("Git actions validation", checks, [
      "Covers project-level Commit All, no-upstream push rejection, and active-writer rejection through Go tests.",
    ]),
  );
  writeFileSync(
    path.resolve(process.cwd(), "storage/artifacts/validation/latest-git-actions.txt"),
    `${run.rootDir}\n`,
  );
  console.log(`Git actions validation evidence: ${run.rootDir}`);

  if (overallStatus !== "pass") {
    process.exitCode = 1;
  }
}

await main();
