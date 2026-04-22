import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  APP_SERVER_DOCS_ACK_ENV,
  APP_SERVER_OFFICIAL_DOC_URL,
  APP_SERVER_UPSTREAM_ACK_ENV,
  APP_SERVER_UPSTREAM_SOURCE_URL,
  classifyAppServerScope,
  isTruthyAck,
} from "./lib/app-server-docs-guard.ts";
import { createValidationRun, runCommand } from "./lib/validation.ts";
import { combineValidationStatus, renderValidationSummary, type ValidationCheck } from "./lib/rebuild-validation.ts";

type ScopedFile = {
  file: string;
  reasons: string[];
};

type GitFileScan = {
  mode: "working-tree" | "base-ref";
  baseRef?: string;
  files: string[];
  errors: string[];
};

const REPO_ROOT = process.cwd();

function parseBaseRef(): string | undefined {
  const args = process.argv.slice(2);
  const baseIndex = args.indexOf("--base");
  if (baseIndex >= 0) {
    return args[baseIndex + 1];
  }
  return process.env.HOPTER_APP_SERVER_BASE_REF;
}

async function git(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const result = await runCommand(["git", ...args], REPO_ROOT);
  return {
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
    exitCode: result.exitCode,
  };
}

function lines(value: string): string[] {
  return value.split("\n").map((line) => line.trim()).filter(Boolean);
}

async function changedFilesFromBase(baseRef: string): Promise<GitFileScan> {
  const errors: string[] = [];
  const mergeBase = await git(["merge-base", baseRef, "HEAD"]);
  if (mergeBase.exitCode !== 0 || !mergeBase.stdout) {
    errors.push(`git merge-base ${baseRef} HEAD failed: ${mergeBase.stderr || "no stderr"}`);
    return { mode: "base-ref", baseRef, files: [], errors };
  }

  const diff = await git(["diff", "--name-only", "--diff-filter=ACMRTUXB", `${mergeBase.stdout}...HEAD`, "--"]);
  if (diff.exitCode !== 0) {
    errors.push(`git diff from ${baseRef} failed: ${diff.stderr || "no stderr"}`);
  }

  return {
    mode: "base-ref",
    baseRef,
    files: Array.from(new Set(lines(diff.stdout))).sort(),
    errors,
  };
}

async function changedFilesFromWorkingTree(): Promise<GitFileScan> {
  const errors: string[] = [];
  const commands = [
    ["diff", "--name-only", "--diff-filter=ACMRTUXB", "HEAD", "--"],
    ["diff", "--cached", "--name-only", "--diff-filter=ACMRTUXB", "--"],
    ["ls-files", "--others", "--exclude-standard"],
  ];

  const files = new Set<string>();
  for (const args of commands) {
    const result = await git(args);
    if (result.exitCode !== 0) {
      errors.push(`git ${args.join(" ")} failed: ${result.stderr || "no stderr"}`);
      continue;
    }
    for (const file of lines(result.stdout)) {
      files.add(file);
    }
  }

  return {
    mode: "working-tree",
    files: Array.from(files).sort(),
    errors,
  };
}

function readRepoFile(file: string): string {
  const absolutePath = path.resolve(REPO_ROOT, file);
  if (!existsSync(absolutePath)) return "";
  return readFileSync(absolutePath, "utf8");
}

function findScopedFiles(files: string[]): ScopedFile[] {
  return files.flatMap((file) => {
    const match = classifyAppServerScope(file, readRepoFile(file));
    if (!match.scoped) return [];
    return [{
      file,
      reasons: match.reasons,
    }];
  });
}

function policyFileCheck(file: string, requiredSnippets: string[]): ValidationCheck {
  const absolutePath = path.resolve(REPO_ROOT, file);
  if (!existsSync(absolutePath)) {
    return {
      name: `${file} present`,
      status: "fail",
      detail: "missing required app-server docs guard policy file",
    };
  }

  const content = readFileSync(absolutePath, "utf8");
  const missing = requiredSnippets.filter((snippet) => !content.includes(snippet));
  return {
    name: `${file} policy references`,
    status: missing.length === 0 ? "pass" : "fail",
    detail: missing.length === 0 ? "required references present" : `missing: ${missing.join(", ")}`,
  };
}

async function main(): Promise<void> {
  const run = createValidationRun("app_server_docs");
  const baseRef = parseBaseRef();
  const scan = baseRef ? await changedFilesFromBase(baseRef) : await changedFilesFromWorkingTree();
  const scopedFiles = findScopedFiles(scan.files);
  const docsAck = isTruthyAck(process.env[APP_SERVER_DOCS_ACK_ENV]);
  const upstreamAck = isTruthyAck(process.env[APP_SERVER_UPSTREAM_ACK_ENV]);

  const checks: ValidationCheck[] = [
    policyFileCheck("AGENTS.md", [
      "docs/operations/CODEX_APP_SERVER_DEVELOPMENT_CONSTRAINTS.md",
      "validate-app-server-docs",
    ]),
    policyFileCheck("docs/operations/CODEX_APP_SERVER_DEVELOPMENT_CONSTRAINTS.md", [
      APP_SERVER_OFFICIAL_DOC_URL,
      APP_SERVER_UPSTREAM_SOURCE_URL,
      APP_SERVER_DOCS_ACK_ENV,
    ]),
    policyFileCheck("Makefile", [
      "validate-app-server-docs",
      "scripts/validate-app-server-docs.ts",
    ]),
    {
      name: "git change scan",
      status: scan.errors.length === 0 ? "pass" : "fail",
      detail: scan.errors.length === 0
        ? `${scan.files.length} changed file(s) scanned via ${scan.mode}`
        : scan.errors.join("; "),
    },
    {
      name: "app-server docs acknowledgement",
      status: scopedFiles.length === 0 || docsAck ? "pass" : "blocked",
      detail: scopedFiles.length === 0
        ? "no app-server connection changes detected"
        : docsAck
          ? `${APP_SERVER_DOCS_ACK_ENV} acknowledged for ${scopedFiles.length} scoped file(s)`
          : `${APP_SERVER_DOCS_ACK_ENV}=1 required after reading ${APP_SERVER_OFFICIAL_DOC_URL}`,
    },
  ];

  const status = combineValidationStatus(checks.map((check) => check.status));
  const notes = [
    `Official docs: ${APP_SERVER_OFFICIAL_DOC_URL}`,
    `Upstream source for ambiguous details: ${APP_SERVER_UPSTREAM_SOURCE_URL}`,
    `${APP_SERVER_UPSTREAM_ACK_ENV}: ${upstreamAck ? "acknowledged" : "not set"}`,
  ];

  const report = {
    runId: run.runId,
    status,
    sources: {
      officialDocs: APP_SERVER_OFFICIAL_DOC_URL,
      upstreamSource: APP_SERVER_UPSTREAM_SOURCE_URL,
    },
    acknowledgements: {
      [APP_SERVER_DOCS_ACK_ENV]: docsAck,
      [APP_SERVER_UPSTREAM_ACK_ENV]: upstreamAck,
    },
    scan,
    scopedFiles,
    checks,
  };

  run.writeJson("report.json", report);
  run.writeText("summary.md", renderValidationSummary("App Server Docs Guard", checks, notes));
  writeFileSync(path.resolve(REPO_ROOT, "storage/artifacts/validation/latest-app-server-docs.txt"), `${run.rootDir}\n`);

  console.log(`App-server docs guard evidence: ${run.rootDir}`);

  if (status !== "pass") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
