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
      "docs/README.md",
      "docs/VALIDATION_HARNESS.md",
      "Choose the shortest path",
    ],
  },
  {
    file: "docs/README.md",
    includes: [
      "## Physical layout",
      "Layer 0: Repo entry",
      "Layer 4: Validation harness",
      "Validation or release owner",
    ],
  },
  {
    file: "docs/VALIDATION_HARNESS.md",
    includes: [
      "docs/validation/PRD_ACCEPTANCE_MATRIX_V1.md",
      "storage/artifacts/validation/",
      "scripts/validate-docs.ts",
      "docs/operations/ALPHA_READINESS_SUMMARY.md",
    ],
  },
  {
    file: "docs/operations/CONTRIBUTING.md",
    includes: [
      "docs/README.md",
      "docs/VALIDATION_HARNESS.md",
      "bun run validate:docs",
    ],
  },
  {
    file: "AGENTS.md",
    includes: [
      "docs/README.md",
      "docs/VALIDATION_HARNESS.md",
    ],
  },
];

const expectedPresentFiles = [
  "docs/product/PRODUCT_MEMO.md",
  "docs/product/DESIGN_DOC.md",
  "docs/specs/ARCHITECTURE_MEMO.md",
  "docs/specs/COMMUNICATION_AND_UX_SPEC.md",
  "docs/specs/ENGINEERING_SPEC_V1.md",
  "docs/planning/IMPLEMENTATION_PLAN.md",
  "docs/planning/TASK_BREAKDOWN_V1.md",
  "docs/planning/ENG_REVIEW_TEST_PLAN.md",
  "docs/planning/FRONTEND_STACK_REPORT.md",
  "docs/validation/VALIDATION_PROGRAM_V1.md",
  "docs/validation/PRD_ACCEPTANCE_MATRIX_V1.md",
  "docs/validation/M0_SPIKE_SPEC.md",
  "docs/validation/M0_SPIKE_FINDINGS.md",
  "docs/operations/CONTRIBUTING.md",
  "docs/operations/DEPLOYMENT.md",
  "docs/operations/RELEASE_CHECKLIST.md",
  "docs/operations/ALPHA_READINESS_SUMMARY.md",
  "docs/operations/HANDOFF_2026-04-14.md",
];

const expectedAbsentFiles = [
  "PRODUCT_MEMO.md",
  "DESIGN_DOC.md",
  "ARCHITECTURE_MEMO.md",
  "COMMUNICATION_AND_UX_SPEC.md",
  "ENGINEERING_SPEC_V1.md",
  "IMPLEMENTATION_PLAN.md",
  "TASK_BREAKDOWN_V1.md",
  "ENG_REVIEW_TEST_PLAN.md",
  "FRONTEND_STACK_REPORT.md",
  "VALIDATION_PROGRAM_V1.md",
  "PRD_ACCEPTANCE_MATRIX_V1.md",
  "M0_SPIKE_SPEC.md",
  "docs/M0_SPIKE_FINDINGS.md",
  "docs/CONTRIBUTING.md",
  "docs/DEPLOYMENT.md",
  "docs/RELEASE_CHECKLIST.md",
  "docs/ALPHA_READINESS_SUMMARY.md",
  "docs/HANDOFF_2026-04-14.md",
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
    "- verify the progressive-disclosure doc entrypoints exist",
    "- verify the validation harness guide is wired into the main repo docs",
    "- verify the physical doc layout matches the intended folder structure",
  ];

  run.writeText("summary.md", `${summaryLines.join("\n")}\n`);
  writeFileSync(path.resolve(process.cwd(), "storage/artifacts/validation/latest-docs.txt"), `${run.rootDir}\n`);

  console.log(`Docs validation evidence: ${run.rootDir}`);

  if (!passed) {
    process.exitCode = 1;
  }
}

main();
