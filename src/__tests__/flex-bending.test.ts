import { describe, it, expect } from "vitest";
import {
  serializeFlexForApi,
  parseFlexFromApi,
  flexPatternSegments2D,
  upsertFlexSpec,
  removeFlexForGroup,
  clampSpacing,
  FLEX_SPACING_MAX_M,
  FLEX_SPACING_MIN_M,
  type FlexSpec,
} from "@/core/flex-bending";

const KERF: FlexSpec = {
  groupId: 3,
  method: "kerf",
  spacingM: 0.008,
  kerfWidthM: 0.0015,
  axisDeg: 0,
};

describe("serialize / parse round-trip", () => {
  it("mantiene los campos en snake_case y vuelve", () => {
    const wire = serializeFlexForApi([KERF]);
    expect(wire[0]).toMatchObject({
      group_id: 3,
      method: "kerf",
      spacing_m: 0.008,
      kerf_width_m: 0.0015,
      axis_deg: 0,
    });
    const back = parseFlexFromApi(wire);
    expect(back[0]).toMatchObject({ groupId: 3, method: "kerf", spacingM: 0.008 });
  });

  it("descarta métodos desconocidos y entradas sin group_id", () => {
    expect(parseFlexFromApi([{ method: "kerf" }])).toEqual([]);
    expect(parseFlexFromApi([{ group_id: 1, method: "nope" }])).toEqual([]);
  });
});

describe("upsert / remove por grupo", () => {
  it("reemplaza el spec del mismo grupo (uno por grupo)", () => {
    let specs: FlexSpec[] = [];
    specs = upsertFlexSpec(specs, KERF);
    specs = upsertFlexSpec(specs, { ...KERF, spacingM: 0.02 });
    expect(specs).toHaveLength(1);
    expect(specs[0].spacingM).toBeCloseTo(0.02);
    specs = removeFlexForGroup(specs, 3);
    expect(specs).toHaveLength(0);
  });

  it("clampea el espaciado a los límites", () => {
    expect(clampSpacing(0.5)).toBe(FLEX_SPACING_MAX_M);
    expect(clampSpacing(0.0001)).toBe(FLEX_SPACING_MIN_M);
  });
});

describe("flexPatternSegments2D (preview esquemático)", () => {
  it("más filas kerf cuando el espaciado es menor", () => {
    const dense = flexPatternSegments2D({ ...KERF, spacingM: 0.006 }, 1, 1);
    const sparse = flexPatternSegments2D({ ...KERF, spacingM: 0.03 }, 1, 1);
    expect(dense.length).toBeGreaterThan(sparse.length);
    expect(sparse.length).toBeGreaterThan(0);
  });

  it("los auxéticos generan celdas (segmentos > 0) y respetan el bbox", () => {
    const segs = flexPatternSegments2D(
      { groupId: 1, method: "auxetic_rotating", spacingM: 0.05 },
      0.5,
      0.5,
    );
    expect(segs.length).toBeGreaterThan(0);
    for (const s of segs) {
      expect(s.u0).toBeGreaterThanOrEqual(-1e-6);
      expect(s.u0).toBeLessThanOrEqual(0.5 + 1e-6);
      expect(s.v0).toBeGreaterThanOrEqual(-1e-6);
      expect(s.v0).toBeLessThanOrEqual(0.5 + 1e-6);
    }
  });
});
