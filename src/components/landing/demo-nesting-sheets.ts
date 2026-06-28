import type { NestingPanel, NestingSheet, SheetConfig } from "@/core/sheet-nester";

function rectEdges(w: number, h: number): NestingPanel["edges"] {
  return [
    { a: { x: 0, y: 0 }, b: { x: w, y: 0 } },
    { a: { x: w, y: 0 }, b: { x: w, y: h } },
    { a: { x: w, y: h }, b: { x: 0, y: h } },
    { a: { x: 0, y: h }, b: { x: 0, y: 0 } },
  ];
}

function panel(
  id: string,
  category: "wall" | "floor",
  widthM: number,
  heightM: number,
  edges: NestingPanel["edges"],
  extra?: Pick<NestingPanel, "isMark">,
): NestingPanel {
  return { id, category, widthM, heightM, edges, ...extra };
}

/** Paneles con contornos distintos — mismos tipos que devuelve el nesting. */
export const DEMO_SHEET_CONFIG: SheetConfig = {
  widthM: 1.0,
  heightM: 0.6,
  gapM: 0.003,
};

export const DEMO_NESTING_SHEETS: NestingSheet[] = [
  {
    index: 0,
    utilization: 0.74,
    panels: [
      {
        panel: panel("P1", "wall", 0.34, 0.19, rectEdges(0.34, 0.19)),
        x: 0.012,
        y: 0.014,
        rotated: false,
        effectiveW: 0.34,
        effectiveH: 0.19,
      },
      {
        panel: panel("P2", "wall", 0.1, 0.41, rectEdges(0.1, 0.41)),
        x: 0.36,
        y: 0.014,
        rotated: false,
        effectiveW: 0.1,
        effectiveH: 0.41,
      },
      {
        panel: panel("P3", "floor", 0.5, 0.11, rectEdges(0.5, 0.11)),
        x: 0.012,
        y: 0.22,
        rotated: false,
        effectiveW: 0.5,
        effectiveH: 0.11,
      },
      {
        panel: panel("M1", "wall", 0.17, 0.12, [
          ...rectEdges(0.17, 0.12),
          { a: { x: 0.04, y: 0.03 }, b: { x: 0.13, y: 0.03 }, hole: true },
          { a: { x: 0.13, y: 0.03 }, b: { x: 0.13, y: 0.09 }, hole: true },
          { a: { x: 0.13, y: 0.09 }, b: { x: 0.04, y: 0.09 }, hole: true },
          { a: { x: 0.04, y: 0.09 }, b: { x: 0.04, y: 0.03 }, hole: true },
        ], { isMark: true }),
        x: 0.52,
        y: 0.2,
        rotated: false,
        effectiveW: 0.17,
        effectiveH: 0.12,
      },
      {
        panel: panel("P4", "floor", 0.21, 0.16, rectEdges(0.21, 0.16)),
        x: 0.72,
        y: 0.014,
        rotated: false,
        effectiveW: 0.21,
        effectiveH: 0.16,
      },
    ],
  },
  {
    index: 1,
    utilization: 0.68,
    panels: [
      {
        panel: panel("P5", "wall", 0.38, 0.26, [
          { a: { x: 0, y: 0 }, b: { x: 0.38, y: 0 } },
          { a: { x: 0.38, y: 0 }, b: { x: 0.38, y: 0.13 } },
          { a: { x: 0.38, y: 0.13 }, b: { x: 0.17, y: 0.13 } },
          { a: { x: 0.17, y: 0.13 }, b: { x: 0.17, y: 0.26 } },
          { a: { x: 0.17, y: 0.26 }, b: { x: 0, y: 0.26 } },
          { a: { x: 0, y: 0.26 }, b: { x: 0, y: 0 } },
        ]),
        x: 0.015,
        y: 0.015,
        rotated: false,
        effectiveW: 0.38,
        effectiveH: 0.26,
      },
      {
        panel: panel("P6", "wall", 0.22, 0.18, [
          { a: { x: 0.04, y: 0 }, b: { x: 0.22, y: 0 } },
          { a: { x: 0.22, y: 0 }, b: { x: 0.18, y: 0.18 } },
          { a: { x: 0.18, y: 0.18 }, b: { x: 0, y: 0.14 } },
          { a: { x: 0, y: 0.14 }, b: { x: 0.04, y: 0 } },
        ]),
        x: 0.42,
        y: 0.015,
        rotated: false,
        effectiveW: 0.22,
        effectiveH: 0.18,
      },
      {
        panel: panel("P7", "floor", 0.08, 0.38, rectEdges(0.08, 0.38)),
        x: 0.68,
        y: 0.015,
        rotated: false,
        effectiveW: 0.08,
        effectiveH: 0.38,
      },
      {
        panel: panel("P8", "floor", 0.28, 0.14, [
          { a: { x: 0.03, y: 0 }, b: { x: 0.28, y: 0 } },
          { a: { x: 0.28, y: 0 }, b: { x: 0.25, y: 0.14 } },
          { a: { x: 0.25, y: 0.14 }, b: { x: 0, y: 0.14 } },
          { a: { x: 0, y: 0.14 }, b: { x: 0.03, y: 0 } },
        ]),
        x: 0.015,
        y: 0.32,
        rotated: false,
        effectiveW: 0.28,
        effectiveH: 0.14,
      },
    ],
  },
  {
    index: 2,
    utilization: 0.71,
    panels: [
      {
        panel: panel("P9", "wall", 0.15, 0.52, rectEdges(0.15, 0.52)),
        x: 0.012,
        y: 0.012,
        rotated: false,
        effectiveW: 0.15,
        effectiveH: 0.52,
      },
      {
        panel: panel("P10", "wall", 0.42, 0.09, rectEdges(0.42, 0.09)),
        x: 0.18,
        y: 0.012,
        rotated: false,
        effectiveW: 0.42,
        effectiveH: 0.09,
      },
      {
        panel: panel("P11", "floor", 0.24, 0.22, rectEdges(0.24, 0.22)),
        x: 0.18,
        y: 0.12,
        rotated: false,
        effectiveW: 0.24,
        effectiveH: 0.22,
      },
      {
        panel: panel("P12", "floor", 0.31, 0.08, rectEdges(0.31, 0.08)),
        x: 0.18,
        y: 0.36,
        rotated: false,
        effectiveW: 0.31,
        effectiveH: 0.08,
      },
      {
        panel: panel("P13", "wall", 0.19, 0.19, [
          { a: { x: 0.095, y: 0 }, b: { x: 0.19, y: 0.06 } },
          { a: { x: 0.19, y: 0.06 }, b: { x: 0.16, y: 0.19 } },
          { a: { x: 0.16, y: 0.19 }, b: { x: 0.03, y: 0.19 } },
          { a: { x: 0.03, y: 0.19 }, b: { x: 0, y: 0.06 } },
          { a: { x: 0, y: 0.06 }, b: { x: 0.095, y: 0 } },
        ]),
        x: 0.52,
        y: 0.012,
        rotated: false,
        effectiveW: 0.19,
        effectiveH: 0.19,
      },
    ],
  },
  {
    index: 3,
    utilization: 0.65,
    panels: [
      {
        panel: panel("P14", "wall", 0.26, 0.14, rectEdges(0.26, 0.14)),
        x: 0.01,
        y: 0.01,
        rotated: true,
        effectiveW: 0.14,
        effectiveH: 0.26,
      },
      {
        panel: panel("P15", "floor", 0.44, 0.13, rectEdges(0.44, 0.13)),
        x: 0.16,
        y: 0.01,
        rotated: false,
        effectiveW: 0.44,
        effectiveH: 0.13,
      },
      {
        panel: panel("P16", "wall", 0.12, 0.12, rectEdges(0.12, 0.12)),
        x: 0.62,
        y: 0.01,
        rotated: false,
        effectiveW: 0.12,
        effectiveH: 0.12,
      },
      {
        panel: panel("P17", "floor", 0.18, 0.28, rectEdges(0.18, 0.28)),
        x: 0.01,
        y: 0.2,
        rotated: false,
        effectiveW: 0.18,
        effectiveH: 0.28,
      },
    ],
  },
];

export interface HeroSheetLayout {
  sheetIndex: number;
  cx: number;
  cy: number;
  rot: number;
  scale: number;
  phase: number;
}

/** Disposición inicial: planchas esparcidas como en mesa de taller. */
export const HERO_SHEET_LAYOUTS: HeroSheetLayout[] = [
  { sheetIndex: 0, cx: 0.5, cy: 0.5, rot: -0.035, scale: 340, phase: 0 },
  { sheetIndex: 1, cx: 0.22, cy: 0.58, rot: 0.11, scale: 260, phase: 1.2 },
  { sheetIndex: 2, cx: 0.78, cy: 0.42, rot: -0.14, scale: 250, phase: 2.4 },
  { sheetIndex: 3, cx: 0.68, cy: 0.72, rot: 0.08, scale: 220, phase: 3.1 },
];
