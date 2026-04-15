import { describe, expect, test } from "bun:test";

import { getStoredTheme, getSystemTheme, isTheme, resolveTheme, THEME_STORAGE_KEY } from "../src/web/app/lib/theme.ts";

describe("theme helpers", () => {
  test("recognizes supported themes", () => {
    expect(isTheme("light")).toBe(true);
    expect(isTheme("dark")).toBe(true);
    expect(isTheme("system")).toBe(true);
    expect(isTheme("sepia")).toBe(false);
  });

  test("resolves system theme from OS preference", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  test("loads stored theme with safe fallback", () => {
    const storage = {
      getItem(key: string) {
        return key === THEME_STORAGE_KEY ? "dark" : null;
      },
    };

    expect(getStoredTheme(storage)).toBe("dark");
    expect(getStoredTheme({ getItem: () => "sepia" })).toBe("system");
    expect(getStoredTheme(null)).toBe("system");
  });

  test("maps media-query state into resolved theme names", () => {
    expect(getSystemTheme(true)).toBe("dark");
    expect(getSystemTheme(false)).toBe("light");
  });
});
