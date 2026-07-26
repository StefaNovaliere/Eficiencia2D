/**
 * Paletas del visor 3D por tema.
 *
 * EDITÁ LOS HEX EN `VIEWER_PALETTES` ABAJO.
 * Con el tema activo en la app (p. ej. Neón), al guardar deberías ver el
 * cambio al instante en el modelo (fondo / paredes / pisos).
 */

export type ThemeId =
  | "neon"
  | "light"
  | "dark"
  | "aqua"
  | "valentine"
  | "sunset"
  | "halloween";

/** Colores del visor 3D: fondo + modelo + luces. */
export interface ViewerPalette {
  /** Fondo del canvas 3D. */
  background: string;
  isDark: boolean;
  /** Paredes del modelo. */
  wall: string;
  /** Pisos del modelo. */
  floor: string;
  /** Componentes descartados. */
  discard: string;
  /** Aristas / wireframe. */
  edge: string;
  edgeOpacity: number;
  /** Selección / acento del visor. */
  highlight: string;
  leaderPrimary: string;
  leaderSecondary: string;
  ambientLight: number;
  keyLight: number;
  fillLight: number;
  gizmoLabel: string;
}

/**
 * Paleta completa por tema.
 * Editá acá para personalizar fondo y colores del modelo.
 */
export const VIEWER_PALETTES: Record<ThemeId, ViewerPalette> = {
  /**
   * Neón (cyberpunk) — primary cian `#22e6ff` / secondary magenta `#ff2bd6`.
   * Fondo negro azul-violeta; paredes acero frío; pisos magenta.
   * `wall` y `floor` se mantienen separados en TONO y LUMINOSIDAD (accesibilidad
   * daltónica): acero claro ~L70 vs magenta oscuro ~L45.
   */
  neon: {
    background: "#0a0a14",
    isDark: true,
    wall: "#93A9C4",
    floor: "#B03A9E",
    discard: "#4E5A73",
    edge: "#7DF9FF",
    edgeOpacity: 0.55,
    highlight: "#22e6ff",
    leaderPrimary: "#22e6ff",
    leaderSecondary: "#ff2bd6",
    ambientLight: 0.78,
    keyLight: 0.8,
    fillLight: 0.45,
    gizmoLabel: "#e6f4ff",
  },

  /**
   * Claro — UI neutra.
   * Fondo gris frío; paredes plata; piso sage (verde arquitectónico).
   */
  light: {
    background: "#eef0f4",
    isDark: false,
    wall: "#B0B5BE",
    floor: "#5F7D68",
    discard: "#8A929E",
    edge: "#0f1419",
    edgeOpacity: 0.58,
    highlight: "#d97706",
    leaderPrimary: "#d97706",
    leaderSecondary: "#2563eb",
    ambientLight: 0.55,
    keyLight: 0.72,
    fillLight: 0.38,
    gizmoLabel: "#1e293b",
  },

  /**
   * Oscuro — base cálida.
   * Fondo carbón cálido; paredes piedra; piso madera/terracota.
   */
  dark: {
    background: "#12100e",
    isDark: true,
    wall: "#A8A49E",
    floor: "#C48A5A",
    discard: "#7A7F88",
    edge: "#e8ecf0",
    edgeOpacity: 0.38,
    highlight: "#fbbf24",
    leaderPrimary: "#fbbf24",
    leaderSecondary: "#60a5fa",
    ambientLight: 0.85,
    keyLight: 0.72,
    fillLight: 0.4,
    gizmoLabel: "#fafaf9",
  },

  /**
   * Aqua — primary cian `#09ecf3` / sky.
   * Fondo aqua suave; paredes azul-gris; piso teal profundo.
   */
  aqua: {
    background: "#d4f1f5",
    isDark: false,
    wall: "#8AADB8",
    floor: "#1F7A8C",
    discard: "#7A9098",
    edge: "#0c2a32",
    edgeOpacity: 0.55,
    highlight: "#0284c7",
    leaderPrimary: "#0284c7",
    leaderSecondary: "#0d9488",
    ambientLight: 0.55,
    keyLight: 0.72,
    fillLight: 0.38,
    gizmoLabel: "#0f3d47",
  },

  /**
   * Valentine — primary rosa `#e96d7b`.
   * Fondo blush; paredes gris rosado; piso malva.
   */
  valentine: {
    background: "#fde8eb",
    isDark: false,
    wall: "#C4A8B0",
    floor: "#9B4D6C",
    discard: "#9A848C",
    edge: "#3b1524",
    edgeOpacity: 0.55,
    highlight: "#db2777",
    leaderPrimary: "#db2777",
    leaderSecondary: "#7c3aed",
    ambientLight: 0.55,
    keyLight: 0.72,
    fillLight: 0.38,
    gizmoLabel: "#4a1528",
  },

  /**
   * Sunset — primary naranja `#ff865b`.
   * Fondo melocotón; paredes arena; piso terracota.
   */
  sunset: {
    background: "#ffedd5",
    isDark: false,
    wall: "#C4B5A5",
    floor: "#B4532A",
    discard: "#9A8B7C",
    edge: "#3b1f0e",
    edgeOpacity: 0.55,
    highlight: "#c2410c",
    leaderPrimary: "#c2410c",
    leaderSecondary: "#b45309",
    ambientLight: 0.55,
    keyLight: 0.72,
    fillLight: 0.38,
    gizmoLabel: "#431407",
  },

  /**
   * Halloween — primary naranja `#f28c18`.
   * Fondo noche cálida; paredes piedra; piso calabaza/ámbar.
   */
  halloween: {
    background: "#1a140f",
    isDark: true,
    wall: "#9A8F82",
    floor: "#D97706",
    discard: "#6B6358",
    edge: "#fef3c7",
    edgeOpacity: 0.4,
    highlight: "#f97316",
    leaderPrimary: "#f97316",
    leaderSecondary: "#fbbf24",
    ambientLight: 0.85,
    keyLight: 0.72,
    fillLight: 0.4,
    gizmoLabel: "#fafaf9",
  },
};

/** Metadatos UI del selector de tema (swatch + preview del modelo). */
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
    preview: {
      bg: VIEWER_PALETTES.dark.background,
      wall: VIEWER_PALETTES.dark.wall,
      floor: VIEWER_PALETTES.dark.floor,
    },
  },
  {
    id: "neon",
    label: "Neón",
    swatch: "#22e6ff",
    preview: {
      bg: VIEWER_PALETTES.neon.background,
      wall: VIEWER_PALETTES.neon.wall,
      floor: VIEWER_PALETTES.neon.floor,
    },
  },
  {
    id: "light",
    label: "Claro",
    swatch: "#ffffff",
    preview: {
      bg: VIEWER_PALETTES.light.background,
      wall: VIEWER_PALETTES.light.wall,
      floor: VIEWER_PALETTES.light.floor,
    },
  },
  {
    id: "aqua",
    label: "Aqua",
    swatch: "#09ecf3",
    preview: {
      bg: VIEWER_PALETTES.aqua.background,
      wall: VIEWER_PALETTES.aqua.wall,
      floor: VIEWER_PALETTES.aqua.floor,
    },
  },
  {
    id: "valentine",
    label: "Valentine",
    swatch: "#e96d7b",
    preview: {
      bg: VIEWER_PALETTES.valentine.background,
      wall: VIEWER_PALETTES.valentine.wall,
      floor: VIEWER_PALETTES.valentine.floor,
    },
  },
  {
    id: "sunset",
    label: "Sunset",
    swatch: "#ff865b",
    preview: {
      bg: VIEWER_PALETTES.sunset.background,
      wall: VIEWER_PALETTES.sunset.wall,
      floor: VIEWER_PALETTES.sunset.floor,
    },
  },
  {
    id: "halloween",
    label: "Halloween",
    swatch: "#f28c18",
    preview: {
      bg: VIEWER_PALETTES.halloween.background,
      wall: VIEWER_PALETTES.halloween.wall,
      floor: VIEWER_PALETTES.halloween.floor,
    },
  },
];

export function getViewerPalette(theme: ThemeId): ViewerPalette {
  return VIEWER_PALETTES[theme] ?? VIEWER_PALETTES.light;
}

/** Clave estable de contenido: cambia si editás hex (útil para HMR / materiales). */
export function viewerPaletteKey(palette: ViewerPalette): string {
  return [
    palette.background,
    palette.wall,
    palette.floor,
    palette.discard,
    palette.edge,
    palette.edgeOpacity,
    palette.highlight,
    palette.leaderPrimary,
    palette.leaderSecondary,
    palette.ambientLight,
    palette.keyLight,
    palette.fillLight,
    palette.gizmoLabel,
    palette.isDark ? "1" : "0",
  ].join("|");
}

export function getViewerBackground(theme: ThemeId): string {
  return getViewerPalette(theme).background;
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Colores del canvas de nesting derivados de la paleta del tema. */
export function getNestingCanvasColors(theme: ThemeId) {
  const palette = getViewerPalette(theme);
  return {
    wall: palette.wall,
    floor: palette.floor,
    sheetBg: hexToRgba(palette.background, palette.isDark ? 0.97 : 0.94),
    sheetStroke: palette.edge,
    labelText: palette.isDark ? "#cbd5e1" : "#334155",
    /**
     * Trazo del patrón de flexión (kerf/auxético). Debe CONTRASTAR con la
     * plancha: sobre plancha oscura un casi-negro es invisible, así que se
     * invierte por tema. No confundir con el rojo de grabado (`#dc2626`), que
     * es semántica de taller y no cambia.
     */
    flexStroke: palette.isDark ? "#e8eef5" : "#111827",
  };
}
