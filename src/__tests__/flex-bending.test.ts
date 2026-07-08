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
  direction: "vertical",
};

describe("serialize / parse round-trip", () => {
  it("mantiene los campos en snake_case y vuelve (con dirección)", () => {
    const wire = serializeFlexForApi([KERF]);
    expect(wire[0]).toMatchObject({
      group_id: 3,
      method: "kerf",
      spacing_m: 0.003,
      kerf_width_m: 0.0015,
      direction: "vertical",
      axis_deg: 90, // derivado de "vertical"
    });
    const back = parseFlexFromApi(wire);
    expect(back[0]).toMatchObject({
      groupId: 3,
      method: "kerf",
      spacingM: 0.003,
      direction: "vertical",
    });
  });

  it("dirección horizontal ⇒ axis_deg 0; parse infiere dirección desde axis_deg", () => {
    const wire = serializeFlexForApi([{ ...KERF, direction: "horizontal" }]);
    expect(wire[0]).toMatchObject({ direction: "horizontal", axis_deg: 0 });
    // Retro-compat: sólo axis_deg (sin direction) → se infiere.
    expect(parseFlexFromApi([{ group_id: 1, method: "kerf", spacing_m: 0.003, axis_deg: 0 }])[0])
      .toMatchObject({ direction: "horizontal" });
    expect(parseFlexFromApi([{ group_id: 1, method: "kerf", spacing_m: 0.003, axis_deg: 90 }])[0])
      .toMatchObject({ direction: "vertical" });
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
  it("kerf: ranuras rectangulares que reaccionan al spacing (acotado)", () => {
    const dense = flexPatternSegments2D({ ...KERF, spacingM: 0.002 }, 1, 1); // más columnas
    const wide = flexPatternSegments2D({ ...KERF, spacingM: 0.006 }, 1, 1); // menos, más anchas
    expect(dense.length).toBeGreaterThan(0);
    expect(wide.length).toBeGreaterThan(0);
    // Más spacing ⇒ menos columnas ⇒ menos segmentos (el preview reacciona a la barra).
    expect(dense.length).toBeGreaterThan(wide.length);
    // Acotado en ambos extremos (nunca una malla densa de miles de ranuras).
    expect(dense.length).toBeLessThan(400);
  });

  it("kerf: la dirección cambia la orientación del patrón (columnas por eje distinto)", () => {
    // Panel 2×1: vertical y horizontal avanzan las columnas por ejes distintos ⇒
    // distinto nº de columnas/segmentos.
    const vert = flexPatternSegments2D({ ...KERF, direction: "vertical", spacingM: 0.003 }, 2, 1);
    const horiz = flexPatternSegments2D({ ...KERF, direction: "horizontal", spacingM: 0.003 }, 2, 1);
    expect(vert.length).toBeGreaterThan(0);
    expect(horiz.length).toBeGreaterThan(0);
    expect(vert.length).not.toBe(horiz.length);
  });

  it("kerf: margen sólido en los bordes (ninguna ranura toca el borde 'across')", () => {
    // direction vertical en panel 1×1 ⇒ columnas avanzan en u (0..1); debe quedar
    // material sólido en u≈0 y u≈1 (ningún segmento del patrón llega al borde).
    const segs = flexPatternSegments2D({ ...KERF, direction: "vertical", spacingM: 0.002 }, 1, 1);
    let minU = Infinity;
    let maxU = -Infinity;
    for (const s of segs) {
      minU = Math.min(minU, s.u0, s.u1);
      maxU = Math.max(maxU, s.u0, s.u1);
    }
    expect(minU).toBeGreaterThan(0.02); // margen a la izquierda
    expect(maxU).toBeLessThan(0.98); // margen a la derecha
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
