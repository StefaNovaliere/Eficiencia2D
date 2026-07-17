"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type ThemeId =
  | "neon"
  | "light"
  | "dark"
  | "aqua"
  | "valentine"
  | "sunset"
  | "halloween";

/** Colores del visor 3D: fondo según tema + modelo con paleta arquitectónica de contraste. */
export interface ViewerPalette {
  background: string;
  isDark: boolean;
  /** Paredes — gris plateado oscuro sobre fondos claros; plateado claro sobre fondos oscuros. */
  wall: string;
  /** Pisos — verde oscuro legible, distinto del gris de paredes. */
  floor: string;
  discard: string;
  edge: string;
  edgeOpacity: number;
  highlight: string;
  leaderPrimary: string;
  leaderSecondary: string;
  ambientLight: number;
  keyLight: number;
  fillLight: number;
  gizmoLabel: string;
}

/**
 * Colores del modelo 3D / planos: fijos y legibles sobre fondos claros u oscuros.
 * El tema solo cambia el fondo del visor y los acentos de UI, no el “color de la casa”.
 */
/** Casa oscura (gris plateado) sobre fondos claros del tema — nunca del color del fondo. */
const ARCH_ON_LIGHT_BG = {
  wall: "#C4C4C4",
  floor: "#8B6DA6",
  discard: "#828C99",
  edge: "#0f1419",
  edgeOpacity: 0.58,
} as const;

/** Casa en plateado claro sobre fondos oscuros del tema. */
const ARCH_ON_DARK_BG = {
  wall: "#9C9C9C",
  floor: "#CF9567",
  discard: "#8b95a3",
  edge: "#e8ecf0",
  edgeOpacity: 0.38,
} as const;

function modelOnLight(accent: {
  highlight: string;
  leaderPrimary: string;
  gizmoLabel?: string;
}): Pick<
  ViewerPalette,
  | "wall"
  | "floor"
  | "discard"
  | "edge"
  | "edgeOpacity"
  | "highlight"
  | "leaderPrimary"
  | "leaderSecondary"
  | "ambientLight"
  | "keyLight"
  | "fillLight"
  | "gizmoLabel"
> {
  return {
    ...ARCH_ON_LIGHT_BG,
    highlight: accent.highlight,
    leaderPrimary: accent.leaderPrimary,
    leaderSecondary: "#2563eb",
    ambientLight: 0.55,
    keyLight: 0.72,
    fillLight: 0.38,
    gizmoLabel: accent.gizmoLabel ?? "#1e293b",
  };
}

function modelOnDark(accent: {
  highlight: string;
  leaderPrimary: string;
}): Pick<
  ViewerPalette,
  | "wall"
  | "floor"
  | "discard"
  | "edge"
  | "edgeOpacity"
  | "highlight"
  | "leaderPrimary"
  | "leaderSecondary"
  | "ambientLight"
  | "keyLight"
  | "fillLight"
  | "gizmoLabel"
> {
  return {
    ...ARCH_ON_DARK_BG,
    highlight: accent.highlight,
    leaderPrimary: accent.leaderPrimary,
    leaderSecondary: "#60a5fa",
    ambientLight: 0.85,
    keyLight: 0.72,
    fillLight: 0.4,
    gizmoLabel: "#fafaf9",
  };
}

export const THEMES: {
  id: ThemeId;
  label: string;
  swatch: string;
  preview: { bg: string; wall: string; floor: string };
}[] = [
  {
    id: "dark",
    label: "Oscuro",
    swatch: "#1f2937",
    preview: { bg: "#12100e", wall: ARCH_ON_DARK_BG.wall, floor: ARCH_ON_DARK_BG.floor },
  },
  {
    id: "neon",
    label: "Neón",
    swatch: "#22d3ee",
    preview: { bg: "#070709", wall: ARCH_ON_DARK_BG.wall, floor: ARCH_ON_DARK_BG.floor },
  },
  {
    id: "light",
    label: "Claro",
    swatch: "#ffffff",
    preview: { bg: "#eef0f4", wall: ARCH_ON_LIGHT_BG.wall, floor: ARCH_ON_LIGHT_BG.floor },
  },
  {
    id: "aqua",
    label: "Aqua",
    swatch: "#09ecf3",
    preview: { bg: "#d4f1f5", wall: ARCH_ON_LIGHT_BG.wall, floor: ARCH_ON_LIGHT_BG.floor },
  },
  {
    id: "valentine",
    label: "Valentine",
    swatch: "#e96d7b",
    preview: { bg: "#fde8eb", wall: ARCH_ON_LIGHT_BG.wall, floor: ARCH_ON_LIGHT_BG.floor },
  },
  {
    id: "sunset",
    label: "Sunset",
    swatch: "#ff865b",
    preview: { bg: "#ffedd5", wall: ARCH_ON_LIGHT_BG.wall, floor: ARCH_ON_LIGHT_BG.floor },
  },
  {
    id: "halloween",
    label: "Halloween",
    swatch: "#f28c18",
    preview: { bg: "#1a140f", wall: ARCH_ON_DARK_BG.wall, floor: ARCH_ON_DARK_BG.floor },
  },
];

const VALID_THEMES = new Set<string>(THEMES.map((t) => t.id));

export const BASE_THEME_STORAGE_KEY = "e2dBaseTheme";

/** Overrides de color del modelo (accesibilidad). Persisten por navegador. */
export const MODEL_WALL_COLOR_KEY = "e2dModelWallColor";
export const MODEL_FLOOR_COLOR_KEY = "e2dModelFloorColor";

export interface ModelColorOverrides {
  /** Color de pared elegido por el usuario, o `null` = el del tema. */
  wall: string | null;
  /** Color de piso elegido por el usuario, o `null` = el del tema. */
  floor: string | null;
}

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
  /** Colores del modelo elegidos por el usuario (paredes/pisos). */
  modelColors: ModelColorOverrides;
  /** Fija (o limpia con `null`) el color de paredes o pisos. */
  setModelColor: (kind: "wall" | "floor", hex: string | null) => void;
  /** Vuelve ambos colores al default del tema. */
  resetModelColors: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function resolveInitialTheme(): ThemeId {
  return getStoredThemeId();
}

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
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>("dark");
  const [modelColors, setModelColors] = useState<ModelColorOverrides>({
    wall: null,
    floor: null,
  });

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
    });
  }, []);

  // Mantiene las CSS vars del modelo alineadas con el override (o el tema).
  useEffect(() => {
    applyModelColorVars(theme, modelColors);
  }, [theme, modelColors]);

  const setModelColor = useCallback(
    (kind: "wall" | "floor", hex: string | null) => {
      setModelColors((prev) => ({ ...prev, [kind]: hex }));
      try {
        const key = kind === "wall" ? MODEL_WALL_COLOR_KEY : MODEL_FLOOR_COLOR_KEY;
        if (hex) localStorage.setItem(key, hex);
        else localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    },
    [],
  );

  const resetModelColors = useCallback(() => {
    setModelColors({ wall: null, floor: null });
    try {
      localStorage.removeItem(MODEL_WALL_COLOR_KEY);
      localStorage.removeItem(MODEL_FLOOR_COLOR_KEY);
    } catch {
      /* ignore */
    }
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
  return useMemo(() => {
    const base = getViewerPalette(theme);
    if (!modelColors.wall && !modelColors.floor) return base;
    return {
      ...base,
      wall: modelColors.wall ?? base.wall,
      floor: modelColors.floor ?? base.floor,
    };
  }, [theme, modelColors]);
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function getNestingCanvasColors(theme: ThemeId) {
  const palette = getViewerPalette(theme);
  return {
    wall: palette.wall,
    floor: palette.floor,
    sheetBg: hexToRgba(palette.background, palette.isDark ? 0.97 : 0.94),
    sheetStroke: palette.edge,
    labelText: palette.isDark ? "#cbd5e1" : "#334155",
  };
}

const VIEWER_PALETTES: Record<ThemeId, ViewerPalette> = {
  neon: {
    background: "#070709",
    isDark: true,
    ...modelOnDark({ highlight: "#22d3ee", leaderPrimary: "#22d3ee" }),
  },
  light: {
    background: "#eef0f4",
    isDark: false,
    ...modelOnLight({ highlight: "#d97706", leaderPrimary: "#d97706" }),
  },
  dark: {
    background: "#12100e",
    isDark: true,
    ...modelOnDark({ highlight: "#fbbf24", leaderPrimary: "#fbbf24" }),
  },
  aqua: {
    background: "#d4f1f5",
    isDark: false,
    ...modelOnLight({ highlight: "#0284c7", leaderPrimary: "#0284c7" }),
  },
  valentine: {
    background: "#fde8eb",
    isDark: false,
    ...modelOnLight({ highlight: "#db2777", leaderPrimary: "#db2777" }),
  },
  sunset: {
    background: "#ffedd5",
    isDark: false,
    ...modelOnLight({ highlight: "#c2410c", leaderPrimary: "#c2410c" }),
  },
  halloween: {
    background: "#1a140f",
    isDark: true,
    ...modelOnDark({ highlight: "#f97316", leaderPrimary: "#f97316" }),
  },
};

export function getViewerPalette(theme: ThemeId): ViewerPalette {
  return VIEWER_PALETTES[theme] ?? VIEWER_PALETTES.light;
}

export function getViewerBackground(theme: ThemeId): string {
  return getViewerPalette(theme).background;
}
