import { describe, expect, test } from "bun:test";

import { toUserFacingError } from "../src/web/app/lib/utils.ts";

describe("web utils", () => {
  test("toUserFacingError returns safe actionable copy", () => {
    const original = console.error;
    console.error = () => {};
    const error = toUserFacingError("Could not load the dashboard", new Error("boom"));
    console.error = original;
    expect(error).toBe("Could not load the dashboard. Refresh and try again.");
  });
});
