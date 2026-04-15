export const THEME_STORAGE_KEY = "orchd.ui.theme.v1";

export const THEMES = ["light", "dark", "system"] as const;

export type Theme = typeof THEMES[number];
export type ResolvedTheme = Exclude<Theme, "system">;

export const THEME_META_COLORS: Record<ResolvedTheme, string> = {
  light: "#fafafa",
  dark: "#09090b",
};

export function isTheme(value: string | null | undefined): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}

export function resolveTheme(theme: Theme, prefersDark: boolean): ResolvedTheme {
  if (theme === "system") {
    return prefersDark ? "dark" : "light";
  }
  return theme;
}

export function getStoredTheme(storage: Pick<Storage, "getItem"> | null | undefined): Theme {
  const stored = storage?.getItem(THEME_STORAGE_KEY);
  return isTheme(stored) ? stored : "system";
}

export function getSystemTheme(matchesDark: boolean): ResolvedTheme {
  return matchesDark ? "dark" : "light";
}
