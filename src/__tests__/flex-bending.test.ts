import { describe, it, expect } from "vitest";
import {
  serializeFlexForApi,
  parseFlexFromApi,
  flexPatternSegments2D,
  clipSegmentToContour,
  maxNormalSpreadDeg,
  upsertFlexSpec,
  removeFlexForGroup,
  clampSpacing,
  FLEX_SPACING_MAX_M,
  FLEX_SPACING_MIN_M,
  type FlexSpec,
  type ContourEdge,
} from "@/core/flex-bending";

const KERF: FlexSpec = {
  groupId: 3,
  method: "kerf",
  spacingM: 0.003, // 3 mm físicos de maqueta
  kerfWidthM: 0.0015,
  axisDeg: 0,
};

describe("serialize / parse round-trip", () => {
  it("mantiene los campos en snake_case y vuelve", () => {
    const wire = serializeFlexForApi([KERF]);
    expect(wire[0]).toMatchObject({
      group_id: 3,
      method: "kerf",
      spacing_m: 0.003,
      kerf_width_m: 0.0015,
      axis_deg: 0,
    });
    const back = parseFlexFromApi(wire);
    expect(back[0]).toMatchObject({ groupId: 3, method: "kerf", spacingM: 0.003 });
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
    specs = upsertFlexSpec(specs, { ...KERF, spacingM: 0.005 });
    expect(specs).toHaveLength(1);
    expect(specs[0].spacingM).toBeCloseTo(0.005);
    specs = removeFlexForGroup(specs, 3);
    expect(specs).toHaveLength(0);
  });

  it("clampea el espaciado a los límites físicos (2–6 mm)", () => {
    expect(clampSpacing(0.5)).toBe(FLEX_SPACING_MAX_M);
    expect(clampSpacing(0.0001)).toBe(FLEX_SPACING_MIN_M);
    expect(FLEX_SPACING_MIN_M).toBe(0.002);
    expect(FLEX_SPACING_MAX_M).toBe(0.006);
  });
});

describe("flexPatternSegments2D (preview esquemático)", () => {
  it("la densidad del preview NO depende del spacing físico (pitch visual acotado)", () => {
    const a = flexPatternSegments2D({ ...KERF, spacingM: 0.002 }, 1, 1);
    const b = flexPatternSegments2D({ ...KERF, spacingM: 0.006 }, 1, 1);
    expect(a.length).toBeGreaterThan(0);
    // Mismo pitch visual ⇒ mismo nº de segmentos, independiente del spacing físico.
    expect(a.length).toBe(b.length);
    // Acotado (no una malla densa de miles de líneas).
    expect(a.length).toBeLessThan(400);
  });

  it("los auxéticos generan celdas (segmentos > 0) y respetan el bbox", () => {
    const segs = flexPatternSegments2D(
      { groupId: 1, method: "auxetic_rotating", spacingM: 0.006 },
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

describe("clipSegmentToContour", () => {
  // Contorno en L: cuadrado 0..1 con una escotadura; probamos un triángulo simple.
  const triangle: ContourEdge[] = [
    { a: { x: 0, y: 0 }, b: { x: 1, y: 0 } },
    { a: { x: 1, y: 0 }, b: { x: 0, y: 1 } },
    { a: { x: 0, y: 1 }, b: { x: 0, y: 0 } },
  ];

  it("recorta un segmento que sale del contorno a su parte interior", () => {
    // Segmento horizontal y=0.25 de x=-0.5 a x=1.5 → dentro sólo 0..0.75.
    const parts = clipSegmentToContour({ u0: -0.5, v0: 0.25, u1: 1.5, v1: 0.25 }, triangle);
    expect(parts.length).toBe(1);
    expect(parts[0].u0).toBeCloseTo(0, 2);
    expect(parts[0].u1).toBeCloseTo(0.75, 2);
  });

  it("descarta un segmento totalmente afuera", () => {
    const parts = clipSegmentToContour({ u0: 2, v0: 2, u1: 3, v1: 3 }, triangle);
    expect(parts).toEqual([]);
  });
});

describe("maxNormalSpreadDeg", () => {
  it("0° para normales iguales, 90° para perpendiculares", () => {
    const same = [{ x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }];
    expect(maxNormalSpreadDeg(same)).toBeCloseTo(0, 5);
    const perp = [{ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }];
    expect(maxNormalSpreadDeg(perp)).toBeCloseTo(90, 4);
  });
});
