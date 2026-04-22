import { writeFileSync } from "node:fs";
import path from "node:path";
import { createValidationRun, runCommand } from "./lib/validation.ts";
import {
  checkRequiredPaths,
  combineValidationStatus,
  renderValidationSummary,
  type ValidationCheck,
} from "./lib/rebuild-validation.ts";

async function main(): Promise<void> {
  const run = createValidationRun("tasks_idl");
  const checks: ValidationCheck[] = [];

  const required = checkRequiredPaths([
    "idl/hopter/v1/tasks.proto",
    "internal/gen/proto/hopter/v1/tasks.pb.go",
    "internal/gen/proto/hopter/v1/hopterv1connect/tasks.connect.go",
    "ui/src/gen/proto/hopter/v1/tasks_pb.ts",
  ]);
  run.writeJson("preflight/required-paths.json", required);
  checks.push({
    name: "tasks IDL files",
    status: required.status,
    detail:
      required.status === "pass"
        ? "tasks proto and generated Go/TS outputs exist"
        : `missing: ${required.missing.join(", ")}`,
  });

  const lint = await runCommand(["buf", "lint"], path.resolve(process.cwd(), "idl"));
  run.writeJson("commands/buf-lint.json", lint);
  checks.push({
    name: "buf lint",
    status: lint.exitCode === 0 ? "pass" : "fail",
    detail:
      lint.exitCode === 0
        ? "buf lint passed"
        : (lint.stderr || lint.stdout || "buf lint failed").trim(),
  });

  const status = combineValidationStatus(checks.map((check) => check.status));
  run.writeJson("report.json", { runId: run.runId, status, checks });
  run.writeText("summary.md", renderValidationSummary("Tasks IDL validation", checks));
  writeFileSync(
    path.resolve(process.cwd(), "storage/artifacts/validation/latest-tasks-idl.txt"),
    `${run.rootDir}\n`
  );
  console.log(`Tasks IDL validation evidence: ${run.rootDir}`);
  if (status !== "pass") {
    process.exitCode = 1;
  }
}

await main();
