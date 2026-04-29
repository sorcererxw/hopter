import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createValidationRun, runCommand } from "./lib/validation.ts";

type Check = {
  name: string;
  status: "pass" | "fail";
  detail: string;
};

const assets = [
  "hopter-npm-darwin-arm64",
  "hopter-npm-darwin-amd64",
  "hopter-npm-linux-arm64",
  "hopter-npm-linux-amd64",
];

function addCheck(checks: Check[], name: string, passed: boolean, detail: string) {
  checks.push({
    name,
    status: passed ? "pass" : "fail",
    detail,
  });
}

async function main() {
  const run = createValidationRun("npm_packages");
  const releaseDir = path.join(run.rootDir, "release");
  const outputDir = path.join(run.rootDir, "npm");
  mkdirSync(releaseDir, { recursive: true });

  for (const asset of assets) {
    const assetPath = path.join(releaseDir, asset);
    writeFileSync(assetPath, "#!/usr/bin/env sh\nprintf 'hopter test binary\\n'\n");
    chmodSync(assetPath, 0o755);
  }

  const generate = await runCommand([
    "bash",
    "scripts/generate-npm-packages.sh",
    "--version",
    "v0.0.7",
    "--release-dir",
    releaseDir,
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

  addCheck(checks, "main package name", mainPackage.name === "hopter", `name is ${mainPackage.name}`);
  addCheck(checks, "main package version", mainPackage.version === "0.0.7", `version is ${mainPackage.version}`);
  addCheck(checks, "main bin", mainPackage.bin?.hopter === "bin/hopter.js", "main package exposes hopter bin");
  addCheck(
    checks,
    "optional platform deps",
    mainPackage.optionalDependencies?.["@hopter/darwin-arm64"] === "0.0.7" &&
      mainPackage.optionalDependencies?.["@hopter/darwin-x64"] === "0.0.7" &&
      mainPackage.optionalDependencies?.["@hopter/linux-arm64"] === "0.0.7" &&
      mainPackage.optionalDependencies?.["@hopter/linux-x64"] === "0.0.7",
    "main package pins all platform optional dependencies to the release version",
  );

  const platformPackagePath = path.join(outputDir, "darwin-arm64", "package.json");
  const platformPackage = JSON.parse(readFileSync(platformPackagePath, "utf8"));
  run.writeText("npm/darwin-arm64/package.json", JSON.stringify(platformPackage, null, 2));
  addCheck(checks, "platform package name", platformPackage.name === "@hopter/darwin-arm64", `name is ${platformPackage.name}`);
  addCheck(checks, "platform os", platformPackage.os?.[0] === "darwin", `os is ${platformPackage.os}`);
  addCheck(checks, "platform cpu", platformPackage.cpu?.[0] === "arm64", `cpu is ${platformPackage.cpu}`);

  const nodeCheck = await runCommand(["node", "--check", path.join(outputDir, "main", "bin", "hopter.js")], process.cwd());
  run.writeJson("commands/node-check.json", nodeCheck);
  addCheck(
    checks,
    "wrapper syntax",
    nodeCheck.exitCode === 0,
    nodeCheck.exitCode === 0 ? "wrapper passes node syntax check" : (nodeCheck.stderr || nodeCheck.stdout).trim(),
  );

  const packMain = await runCommand(["npm", "pack", "--dry-run", "--json"], path.join(outputDir, "main"));
  run.writeJson("commands/npm-pack-main.json", packMain);
  addCheck(
    checks,
    "main npm pack",
    packMain.exitCode === 0 && packMain.stdout.includes("bin/hopter.js"),
    packMain.exitCode === 0 ? "main package dry-run includes wrapper bin" : (packMain.stderr || packMain.stdout).trim(),
  );

  const packPlatform = await runCommand(["npm", "pack", "--dry-run", "--json"], path.join(outputDir, "darwin-arm64"));
  run.writeJson("commands/npm-pack-darwin-arm64.json", packPlatform);
  addCheck(
    checks,
    "platform npm pack",
    packPlatform.exitCode === 0 && packPlatform.stdout.includes("bin/hopter"),
    packPlatform.exitCode === 0 ? "platform package dry-run includes native binary" : (packPlatform.stderr || packPlatform.stdout).trim(),
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
