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
  const run = createValidationRun("npm_packages");
  const outputDir = path.join(run.rootDir, "npm");

  const generate = await runCommand([
    "bash",
    "scripts/generate-npm-packages.sh",
    "--version",
    "v0.0.7",
    "--output",
    outputDir,
  ], process.cwd());
  run.writeJson("commands/generate-npm-packages.json", generate);

  const checks: Check[] = [
    {
      name: "package generation",
      status: generate.exitCode === 0 ? "pass" : "fail",
      detail: generate.exitCode === 0
        ? "generator exited successfully"
        : (generate.stderr || generate.stdout || "npm package generation failed").trim(),
    },
  ];

  const mainPackagePath = path.join(outputDir, "main", "package.json");
  const mainPackage = JSON.parse(readFileSync(mainPackagePath, "utf8"));
  run.writeText("npm/main/package.json", JSON.stringify(mainPackage, null, 2));

  addCheck(checks, "package name", mainPackage.name === "hopter-cli", `name is ${mainPackage.name}`);
  addCheck(checks, "package version", mainPackage.version === "0.0.7", `version is ${mainPackage.version}`);
  addCheck(checks, "bin entry", mainPackage.bin?.hopter === "bin/hopter.js", "package exposes hopter bin");
  addCheck(checks, "postinstall", mainPackage.scripts?.postinstall === "node scripts/install.js", "package downloads binary during postinstall");
  addCheck(checks, "no optional deps", mainPackage.optionalDependencies === undefined, "package does not rely on platform npm packages");

  const wrapperCheck = await runCommand(["node", "--check", path.join(outputDir, "main", "bin", "hopter.js")], process.cwd());
  run.writeJson("commands/node-check-wrapper.json", wrapperCheck);
  addCheck(
    checks,
    "wrapper syntax",
    wrapperCheck.exitCode === 0,
    wrapperCheck.exitCode === 0 ? "wrapper passes node syntax check" : (wrapperCheck.stderr || wrapperCheck.stdout).trim(),
  );

  const installCheck = await runCommand(["node", "--check", path.join(outputDir, "main", "scripts", "install.js")], process.cwd());
  run.writeJson("commands/node-check-install.json", installCheck);
  addCheck(
    checks,
    "postinstall syntax",
    installCheck.exitCode === 0,
    installCheck.exitCode === 0 ? "postinstall script passes node syntax check" : (installCheck.stderr || installCheck.stdout).trim(),
  );

  const packMain = await runCommand(["npm", "pack", "--dry-run", "--json"], path.join(outputDir, "main"));
  run.writeJson("commands/npm-pack-main.json", packMain);
  addCheck(
    checks,
    "npm pack",
    packMain.exitCode === 0 &&
      packMain.stdout.includes("bin/hopter.js") &&
      packMain.stdout.includes("scripts/install.js") &&
      !packMain.stdout.includes("vendor/hopter"),
    packMain.exitCode === 0 ? "package dry-run includes wrapper and postinstall script only" : (packMain.stderr || packMain.stdout).trim(),
  );

  const status = checks.every((check) => check.status === "pass") ? "pass" : "fail";
  run.writeJson("report.json", {
    runId: run.runId,
    status,
    checks,
  });
  run.writeText("summary.md", [
    "# npm package validation",
    "",
    `Run: ${run.runId}`,
    `Status: ${status}`,
    "",
    ...checks.map((check) => `- ${check.status.toUpperCase()} ${check.name}: ${check.detail}`),
    "",
  ].join("\n"));
  writeFileSync(path.resolve(process.cwd(), "storage/artifacts/validation/latest-npm-packages.txt"), `${run.rootDir}\n`);

  console.log(`npm package validation evidence: ${run.rootDir}`);

  if (status !== "pass") {
    process.exitCode = 1;
  }
}

await main();
