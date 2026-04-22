import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createValidationRun, runCommand } from "./lib/validation.ts";

type Check = {
  name: string;
  status: "pass" | "fail";
  detail: string;
};

const checksums = [
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  hopter-darwin-amd64",
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb  hopter-darwin-arm64",
  "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc  hopter-linux-amd64",
  "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd  hopter-linux-arm64",
].join("\n");

function addContentCheck(checks: Check[], formula: string, name: string, snippet: string) {
  checks.push({
    name,
    status: formula.includes(snippet) ? "pass" : "fail",
    detail: formula.includes(snippet)
      ? `formula includes ${snippet}`
      : `formula missing ${snippet}`,
  });
}

async function main() {
  const run = createValidationRun("homebrew_formula");
  const fixtureDir = path.join(run.rootDir, "fixture");
  const outputPath = path.join(run.rootDir, "Formula", "hopter.rb");
  const checksumsPath = path.join(fixtureDir, "checksums.txt");
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(checksumsPath, `${checksums}\n`);

  const generate = await runCommand([
    "bash",
    "scripts/generate-homebrew-formula.sh",
    "--version",
    "v0.0.7",
    "--repo",
    "sorcererxw/hopter",
    "--checksums",
    checksumsPath,
    "--output",
    outputPath,
  ], process.cwd());
  run.writeJson("commands/generate-formula.json", generate);

  const checks: Check[] = [
    {
      name: "formula generation",
      status: generate.exitCode === 0 ? "pass" : "fail",
      detail: generate.exitCode === 0
        ? "generator exited successfully"
        : (generate.stderr || generate.stdout || "formula generation failed").trim(),
    },
  ];

  const formula = readFileSync(outputPath, "utf8");
  run.writeText("Formula/hopter.rb", formula);

  addContentCheck(checks, formula, "formula version", 'version "0.0.7"');
  addContentCheck(checks, formula, "mac arm64 asset", "hopter-darwin-arm64");
  addContentCheck(checks, formula, "mac amd64 checksum", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  addContentCheck(checks, formula, "linux arm64 asset", "hopter-linux-arm64");
  addContentCheck(checks, formula, "service block", 'run [opt_bin/"hopter", "serve"]');
  addContentCheck(checks, formula, "version smoke test", 'shell_output("#{bin}/hopter version")');

  const rubySyntax = await runCommand(["ruby", "-c", outputPath], process.cwd());
  run.writeJson("commands/ruby-syntax.json", rubySyntax);
  checks.push({
    name: "ruby syntax",
    status: rubySyntax.exitCode === 0 ? "pass" : "fail",
    detail: rubySyntax.exitCode === 0
      ? "generated formula has valid Ruby syntax"
      : (rubySyntax.stderr || rubySyntax.stdout || "ruby syntax check failed").trim(),
  });

  const status = checks.every((check) => check.status === "pass") ? "pass" : "fail";
  run.writeJson("report.json", {
    runId: run.runId,
    status,
    checks,
  });
  run.writeText("summary.md", [
    "# Homebrew formula validation",
    "",
    `Run: ${run.runId}`,
    `Status: ${status}`,
    "",
    ...checks.map((check) => `- ${check.status.toUpperCase()} ${check.name}: ${check.detail}`),
    "",
  ].join("\n"));
  writeFileSync(path.resolve(process.cwd(), "storage/artifacts/validation/latest-homebrew-formula.txt"), `${run.rootDir}\n`);

  console.log(`Homebrew formula validation evidence: ${run.rootDir}`);

  if (status !== "pass") {
    process.exitCode = 1;
  }
}

await main();
