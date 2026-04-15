import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";

import {
  getStoredTheme,
  getSystemTheme,
  resolveTheme,
  THEME_META_COLORS,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type Theme,
} from "@/lib/theme";

type ThemeContextValue = {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyResolvedTheme(theme: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.dataset.theme = theme;
  root.style.colorScheme = theme;

  const metaTheme = document.querySelector('meta[name="theme-color"]');
  metaTheme?.setAttribute("content", THEME_META_COLORS[theme]);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === "undefined") {
      return "system";
    }
    try {
      return getStoredTheme(window.localStorage);
    } catch {
      return "system";
    }
  });
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => {
    if (typeof window === "undefined") {
      return "dark";
    }
    return getSystemTheme(window.matchMedia("(prefers-color-scheme: dark)").matches);
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const updateTheme = (matchesDark: boolean) => setSystemTheme(getSystemTheme(matchesDark));

    updateTheme(mediaQuery.matches);

    const onChange = (event: MediaQueryListEvent) => updateTheme(event.matches);
    mediaQuery.addEventListener?.("change", onChange);
    return () => mediaQuery.removeEventListener?.("change", onChange);
  }, []);

  const resolvedTheme = useMemo(() => resolveTheme(theme, systemTheme === "dark"), [systemTheme, theme]);

  useEffect(() => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {}
    applyResolvedTheme(resolvedTheme);
  }, [resolvedTheme, theme]);

  const value = useMemo(() => ({ theme, resolvedTheme, setTheme }), [resolvedTheme, theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}
