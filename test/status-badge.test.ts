import { describe, expect, test } from "bun:test";

import { getStatusBadgeVariant } from "../src/web/app/components/orchd/status-badge.tsx";

describe("status badge", () => {
  test("maps healthy and running states to success", () => {
    expect(getStatusBadgeVariant("running")).toBe("success");
    expect(getStatusBadgeVariant("completed")).toBe("success");
    expect(getStatusBadgeVariant("healthy")).toBe("success");
  });

  test("maps approval and degraded states to warning", () => {
    expect(getStatusBadgeVariant("waiting_approval")).toBe("warning");
    expect(getStatusBadgeVariant("waiting_input")).toBe("warning");
    expect(getStatusBadgeVariant("degraded")).toBe("warning");
  });

  test("maps failed states to destructive", () => {
    expect(getStatusBadgeVariant("failed")).toBe("destructive");
    expect(getStatusBadgeVariant("error")).toBe("destructive");
  });

  test("falls back to outline for unknown states", () => {
    expect(getStatusBadgeVariant("idle")).toBe("outline");
  });
});
