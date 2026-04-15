import { writeFileSync } from "node:fs";
import path from "node:path";
import { createValidationRun, runCommand } from "./lib/validation.ts";
import { checkRequiredPaths, combineValidationStatus, renderValidationSummary, type ValidationCheck } from "./lib/rebuild-validation.ts";

async function main(): Promise<void> {
  const run = createValidationRun("go_idl");
  const checks: ValidationCheck[] = [];

  const required = checkRequiredPaths([
    "idl/buf.yaml",
    "idl/buf.gen.yaml",
    "idl/orchd/v1/common.proto",
    "idl/orchd/v1/host.proto",
    "idl/orchd/v1/project.proto",
    "idl/orchd/v1/session.proto",
    "idl/orchd/v1/events.proto",
  ]);

  run.writeJson("preflight/required-paths.json", required);
  checks.push({
    name: "required IDL files",
    status: required.status,
    detail: required.status === "pass" ? "idl root, buf config, and first-pass protos exist" : `missing: ${required.missing.join(", ")}`,
  });

  if (required.status !== "pass") {
    const summary = renderValidationSummary("Go rebuild IDL validation", checks, [
      "Lane is blocked until the required IDL files exist.",
    ]);
    run.writeText("summary.md", summary);
    run.writeJson("report.json", { runId: run.runId, status: combineValidationStatus(checks.map((check) => check.status)), checks });
    writeFileSync(path.resolve(process.cwd(), "storage/artifacts/validation/latest-go-idl.txt"), `${run.rootDir}\n`);
    console.log(`Go IDL validation evidence: ${run.rootDir}`);
    process.exitCode = 1;
    return;
  }

  const bufVersion = await runCommand(["buf", "--version"], process.cwd());
  run.writeJson("commands/buf-version.json", bufVersion);
  checks.push({
    name: "buf availability",
    status: bufVersion.exitCode === 0 ? "pass" : "blocked",
    detail: bufVersion.exitCode === 0 ? bufVersion.stdout.trim() : (bufVersion.stderr || bufVersion.stdout || "buf --version failed").trim(),
  });

  if (bufVersion.exitCode === 0) {
    const lint = await runCommand(["buf", "lint"], path.resolve(process.cwd(), "idl"));
    run.writeJson("commands/buf-lint.json", lint);
    checks.push({
      name: "buf lint",
      status: lint.exitCode === 0 ? "pass" : "fail",
      detail: lint.exitCode === 0 ? "buf lint passed" : (lint.stderr || lint.stdout || "buf lint failed").trim(),
    });

    const generate = await runCommand(["buf", "generate"], path.resolve(process.cwd(), "idl"));
    run.writeJson("commands/buf-generate.json", generate);
    checks.push({
      name: "buf generate",
      status: generate.exitCode === 0 ? "pass" : "fail",
      detail: generate.exitCode === 0 ? "buf generate passed" : (generate.stderr || generate.stdout || "buf generate failed").trim(),
    });
  }

  const generated = checkRequiredPaths([
    "internal/gen/proto/orchd/v1/common.pb.go",
    "internal/gen/proto/orchd/v1/host.pb.go",
    "internal/gen/proto/orchd/v1/project.pb.go",
    "internal/gen/proto/orchd/v1/session.pb.go",
    "internal/gen/proto/orchd/v1/orchdv1connect/host.connect.go",
    "ui/src/gen/proto/orchd/v1/common_pb.ts",
    "ui/src/gen/proto/orchd/v1/host_pb.ts",
    "ui/src/gen/proto/orchd/v1/project_pb.ts",
    "ui/src/gen/proto/orchd/v1/session_pb.ts",
  ]);
  run.writeJson("generated/required-paths.json", generated);
  checks.push({
    name: "generated outputs",
    status: generated.status,
    detail: generated.status === "pass" ? "expected Go and TS generated outputs are present" : `missing: ${generated.missing.join(", ")}`,
  });

  const overallStatus = combineValidationStatus(checks.map((check) => check.status));
  run.writeJson("report.json", { runId: run.runId, status: overallStatus, checks });
  run.writeText("summary.md", renderValidationSummary("Go rebuild IDL validation", checks));
  writeFileSync(path.resolve(process.cwd(), "storage/artifacts/validation/latest-go-idl.txt"), `${run.rootDir}\n`);
  console.log(`Go IDL validation evidence: ${run.rootDir}`);

  if (overallStatus !== "pass") {
    process.exitCode = 1;
  }
}

await main();
