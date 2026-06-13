"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type ThemeId =
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
    id: "light",
    label: "Claro",
    swatch: "#ffffff",
    preview: { bg: "#eef0f4", wall: ARCH_ON_LIGHT_BG.wall, floor: ARCH_ON_LIGHT_BG.floor },
  },
  {
    id: "dark",
    label: "Oscuro",
    swatch: "#1f2937",
    preview: { bg: "#12100e", wall: ARCH_ON_DARK_BG.wall, floor: ARCH_ON_DARK_BG.floor },
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

export function getStoredThemeId(): ThemeId {
  if (typeof window === "undefined") return "light";
  try {
    const saved = localStorage.getItem("theme");
    if (saved && VALID_THEMES.has(saved)) return saved as ThemeId;
  } catch {
    /* ignore */
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

interface ThemeContextValue {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
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

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>("light");

  useEffect(() => {
    const initial = resolveInitialTheme();
    setThemeState(initial);
    applyTheme(initial);
  }, []);

  const setTheme = useCallback((next: ThemeId) => {
    setThemeState(next);
    applyTheme(next);
    try {
      localStorage.setItem("theme", next);
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
