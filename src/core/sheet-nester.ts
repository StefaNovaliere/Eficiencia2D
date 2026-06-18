// ============================================================================
// Nesting types (thin client)
//
// El algoritmo de nesting (MAXRECTS) vive en el backend. Acá sólo quedan los
// tipos que devuelve `/api/nesting-preview` y un helper de DIBUJO 2D puro
// (`rotateEdges`) que usa `NestingPreview` para pintar paneles rotados.
// ============================================================================

import type { Vec2 } from "./types";

export interface SheetConfig {
  widthM: number;
  heightM: number;
  gapM: number;
}

export const DEFAULT_SHEET: SheetConfig = {
  widthM: 1.0,
  heightM: 0.6,
  gapM: 0.003,
};

export interface NestingPanel {
  id: string;
  category: "wall" | "floor";
  widthM: number;
  heightM: number;
  edges: Array<{ a: Vec2; b: Vec2; hole?: boolean }>;
  /** When true, this component's openings (hole edges) are engraved (red) not cut. */
  isMark?: boolean;
}

export interface PlacedNestingPanel {
  panel: NestingPanel;
  x: number;
  y: number;
  rotated: boolean;
  effectiveW: number;
  effectiveH: number;
}

export interface NestingSheet {
  index: number;
  panels: PlacedNestingPanel[];
  utilization: number;
}

export interface NestingResult {
  sheets: NestingSheet[];
  config: SheetConfig;
  scaleDenom: number;
  unplaced: NestingPanel[];
}

/** Rota las aristas de un panel 90° (dibujo 2D puro). Lo usa NestingPreview. */
export function rotateEdges(
  edges: Array<{ a: Vec2; b: Vec2; hole?: boolean }>,
  originalW: number,
): Array<{ a: Vec2; b: Vec2; hole?: boolean }> {
  return edges.map((e) => ({
    a: { x: e.a.y, y: originalW - e.a.x },
    b: { x: e.b.y, y: originalW - e.b.x },
    hole: e.hole,
  }));
}
