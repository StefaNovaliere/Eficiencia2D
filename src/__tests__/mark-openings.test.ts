// Tests for "marcar aberturas" — a marked component engraves its openings
// (inner-ring hole edges) on the red MARK_VECTOR layer instead of cutting them.

import { describe, it, expect } from "vitest";
import { nestedSheetsToDxf } from "@/core/cutting-sheet";
import type { NestingPanel, NestingResult } from "@/core/sheet-nester";

function makePanel(isMark: boolean): NestingPanel {
  return {
    id: "A1",
    category: "wall",
    widthM: 1,
    heightM: 1,
    edges: [
      // Outer silhouette (a single representative edge).
      { a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, hole: false },
      // Inner-ring (door/window opening) edge.
      { a: { x: 0.4, y: 0.4 }, b: { x: 0.6, y: 0.4 }, hole: true },
    ],
    isMark,
  };
}

function makeNesting(isMark: boolean): NestingResult {
  const panel = makePanel(isMark);
  return {
    sheets: [
      {
        index: 0,
        utilization: 0.5,
        panels: [
          { panel, x: 0, y: 0, rotated: false, effectiveW: 1, effectiveH: 1 },
        ],
      },
    ],
    config: { widthM: 1, heightM: 0.6, gapM: 0.003 },
    scaleDenom: 1,
    unplaced: [],
  };
}

describe("marcar aberturas — DXF MARK_VECTOR layer", () => {
  it("emits hole edges on MARK_VECTOR (red) and outer edges on CUT_EXTERIOR when marked", () => {
    const dxf = nestedSheetsToDxf(makeNesting(true), false);
    // Entity layer assignments use group code 8.
    expect(dxf).toContain("8\nMARK_VECTOR");
    expect(dxf).toContain("8\nCUT_EXTERIOR");
  });

  it("emits no MARK_VECTOR entity when the component is not marked", () => {
    const dxf = nestedSheetsToDxf(makeNesting(false), false);
    // The layer is still declared in the table (group code 2), but no entity
    // (group code 8) should reference it.
    expect(dxf).not.toContain("8\nMARK_VECTOR");
    expect(dxf).toContain("8\nCUT_EXTERIOR");
  });
});
