// ============================================================================
// Sheet Nester — 2D Bin Packing for Laser Cutting Sheets
//
// Packs rectangular panels onto fixed-size sheets using a shelf-first-fit-
// decreasing (SFFD) algorithm with 90-degree rotation.
//
// Each panel can be rotated to find the best fit. Panels that exceed sheet
// dimensions in both orientations are reported as "unplaced".
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
  edges: Array<{ a: Vec2; b: Vec2 }>;
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
  unplaced: NestingPanel[];
}

// ---------------------------------------------------------------------------
// Shelf-based packing
// ---------------------------------------------------------------------------

interface Shelf {
  y: number;
  height: number;
  nextX: number;
}

interface SheetState {
  shelves: Shelf[];
  panels: PlacedNestingPanel[];
}

function tryFitOnSheet(
  sheet: SheetState,
  pw: number,
  ph: number,
  config: SheetConfig,
): { x: number; y: number; shelfIdx: number } | null {
  const { widthM, heightM, gapM } = config;

  for (let si = 0; si < sheet.shelves.length; si++) {
    const shelf = sheet.shelves[si];
    if (ph <= shelf.height + 0.0005 && shelf.nextX + pw <= widthM + 0.0005) {
      return { x: shelf.nextX, y: shelf.y, shelfIdx: si };
    }
  }

  const last = sheet.shelves[sheet.shelves.length - 1];
  const newY = last ? last.y + last.height + gapM : 0;

  if (newY + ph <= heightM + 0.0005 && pw <= widthM + 0.0005) {
    sheet.shelves.push({ y: newY, height: ph, nextX: 0 });
    return { x: 0, y: newY, shelfIdx: sheet.shelves.length - 1 };
  }

  return null;
}

function placeOnSheet(
  sheet: SheetState,
  panel: NestingPanel,
  pos: { x: number; y: number; shelfIdx: number },
  rotated: boolean,
  pw: number,
  ph: number,
  gapM: number,
): void {
  sheet.panels.push({
    panel,
    x: pos.x,
    y: pos.y,
    rotated,
    effectiveW: pw,
    effectiveH: ph,
  });
  sheet.shelves[pos.shelfIdx].nextX = pos.x + pw + gapM;
  if (ph > sheet.shelves[pos.shelfIdx].height) {
    sheet.shelves[pos.shelfIdx].height = ph;
  }
}

/**
 * Pack panels onto fixed-size sheets.
 *
 * The algorithm sorts panels by area (descending), then for each panel tries
 * to fit it on existing sheets/shelves in both orientations before opening a
 * new sheet. Rotation is only attempted when the two dimensions differ.
 */
export function nestPanels(
  panels: NestingPanel[],
  config: SheetConfig,
): NestingResult {
  const { widthM, heightM, gapM } = config;
  const sheetArea = widthM * heightM;

  const sorted = [...panels].sort(
    (a, b) => b.widthM * b.heightM - a.widthM * a.heightM,
  );

  const states: SheetState[] = [];
  const unplaced: NestingPanel[] = [];

  for (const panel of sorted) {
    const pw = panel.widthM;
    const ph = panel.heightM;

    const fitsNormal = pw <= widthM + 0.0005 && ph <= heightM + 0.0005;
    const fitsRotated = ph <= widthM + 0.0005 && pw <= heightM + 0.0005;
    const canRotate = fitsRotated && Math.abs(pw - ph) > 0.001;

    if (!fitsNormal && !fitsRotated) {
      unplaced.push(panel);
      continue;
    }

    let placed = false;

    for (const sheet of states) {
      if (fitsNormal) {
        const pos = tryFitOnSheet(sheet, pw, ph, config);
        if (pos) {
          placeOnSheet(sheet, panel, pos, false, pw, ph, gapM);
          placed = true;
          break;
        }
      }
      if (!placed && canRotate) {
        const pos = tryFitOnSheet(sheet, ph, pw, config);
        if (pos) {
          placeOnSheet(sheet, panel, pos, true, ph, pw, gapM);
          placed = true;
          break;
        }
      }
    }

    if (!placed) {
      const newSheet: SheetState = { shelves: [], panels: [] };
      states.push(newSheet);

      if (fitsNormal) {
        const pos = tryFitOnSheet(newSheet, pw, ph, config);
        if (pos) {
          placeOnSheet(newSheet, panel, pos, false, pw, ph, gapM);
          placed = true;
        }
      }
      if (!placed && canRotate) {
        const pos = tryFitOnSheet(newSheet, ph, pw, config);
        if (pos) {
          placeOnSheet(newSheet, panel, pos, true, ph, pw, gapM);
          placed = true;
        }
      }
      if (!placed) {
        unplaced.push(panel);
        states.pop();
      }
    }
  }

  const sheets: NestingSheet[] = states.map((s, i) => {
    let usedArea = 0;
    for (const p of s.panels) usedArea += p.effectiveW * p.effectiveH;
    return { index: i, panels: s.panels, utilization: usedArea / sheetArea };
  });

  return { sheets, config, unplaced };
}

/**
 * Rotate edge coordinates 90 degrees CW within the panel bounding box.
 * Original (widthM x heightM) becomes (heightM x widthM).
 * Point (x, y) maps to (y, widthM - x).
 */
export function rotateEdges(
  edges: Array<{ a: Vec2; b: Vec2 }>,
  originalW: number,
): Array<{ a: Vec2; b: Vec2 }> {
  return edges.map((e) => ({
    a: { x: e.a.y, y: originalW - e.a.x },
    b: { x: e.b.y, y: originalW - e.b.x },
  }));
}
