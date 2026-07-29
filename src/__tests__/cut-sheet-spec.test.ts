import { describe, expect, it } from "vitest";
import {
  formatSheetSizeCm,
  holeFeatureSizesMm,
  smallestHoleMm,
  smallestPieceMm,
  toCm,
  toMm,
} from "@/core/cut-sheet-spec";
import type { NestingSheet } from "@/core/sheet-nester";

type Edge = { a: { x: number; y: number }; b: { x: number; y: number }; hole?: boolean };

/** Contorno rectangular cerrado, en metros de plancha. */
function rect(x: number, y: number, w: number, h: number, hole = false): Edge[] {
  const p = [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
  return p.map((a, i) => ({ a, b: p[(i + 1) % 4], hole }));
}

function sheet(panels: { edges: Edge[]; w: number; h: number }[]): NestingSheet {
  return {
    index: 0,
    utilization: 0.5,
    panels: panels.map((p, i) => ({
      panel: { id: `A${i + 1}`, category: "wall" as const, widthM: p.w, heightM: p.h, edges: p.edges },
      x: 0,
      y: 0,
      rotated: false,
      effectiveW: p.w,
      effectiveH: p.h,
    })),
  };
}

describe("unidades del taller", () => {
  it("pasa metros de plancha a cm y mm", () => {
    expect(toCm(0.277)).toBe(27.7);
    expect(toMm(0.0021)).toBe(2.1);
  });

  /**
   * El taller pide "el tamaño del recuadro exterior" y habla en cm. La app
   * mostraba "0.28 × 0.19 m", que hay que traducir a mano — justo donde se
   * cuelan los malentendidos.
   */
  it("formatea el recuadro exterior como lo pide el taller", () => {
    // A4 menos 10 mm de margen por lado, auto-orientada.
    expect(formatSheetSizeCm(0.277, 0.19)).toBe("27,7 × 19 cm");
    expect(formatSheetSizeCm(1.0, 0.6)).toBe("100 × 60 cm");
  });
});

describe("detalle más chico del archivo", () => {
  it("mide el lado menor de cada hueco", () => {
    // Una pared de 20×10 cm con una ventana de 3×2 cm.
    const panel = {
      w: 0.2,
      h: 0.1,
      edges: [...rect(0, 0, 0.2, 0.1), ...rect(0.05, 0.04, 0.03, 0.02, true)],
    };
    expect(holeFeatureSizesMm([sheet([panel])])).toEqual([20]);
  });

  /**
   * Las aristas de hueco llegan sueltas. Si cada tramo contara como un hueco
   * aparte, un contorno subdividido daría una falsa alarma de "detalle de 1 mm"
   * cuando en realidad es una ventana grande partida en pedacitos.
   */
  it("un contorno partido en tramos sigue siendo UN hueco", () => {
    const partido: Edge[] = [
      // Ventana de 4×3 cm, con el lado de arriba partido en cuatro tramos.
      { a: { x: 0.02, y: 0.02 }, b: { x: 0.03, y: 0.02 }, hole: true },
      { a: { x: 0.03, y: 0.02 }, b: { x: 0.04, y: 0.02 }, hole: true },
      { a: { x: 0.04, y: 0.02 }, b: { x: 0.05, y: 0.02 }, hole: true },
      { a: { x: 0.05, y: 0.02 }, b: { x: 0.06, y: 0.02 }, hole: true },
      { a: { x: 0.06, y: 0.02 }, b: { x: 0.06, y: 0.05 }, hole: true },
      { a: { x: 0.06, y: 0.05 }, b: { x: 0.02, y: 0.05 }, hole: true },
      { a: { x: 0.02, y: 0.05 }, b: { x: 0.02, y: 0.02 }, hole: true },
    ];
    expect(holeFeatureSizesMm([sheet([{ w: 0.2, h: 0.1, edges: partido }])])).toEqual([30]);
  });

  it("encuentra el hueco más chico entre varios", () => {
    const panel = {
      w: 0.3,
      h: 0.2,
      edges: [
        ...rect(0, 0, 0.3, 0.2),
        ...rect(0.02, 0.02, 0.04, 0.03, true), // ventana grande
        ...rect(0.1, 0.02, 0.0009, 0.02, true), // ranura de 0,9 mm
      ],
    };
    expect(smallestHoleMm([sheet([panel])])).toBe(0.9);
  });

  it("sin huecos no hay detalle que reportar", () => {
    const panel = { w: 0.2, h: 0.1, edges: rect(0, 0, 0.2, 0.1) };
    expect(smallestHoleMm([sheet([panel])])).toBeNull();
    expect(holeFeatureSizesMm([])).toEqual([]);
  });

  it("mide también la pieza más chica", () => {
    const sheets = [
      sheet([
        { w: 0.2, h: 0.1, edges: rect(0, 0, 0.2, 0.1) },
        { w: 0.05, h: 0.004, edges: rect(0, 0, 0.05, 0.004) },
      ]),
    ];
    expect(smallestPieceMm(sheets)).toBe(4);
    expect(smallestPieceMm([])).toBeNull();
  });
});
