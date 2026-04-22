import { writeFileSync } from "node:fs";
import path from "node:path";
import { createValidationRun, runCommand } from "./lib/validation.ts";
import {
  combineValidationStatus,
  renderValidationSummary,
  type ValidationCheck,
} from "./lib/rebuild-validation.ts";

async function main(): Promise<void> {
  const run = createValidationRun("tasks_store");
  const checks: ValidationCheck[] = [];

  const test = await runCommand(["go", "test", "./internal/tasks"], process.cwd());
  run.writeJson("commands/go-test-internal-tasks.json", test);
  checks.push({
    name: "internal/tasks tests",
    status: test.exitCode === 0 ? "pass" : "fail",
    detail:
      test.exitCode === 0
        ? "Badger-backed task store tests passed"
        : (test.stderr || test.stdout || "go test ./internal/tasks failed").trim(),
  });

  const status = combineValidationStatus(checks.map((check) => check.status));
  run.writeJson("report.json", { runId: run.runId, status, checks });
  run.writeText("summary.md", renderValidationSummary("Tasks store validation", checks));
  writeFileSync(
    path.resolve(process.cwd(), "storage/artifacts/validation/latest-tasks-store.txt"),
    `${run.rootDir}\n`
  );
  console.log(`Tasks store validation evidence: ${run.rootDir}`);
  if (status !== "pass") {
    process.exitCode = 1;
  }
}

await main();
