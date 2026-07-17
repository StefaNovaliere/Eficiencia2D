"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  THEMES,
  getNestingCanvasColors,
  getViewerBackground,
  getViewerPalette,
  type ThemeId,
  type ViewerPalette,
} from "@/theme/viewer-palettes";

export type { ThemeId, ViewerPalette };
export {
  THEMES,
  getNestingCanvasColors,
  getViewerBackground,
  getViewerPalette,
};

const VALID_THEMES = new Set<string>(THEMES.map((t) => t.id));

export const BASE_THEME_STORAGE_KEY = "e2dBaseTheme";

/** Tema base de la app (sin Neón): oscuro por defecto. */
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

function resolveInitialTheme(): ThemeId {
  return getStoredThemeId();
}

/** Aplica data-theme + CSS vars del visor desde `viewer-palettes.ts`. */
function applyTheme(theme: ThemeId) {
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
  const [theme, setThemeState] = useState<ThemeId>("dark");

  useEffect(() => {
    try {
      const base = localStorage.getItem(BASE_THEME_STORAGE_KEY);
      const saved = localStorage.getItem("theme");
      if (!base && saved === "light") {
        localStorage.setItem("theme", "dark");
        localStorage.setItem(BASE_THEME_STORAGE_KEY, "dark");
      }
    } catch {
      /* ignore */
    }

    const initial = resolveInitialTheme();
    setThemeState(initial);
    applyTheme(initial);
  }, []);

  const setTheme = useCallback((next: ThemeId) => {
    setThemeState(next);
    applyTheme(next);
    try {
      localStorage.setItem("theme", next);
      if (next !== "neon") {
        localStorage.setItem(BASE_THEME_STORAGE_KEY, next);
      }
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
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
  return useMemo(() => getViewerPalette(theme), [theme]);
}
