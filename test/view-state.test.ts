import { describe, expect, test } from "bun:test";

import { resolveSelectedArtifactId } from "../src/web/app/lib/view-state.ts";

describe("view state helpers", () => {
  test("returns null when there are no artifacts", () => {
    expect(resolveSelectedArtifactId([], null)).toBeNull();
  });

  test("keeps the current artifact when it still exists", () => {
    expect(resolveSelectedArtifactId(["a", "b"], "b")).toBe("b");
  });

  test("falls back to the first artifact when current selection disappears", () => {
    expect(resolveSelectedArtifactId(["a", "b"], "c")).toBe("a");
  });
});
