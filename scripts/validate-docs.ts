import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createValidationRun } from "./lib/validation.ts";

type Check = {
  file: string;
  includes: string[];
};

const checks: Check[] = [
  {
    file: "README.md",
    includes: [
      "Hopter lets you control local coding agents from a browser",
      "brew install sorcererxw/hopter/hopter",
      "Codex stays the source of truth",
      "docs/README.md",
    ],
  },
  {
    file: "docs/README.md",
    includes: [
      "Go rebuild",
      "GO_REBUILD_MASTER_PLAN.md",
      "GO_REBUILD_TASK_LIST.md",
      "IDL_SURFACE_V1_DRAFT.md",
    ],
  },
  {
    file: "docs/operations/CONTRIBUTING.md",
    includes: [
      "Go backend",
      "make ui-build",
      "make validate-go-tetris",
    ],
  },
  {
    file: "docs/operations/UI_SYSTEM_RULES.md",
    includes: [
      "ui/src/components/ui",
      "official shadcn CLI",
      "workspace shell",
    ],
  },
  {
    file: "AGENTS.md",
    includes: [
      "Go-first",
      "Connect",
      "SSE",
      "projects",
    ],
  },
];

const expectedPresentFiles = [
  "docs/planning/GO_REBUILD_MASTER_PLAN.md",
  "docs/planning/GO_REBUILD_TASK_LIST.md",
  "docs/planning/BACKEND_EXECUTION_PLAN.md",
  "docs/planning/FRONTEND_EXECUTION_PLAN.md",
  "docs/planning/IDL_EXECUTION_PLAN.md",
  "docs/planning/IDL_SURFACE_V1_DRAFT.md",
  "docs/planning/GO_REBUILD_VALIDATION_PLAN.md",
  "docs/product/UI_REBUILD_DESIGN_DOC.md",
  "docs/operations/CONTRIBUTING.md",
  "docs/operations/UI_SYSTEM_RULES.md",
  "docs/VALIDATION_HARNESS.md",
];

const expectedAbsentFiles = [
  "src/server/bootstrap/index.ts",
  "src/web/app/main.tsx",
  "src/shared/domain/session.ts",
  "scripts/validate-template-snake.ts",
  "scripts/validate-m0.ts",
  "scripts/validate-m1.ts",
  "scripts/validate-m2.ts",
  "scripts/validate-m3.ts",
  "scripts/validate-m4.ts",
  "scripts/validate-m5.ts",
  "scripts/validate-web-shell.ts",
  "test/http-app.test.ts",
  "test/project-repository.test.ts",
  "test/session-normalizer.test.ts",
  "bunfig.toml",
  "components.json",
];

function main(): void {
  const run = createValidationRun("docs");
  const contentResults = checks.map((check) => {
    const absolutePath = path.resolve(process.cwd(), check.file);
    const contents = readFileSync(absolutePath, "utf8");
    const missing = check.includes.filter((snippet) => !contents.includes(snippet));
    return {
      kind: "content",
      file: check.file,
      passed: missing.length === 0,
      missing,
    };
  });

  const fileResults = [
    ...expectedPresentFiles.map((file) => ({
      kind: "present",
      file,
      passed: existsSync(path.resolve(process.cwd(), file)),
      missing: [] as string[],
    })),
    ...expectedAbsentFiles.map((file) => ({
      kind: "absent",
      file,
      passed: !existsSync(path.resolve(process.cwd(), file)),
      missing: [] as string[],
    })),
  ];

  const results = [...contentResults, ...fileResults];
  const passed = results.every((result) => result.passed);

  run.writeJson("report.json", {
    runId: run.runId,
    passed,
    results,
  });

  const summaryLines = [
    "# Docs validation summary",
    "",
    `Run: ${run.runId}`,
    `Status: ${passed ? "pass" : "fail"}`,
    "",
    "Content checks:",
    ...contentResults.map((result) => `- ${result.passed ? "PASS" : "FAIL"} ${result.file}${result.missing.length > 0 ? ` (missing: ${result.missing.join(", ")})` : ""}`),
    "",
    "Structure checks:",
    ...fileResults.map((result) => `- ${result.passed ? "PASS" : "FAIL"} ${result.kind === "present" ? "present" : "absent"} ${result.file}`),
    "",
    "Purpose:",
    "- verify the active Go rebuild docs are present",
    "- verify repo entry docs match the Go/ui/idl architecture",
    "- verify obviously obsolete Bun-first runtime files are gone",
  ];

  run.writeText("summary.md", `${summaryLines.join("\n")}\n`);
  writeFileSync(path.resolve(process.cwd(), "storage/artifacts/validation/latest-docs.txt"), `${run.rootDir}\n`);

  console.log(`Docs validation evidence: ${run.rootDir}`);

  if (!passed) {
    process.exitCode = 1;
  }
}

main();
