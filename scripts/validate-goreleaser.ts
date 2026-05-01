import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createValidationRun, runCommand } from "./lib/validation.ts";

type Check = {
  name: string;
  status: "pass" | "fail";
  detail: string;
};

function addCheck(checks: Check[], name: string, passed: boolean, detail: string) {
  checks.push({
    name,
    status: passed ? "pass" : "fail",
    detail,
  });
}

async function main() {
  const run = createValidationRun("goreleaser");
  const checks: Check[] = [];

  const yaml = await runCommand([
    "ruby",
    "-e",
    "require 'yaml'; YAML.load_file('.goreleaser.yml'); YAML.load_file('.github/workflows/release.yml'); puts 'yaml ok'",
  ], process.cwd());
  run.writeJson("commands/yaml-parse.json", yaml);
  addCheck(
    checks,
    "yaml parse",
    yaml.exitCode === 0,
    yaml.exitCode === 0 ? "GoReleaser config and release workflow parse as YAML" : (yaml.stderr || yaml.stdout).trim(),
  );

  const goreleaser = await runCommand([
    "go",
    "run",
    "github.com/goreleaser/goreleaser/v2@v2.15.3",
    "check",
  ], process.cwd());
  run.writeJson("commands/goreleaser-check.json", goreleaser);
  addCheck(
    checks,
    "goreleaser check",
    goreleaser.exitCode === 0,
    goreleaser.exitCode === 0 ? "GoReleaser accepted .goreleaser.yml" : (goreleaser.stderr || goreleaser.stdout).trim(),
  );

  const goreleaserConfig = readFileSync(".goreleaser.yml", "utf8");
  addCheck(
    checks,
    "homebrew service command",
    goreleaserConfig.includes('run [opt_bin/"hopter", "server"]'),
    "Homebrew service runs the canonical server command",
  );

  const status = checks.every((check) => check.status === "pass") ? "pass" : "fail";
  run.writeJson("report.json", {
    runId: run.runId,
    status,
    checks,
  });
  run.writeText("summary.md", [
    "# GoReleaser validation",
    "",
    `Run: ${run.runId}`,
    `Status: ${status}`,
    "",
    ...checks.map((check) => `- ${check.status.toUpperCase()} ${check.name}: ${check.detail}`),
    "",
  ].join("\n"));
  writeFileSync(path.resolve(process.cwd(), "storage/artifacts/validation/latest-goreleaser.txt"), `${run.rootDir}\n`);

  console.log(`GoReleaser validation evidence: ${run.rootDir}`);

  if (status !== "pass") {
    process.exitCode = 1;
  }
}

await main();
