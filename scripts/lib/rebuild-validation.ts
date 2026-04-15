import { existsSync } from "node:fs";
import path from "node:path";

export type ValidationStatus = "pass" | "fail" | "blocked";

export type ValidationCheck = {
  name: string;
  status: ValidationStatus;
  detail: string;
};

export function combineValidationStatus(statuses: ValidationStatus[]): ValidationStatus {
  if (statuses.includes("fail")) return "fail";
  if (statuses.includes("blocked")) return "blocked";
  return "pass";
}

export function checkRequiredPaths(paths: string[], cwd = process.cwd()): {
  status: ValidationStatus;
  checked: string[];
  missing: string[];
} {
  const checked = paths.map((file) => path.resolve(cwd, file));
  const missing = checked.filter((absolutePath) => !existsSync(absolutePath));
  return {
    status: missing.length === 0 ? "pass" : "blocked",
    checked,
    missing,
  };
}

export function renderValidationSummary(title: string, checks: ValidationCheck[], notes: string[] = []): string {
  const overallStatus = combineValidationStatus(checks.map((check) => check.status));
  return [
    `# ${title}`,
    "",
    `Status: ${overallStatus}`,
    "",
    "Checks:",
    ...checks.map((check) => `- ${check.status.toUpperCase()} ${check.name}: ${check.detail}`),
    ...(notes.length > 0
      ? ["", "Notes:", ...notes.map((note) => `- ${note}`)]
      : []),
    "",
  ].join("\n");
}
