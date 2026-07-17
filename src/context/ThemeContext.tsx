"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
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

/** Overrides de color del modelo (accesibilidad). Persisten por navegador. */
export const MODEL_WALL_COLOR_KEY = "e2dModelWallColor";
export const MODEL_FLOOR_COLOR_KEY = "e2dModelFloorColor";
export const MODEL_BG_COLOR_KEY = "e2dModelBgColor";

/** Canal de color personalizable por el usuario. */
export type ModelColorChannel = "wall" | "floor" | "background";

export interface ModelColorOverrides {
  /** Color de pared elegido por el usuario, o `null` = el del tema. */
  wall: string | null;
  /** Color de piso elegido por el usuario, o `null` = el del tema. */
  floor: string | null;
  /** Color de fondo del visor 3D elegido por el usuario, o `null` = el del tema. */
  background: string | null;
}

const MODEL_COLOR_KEYS: Record<ModelColorChannel, string> = {
  wall: MODEL_WALL_COLOR_KEY,
  floor: MODEL_FLOOR_COLOR_KEY,
  background: MODEL_BG_COLOR_KEY,
};

function readStoredColor(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = localStorage.getItem(key);
    return v && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : null;
  } catch {
    return null;
  }
}

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
  /** Colores del modelo elegidos por el usuario (paredes/pisos/fondo). */
  modelColors: ModelColorOverrides;
  /** Fija (o limpia con `null`) el color de un canal (pared/piso/fondo). */
  setModelColor: (kind: ModelColorChannel, hex: string | null) => void;
  /** Vuelve todos los colores al default del tema. */
  resetModelColors: () => void;
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

/**
 * Aplica los overrides de pared/piso a las CSS vars que consumen la lista de
 * capas, los filtros y la barra (mantiene todo en sincronía con el visor 3D).
 */
function applyModelColorVars(theme: ThemeId, colors: ModelColorOverrides) {
  if (typeof document === "undefined") return;
  const palette = getViewerPalette(theme);
  const root = document.documentElement.style;
  root.setProperty("--viewer-wall", colors.wall ?? palette.wall);
  root.setProperty("--viewer-floor", colors.floor ?? palette.floor);
  root.setProperty("--viewer-bg", colors.background ?? palette.background);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>("dark");
  const [modelColors, setModelColors] = useState<ModelColorOverrides>({
    wall: null,
    floor: null,
    background: null,
  });
  const palette = getViewerPalette(theme);
  const paletteKey = viewerPaletteKey(palette);

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
    setModelColors({
      wall: readStoredColor(MODEL_WALL_COLOR_KEY),
      floor: readStoredColor(MODEL_FLOOR_COLOR_KEY),
      background: readStoredColor(MODEL_BG_COLOR_KEY),
    });
  }, []);

  const setModelColor = useCallback(
    (kind: ModelColorChannel, hex: string | null) => {
      setModelColors((prev) => ({ ...prev, [kind]: hex }));
      try {
        const key = MODEL_COLOR_KEYS[kind];
        if (hex) localStorage.setItem(key, hex);
        else localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    },
    [],
  );

  const resetModelColors = useCallback(() => {
    setModelColors({ wall: null, floor: null, background: null });
    try {
      for (const key of Object.values(MODEL_COLOR_KEYS)) {
        localStorage.removeItem(key);
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Reaplica CSS vars al cambiar el tema o el hex del tema (HMR), y encima los
  // overrides de color del modelo. El orden importa: tema primero, override después.
  useEffect(() => {
    applyTheme(theme);
    applyModelColorVars(theme, modelColors);
  }, [theme, paletteKey, modelColors]);

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
    <ThemeContext.Provider
      value={{ theme, setTheme, modelColors, setModelColor, resetModelColors }}
    >
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
  const { theme, modelColors } = useTheme();
  const palette = getViewerPalette(theme);
  const key = viewerPaletteKey(palette);
  // Dependé del contenido (hex), no solo del id de tema (así el HMR refresca el
  // modelo), y fusioná los overrides de color del usuario por encima del tema.
  return useMemo(() => {
    const base = getViewerPalette(theme);
    if (!modelColors.wall && !modelColors.floor && !modelColors.background) {
      return base;
    }
    return {
      ...base,
      wall: modelColors.wall ?? base.wall,
      floor: modelColors.floor ?? base.floor,
      background: modelColors.background ?? base.background,
    };
  }, [theme, key, modelColors]);
}
