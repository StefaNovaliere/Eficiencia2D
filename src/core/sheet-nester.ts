// ============================================================================
// Sheet Nester — 2D Bin Packing for Laser Cutting Sheets
//
// Uses the Maximal Rectangles (MAXRECTS) algorithm with Best Short Side Fit
// heuristic. For each panel we evaluate every free rectangle on every sheet
// (in both orientations) and pick the placement that wastes the least space.
//
// MAXRECTS distributes panels naturally throughout each sheet rather than
// pile-up-from-the-bottom shelf packing.
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
  scaleDenom: number;
  unplaced: NestingPanel[];
}

// ---------------------------------------------------------------------------
// MAXRECTS
// ---------------------------------------------------------------------------

interface FreeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface SheetState {
  freeRects: FreeRect[];
  panels: PlacedNestingPanel[];
}

const EPS = 0.0005;

/** Best Short Side Fit — minimize the shorter leftover dimension. */
function findBestRect(
  freeRects: FreeRect[],
  pw: number,
  ph: number,
): { x: number; y: number; score: number } | null {
  let best: { x: number; y: number; score: number } | null = null;
  for (const rect of freeRects) {
    if (pw <= rect.w + EPS && ph <= rect.h + EPS) {
      const leftH = rect.w - pw;
      const leftV = rect.h - ph;
      const shortSide = Math.min(leftH, leftV);
      const longSide = Math.max(leftH, leftV);
      const score = shortSide * 1000 + longSide;
      if (!best || score < best.score) {
        best = { x: rect.x, y: rect.y, score };
      }
    }
  }
  return best;
}

function pruneContained(rects: FreeRect[]): FreeRect[] {
  const out: FreeRect[] = [];
  for (let i = 0; i < rects.length; i++) {
    const ri = rects[i];
    let contained = false;
    for (let j = 0; j < rects.length; j++) {
      if (i === j) continue;
      const rj = rects[j];
      if (
        ri.x >= rj.x - EPS &&
        ri.y >= rj.y - EPS &&
        ri.x + ri.w <= rj.x + rj.w + EPS &&
        ri.y + ri.h <= rj.y + rj.h + EPS
      ) {
        contained = true;
        break;
      }
    }
    if (!contained) out.push(ri);
  }
  return out;
}

function commitPlacement(
  sheet: SheetState,
  panel: NestingPanel,
  px: number,
  py: number,
  rotated: boolean,
  pw: number,
  ph: number,
  gap: number,
): void {
  sheet.panels.push({
    panel,
    x: px,
    y: py,
    rotated,
    effectiveW: pw,
    effectiveH: ph,
  });

  const bx2 = px + pw + gap;
  const by2 = py + ph + gap;
  const next: FreeRect[] = [];

  for (const rect of sheet.freeRects) {
    const rx2 = rect.x + rect.w;
    const ry2 = rect.y + rect.h;

    if (bx2 <= rect.x || px >= rx2 || by2 <= rect.y || py >= ry2) {
      next.push(rect);
      continue;
    }

    if (px > rect.x) {
      next.push({ x: rect.x, y: rect.y, w: px - rect.x, h: rect.h });
    }
    if (bx2 < rx2) {
      next.push({ x: bx2, y: rect.y, w: rx2 - bx2, h: rect.h });
    }
    if (py > rect.y) {
      next.push({ x: rect.x, y: rect.y, w: rect.w, h: py - rect.y });
    }
    if (by2 < ry2) {
      next.push({ x: rect.x, y: by2, w: rect.w, h: ry2 - by2 });
    }
  }

  const cleaned = next.filter((r) => r.w > 0.001 && r.h > 0.001);
  sheet.freeRects = pruneContained(cleaned);
}

export function nestPanels(
  panels: NestingPanel[],
  config: SheetConfig,
  scaleDenom: number = 1,
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
    const fitsN = pw <= widthM + EPS && ph <= heightM + EPS;
    const fitsR = ph <= widthM + EPS && pw <= heightM + EPS;
    const canRotate = fitsR && Math.abs(pw - ph) > 0.001;

    if (!fitsN && !fitsR) {
      unplaced.push(panel);
      continue;
    }

    let bestSheet = -1;
    let bestX = 0, bestY = 0, bestPw = 0, bestPh = 0;
    let bestRot = false;
    let bestScore = Infinity;

    for (let si = 0; si < states.length; si++) {
      if (fitsN) {
        const r = findBestRect(states[si].freeRects, pw, ph);
        if (r && r.score < bestScore) {
          bestScore = r.score;
          bestSheet = si;
          bestX = r.x; bestY = r.y;
          bestPw = pw; bestPh = ph;
          bestRot = false;
        }
      }
      if (canRotate) {
        const r = findBestRect(states[si].freeRects, ph, pw);
        if (r && r.score < bestScore) {
          bestScore = r.score;
          bestSheet = si;
          bestX = r.x; bestY = r.y;
          bestPw = ph; bestPh = pw;
          bestRot = true;
        }
      }
    }

    if (bestSheet >= 0) {
      commitPlacement(states[bestSheet], panel, bestX, bestY, bestRot, bestPw, bestPh, gapM);
      continue;
    }

    const newSheet: SheetState = {
      freeRects: [{ x: 0, y: 0, w: widthM, h: heightM }],
      panels: [],
    };
    let placed = false;
    if (fitsN) {
      const r = findBestRect(newSheet.freeRects, pw, ph);
      if (r) {
        commitPlacement(newSheet, panel, r.x, r.y, false, pw, ph, gapM);
        placed = true;
      }
    }
    if (!placed && canRotate) {
      const r = findBestRect(newSheet.freeRects, ph, pw);
      if (r) {
        commitPlacement(newSheet, panel, r.x, r.y, true, ph, pw, gapM);
        placed = true;
      }
    }
    if (placed) states.push(newSheet);
    else unplaced.push(panel);
  }

  const sheets: NestingSheet[] = states.map((s, i) => {
    let used = 0;
    for (const p of s.panels) used += p.effectiveW * p.effectiveH;
    return { index: i, panels: s.panels, utilization: used / sheetArea };
  });

  return { sheets, config, scaleDenom, unplaced };
}

/**
 * Rotate edge coordinates 90 degrees CW within the panel bounding box.
 * A (widthM x heightM) panel becomes (heightM x widthM).
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
