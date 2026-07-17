"use client";

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import {
  THEMES,
  getNestingCanvasColors,
  getViewerBackground,
  getViewerPalette,
  viewerPaletteKey,
  type ThemeId,
  type ViewerPalette,
} from "@/theme/viewer-palettes";

export type { ThemeId, ViewerPalette };
export {
  THEMES,
  getNestingCanvasColors,
  getViewerBackground,
  getViewerPalette,
  viewerPaletteKey,
};

const VALID_THEMES = new Set<string>(THEMES.map((t) => t.id));

export const BASE_THEME_STORAGE_KEY = "e2dBaseTheme";

export function getBaseThemeId(): ThemeId {
  if (typeof window === "undefined") return "dark";
  try {
    const base = localStorage.getItem(BASE_THEME_STORAGE_KEY);
    if (base && base !== "neon" && VALID_THEMES.has(base)) return base as ThemeId;
  } catch {
    /* ignore */
  }
  return "dark";
}

export function getStoredThemeId(): ThemeId {
  if (typeof window === "undefined") return "dark";
  try {
    const saved = localStorage.getItem("theme");
    if (saved && VALID_THEMES.has(saved)) return saved as ThemeId;
  } catch {
    /* ignore */
  }
  try {
    if (window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
  } catch {
    /* ignore */
  }
  return "light";
}

interface ThemeContextValue {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function applyViewerTheme(theme: ThemeId) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
  const palette = getViewerPalette(theme);
  const root = document.documentElement.style;
  root.setProperty("--viewer-bg", palette.background);
  root.setProperty("--viewer-floor", palette.floor);
  root.setProperty("--viewer-wall", palette.wall);
  root.setProperty("--viewer-discard", palette.discard);
  root.setProperty("--viewer-edge", palette.edge);
  root.setProperty("--viewer-highlight", palette.highlight);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(() =>
    typeof window !== "undefined" ? getStoredThemeId() : "dark",
  );

  useLayoutEffect(() => {
    applyViewerTheme(theme);
  }, [theme]);

  const setTheme = useCallback((next: ThemeId) => {
    setThemeState(next);
    applyViewerTheme(next);
    try {
      localStorage.setItem("theme", next);
      if (next !== "neon") {
        localStorage.setItem(BASE_THEME_STORAGE_KEY, next);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return ctx;
}

export function useViewerPalette(): ViewerPalette {
  const { theme } = useTheme();
  return getViewerPalette(theme);
}
