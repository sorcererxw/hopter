import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkRequiredPaths, combineValidationStatus, renderValidationSummary } from "../scripts/lib/rebuild-validation.ts";

describe("rebuild validation helpers", () => {
  test("combineValidationStatus prefers fail over blocked over pass", () => {
    expect(combineValidationStatus(["pass", "blocked"])).toBe("blocked");
    expect(combineValidationStatus(["pass", "fail", "blocked"])).toBe("fail");
    expect(combineValidationStatus(["pass", "pass"])).toBe("pass");
  });

  test("checkRequiredPaths reports missing paths as blocked", () => {
    const root = mkdtempSync(path.join(tmpdir(), "orchd-rebuild-validation-"));
    mkdirSync(path.join(root, "idl"), { recursive: true });

    const result = checkRequiredPaths(["idl", "missing.txt"], root);
    expect(result.status).toBe("blocked");
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0]).toBe(path.join(root, "missing.txt"));
  });

  test("renderValidationSummary includes overall status and notes", () => {
    const summary = renderValidationSummary("Example", [
      { name: "buf lint", status: "pass", detail: "ok" },
      { name: "go server", status: "blocked", detail: "missing go.mod" },
    ], ["notes stay visible"]);

    expect(summary).toContain("# Example");
    expect(summary).toContain("Status: blocked");
    expect(summary).toContain("buf lint");
    expect(summary).toContain("notes stay visible");
  });
});
