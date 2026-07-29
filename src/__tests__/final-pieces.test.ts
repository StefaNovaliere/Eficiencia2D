import { describe, expect, it } from "vitest";
import {
  formatWarningMeasure,
  parseAssemblyWarnings,
  parseFinalPieces,
  sortWarningsBySeverity,
  warningTypeLabel,
} from "@/core/final-pieces";
import { liftFinalPiece } from "@/core/assembly-lift";
import { buildAssemblyPieces } from "@/core/assembly-sequence";

/** Pieza como la manda el backend (snake_case, tal cual el contrato). */
function crudo(over: Record<string, unknown> = {}) {
  return {
    id: "A1",
    group_id: 250,
    category: "wall",
    width_m: 6.7,
    height_m: 4.77,
    origin: { x: 3.35, y: 2.691, z: 3.753 },
    u_dir: { x: -1, y: 0, z: 0 },
    v_dir: { x: 0, y: 1, z: 0 },
    normal: { x: 0, y: 0.8, z: 0.6 },
    edges: [{ a: { x: 0, y: 0 }, b: { x: 6.7, y: 0 }, hole: false, joint: false }],
    ...over,
  };
}

describe("parseFinalPieces", () => {
  it("lee el formato del contrato", () => {
    const [p] = parseFinalPieces([crudo()]);
    expect(p.id).toBe("A1");
    expect(p.groupId).toBe(250);
    expect(p.widthM).toBeCloseTo(6.7);
    expect(p.uDir).toEqual({ x: -1, y: 0, z: 0 });
    expect(p.edges).toHaveLength(1);
  });

  it("acepta también la respuesta ya camelizada", () => {
    // La respuesta pasa por un camelizado genérico antes de llegar acá; el
    // parseo no puede depender de que ese paso haya corrido o no.
    const [p] = parseFinalPieces([
      { ...crudo(), uDir: { x: 1, y: 0, z: 0 }, u_dir: undefined, widthM: 3, width_m: undefined },
    ]);
    expect(p.uDir).toEqual({ x: 1, y: 0, z: 0 });
    expect(p.widthM).toBe(3);
  });

  it("lee los flags de cada arista", () => {
    const [p] = parseFinalPieces([
      crudo({
        edges: [
          { a: { x: 0, y: 0 }, b: { x: 1, y: 0 } },
          { a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, hole: true },
          { a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, joint: true },
        ],
      }),
    ]);
    expect(p.edges.map((e) => [e.hole, e.joint])).toEqual([
      [false, false],
      [true, false],
      [false, true],
    ]);
  });

  /**
   * Una coordenada inválida metida en un BufferGeometry se lleva puesta toda la
   * escena de Three, así que la pieza se descarta entera antes de llegar ahí.
   */
  it("descarta piezas sin marco o con coordenadas inválidas", () => {
    expect(parseFinalPieces([crudo({ u_dir: undefined })])).toEqual([]);
    expect(parseFinalPieces([crudo({ origin: { x: 1, y: null, z: 3 } })])).toEqual([]);
    expect(parseFinalPieces([crudo({ origin: { x: 1, y: NaN, z: 3 } })])).toEqual([]);
    expect(parseFinalPieces([crudo({ id: "  " })])).toEqual([]);
    expect(parseFinalPieces([crudo({ edges: [] })])).toEqual([]);
  });

  it("tolera basura sin romperse", () => {
    expect(parseFinalPieces(null)).toEqual([]);
    expect(parseFinalPieces("nope")).toEqual([]);
    expect(parseFinalPieces([null, 42, crudo()])).toHaveLength(1);
  });
});

describe("parseAssemblyWarnings", () => {
  it("lee el aviso nuevo de interpenetración", () => {
    const [w] = parseAssemblyWarnings([
      { pieces: ["A1", "A20"], type: "interpenetra", measure_mm: 6700, at: [0, 2.73, 3.7] },
    ]);
    expect(w.type).toBe("interpenetra");
    expect(w.pieces).toEqual(["A1", "A20"]);
    expect(w.measureMm).toBe(6700);
    expect(w.at).toEqual({ x: 0, y: 2.73, z: 3.7 });
  });

  /**
   * El punto del aviso viene como array y las poses de las piezas como objeto:
   * hay que soportar las dos formas.
   */
  it("acepta el punto como array o como objeto", () => {
    expect(parseAssemblyWarnings([{ type: "gap", at: [1, 2, 3] }])[0].at).toEqual({
      x: 1, y: 2, z: 3,
    });
    expect(parseAssemblyWarnings([{ type: "gap", at: { x: 1, y: 2, z: 3 } }])[0].at).toEqual({
      x: 1, y: 2, z: 3,
    });
  });

  /**
   * Filtrar por lista blanca de tipos es exactamente lo que haría desaparecer
   * un aviso nuevo del backend sin que nadie se entere.
   */
  it("NO filtra por tipo conocido", () => {
    const w = parseAssemblyWarnings([{ type: "algo_que_no_conocemos", measure_mm: 3 }]);
    expect(w).toHaveLength(1);
    expect(w[0].type).toBe("algo_que_no_conocemos");
  });

  it("los tipos que ya existían siguen andando", () => {
    const w = parseAssemblyWarnings([
      { pieces: ["A1"], type: "gap", measure_mm: 5, tolerance_mm: 0.5 },
      { pieces: ["B2"], type: "unsupported", measure_mm: 0 },
      { pieces: ["A3", "A4"], type: "overlap", measure_mm: 12 },
    ]);
    expect(w.map((x) => x.type)).toEqual(["gap", "unsupported", "overlap"]);
    expect(w[0].toleranceMm).toBe(0.5);
  });

  it("un aviso sin tipo no se muestra: no habría qué decirle al usuario", () => {
    expect(parseAssemblyWarnings([{ pieces: ["A1"], measure_mm: 5 }])).toEqual([]);
  });

  it("ordena por severidad y nombra los tipos", () => {
    const ordenados = sortWarningsBySeverity([
      { pieces: [], type: "gap", measureMm: 3 },
      { pieces: [], type: "interpenetra", measureMm: 6700 },
      { pieces: [], type: "overlap", measureMm: 12 },
    ]);
    expect(ordenados.map((w) => w.measureMm)).toEqual([6700, 12, 3]);
    expect(warningTypeLabel("interpenetra")).toBe("Se atraviesan");
    // Un tipo desconocido se muestra crudo en vez de ocultarse.
    expect(warningTypeLabel("otra_cosa")).toBe("otra_cosa");
  });
});

describe("liftFinalPiece", () => {
  /** Rectángulo cerrado de w×h en coordenadas locales (u, v). */
  function contorno(w: number, h: number, flags: Record<string, boolean> = {}) {
    const p = [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ];
    return p.map((a, i) => ({ a, b: p[(i + 1) % 4], ...flags }));
  }

  const base = {
    id: "A1",
    groupId: 1,
    category: "wall",
    widthM: 2,
    heightM: 1,
    normal: { x: 0, y: 0, z: 1 },
  };

  it("aplica world = origin + u·uDir + v·vDir, sin espejar ni escalar", () => {
    const piece = {
      ...base,
      origin: { x: 10, y: 5, z: 0 },
      uDir: { x: 1, y: 0, z: 0 },
      vDir: { x: 0, y: 1, z: 0 },
      edges: contorno(2, 1),
    };
    const { positions } = liftFinalPiece(piece);
    expect(positions.length).toBeGreaterThanOrEqual(9);

    // Todos los vértices caen en el rectángulo trasladado, sin espejo.
    const xs = positions.filter((_, i) => i % 3 === 0);
    const ys = positions.filter((_, i) => i % 3 === 1);
    expect(Math.min(...xs)).toBeCloseTo(10, 6);
    expect(Math.max(...xs)).toBeCloseTo(12, 6);
    expect(Math.min(...ys)).toBeCloseTo(5, 6);
    expect(Math.max(...ys)).toBeCloseTo(6, 6);
  });

  it("respeta un uDir invertido tal como viene", () => {
    // El contrato es explícito: nada de compensar el sentido.
    const piece = {
      ...base,
      origin: { x: 0, y: 0, z: 0 },
      uDir: { x: -1, y: 0, z: 0 },
      vDir: { x: 0, y: 1, z: 0 },
      edges: contorno(2, 1),
    };
    const xs = liftFinalPiece(piece).positions.filter((_, i) => i % 3 === 0);
    expect(Math.min(...xs)).toBeCloseTo(-2, 6);
    expect(Math.max(...xs)).toBeCloseTo(0, 6);
  });

  it("las aberturas salen como huecos y como segmentos", () => {
    const piece = {
      ...base,
      origin: { x: 0, y: 0, z: 0 },
      uDir: { x: 1, y: 0, z: 0 },
      vDir: { x: 0, y: 1, z: 0 },
      edges: [
        ...contorno(4, 3),
        ...contorno(1, 1, { hole: true }).map((e) => ({
          a: { x: e.a.x + 1, y: e.a.y + 1 },
          b: { x: e.b.x + 1, y: e.b.y + 1 },
          hole: true,
        })),
      ],
    };
    const g = liftFinalPiece(piece);
    expect(g.hasHoles).toBe(true);
    expect(g.openings.length).toBeGreaterThan(0);
  });

  /**
   * Las muescas de encastre son material cortado: si no contaran como contorno,
   * el anillo exterior quedaría abierto en cada muesca y la pieza no se podría
   * triangular — desaparecería del instructivo.
   */
  it("las aristas de encastre cierran el contorno, no lo abren", () => {
    const piece = {
      ...base,
      origin: { x: 0, y: 0, z: 0 },
      uDir: { x: 1, y: 0, z: 0 },
      vDir: { x: 0, y: 1, z: 0 },
      edges: [
        { a: { x: 0, y: 0 }, b: { x: 2, y: 0 } },
        { a: { x: 2, y: 0 }, b: { x: 2, y: 1 }, joint: true }, // muesca
        { a: { x: 2, y: 1 }, b: { x: 0, y: 1 } },
        { a: { x: 0, y: 1 }, b: { x: 0, y: 0 } },
      ],
    };
    expect(liftFinalPiece(piece).positions.length).toBeGreaterThanOrEqual(9);
  });

  it("sin contorno reconstruible no inventa un bloque macizo", () => {
    const piece = {
      ...base,
      origin: { x: 0, y: 0, z: 0 },
      uDir: { x: 1, y: 0, z: 0 },
      vDir: { x: 0, y: 1, z: 0 },
      edges: [{ a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, hole: true }],
    };
    expect(liftFinalPiece(piece).positions).toEqual([]);
  });
});

describe("el instructivo prefiere las piezas finales", () => {
  const QUAD = {
    vertices: [
      { x: 0, y: 0, z: 0 },
      { x: 9, y: 0, z: 0 },
      { x: 9, y: 9, z: 0 },
      { x: 0, y: 9, z: 0 },
    ],
    normal: { x: 0, y: 0, z: 1 },
    area: 81,
  };

  const data = {
    panels: [
      {
        id: "A1",
        category: "wall",
        source_group_id: 1,
        width_m: 2,
        height_m: 1,
        area_m2: 2,
        centroid: { x: 0, y: 0, z: 0 },
        normal: { x: 0, y: 0, z: 1 },
        label: "A1",
      },
    ],
    elevations: {},
    totals: { wall_count: 1, floor_count: 0, total_panels: 1 },
  };
  const steps = [{ title: "Paso 1", description: "", panel_ids: ["A1"] }];

  const finalPiece = {
    id: "A1",
    groupId: 1,
    category: "wall",
    widthM: 2,
    heightM: 1,
    origin: { x: 100, y: 0, z: 0 },
    uDir: { x: 1, y: 0, z: 0 },
    vDir: { x: 0, y: 1, z: 0 },
    normal: { x: 0, y: 0, z: 1 },
    edges: [
      { a: { x: 0, y: 0 }, b: { x: 2, y: 0 } },
      { a: { x: 2, y: 0 }, b: { x: 2, y: 1 } },
      { a: { x: 2, y: 1 }, b: { x: 0, y: 1 } },
      { a: { x: 0, y: 1 }, b: { x: 0, y: 0 } },
    ],
  };

  const baseLift = {
    labelToGroupId: new Map([["A1", 1]]),
    faces: [QUAD],
    faceIndicesByLabel: new Map([["A1", [0]]]),
  };

  it("usa el contorno recortado cuando el backend lo manda", () => {
    const [pieza] = buildAssemblyPieces(data as never, steps, {
      ...baseLift,
      finalPieceById: new Map([["A1", finalPiece]]),
    } as never);

    // La pieza final está en x=100..102; la cara original del modelo, en 0..9.
    const xs = pieza.lifted!.positions.filter((_, i) => i % 3 === 0);
    expect(Math.min(...xs)).toBeCloseTo(100, 6);
    expect(Math.max(...xs)).toBeCloseTo(102, 6);
  });

  it("sin piezas finales cae al camino viejo, no se queda sin dibujar", () => {
    const [pieza] = buildAssemblyPieces(data as never, steps, baseLift as never);
    const xs = pieza.lifted!.positions.filter((_, i) => i % 3 === 0);
    expect(Math.max(...xs)).toBeCloseTo(9, 6); // la cara original
  });

  it("si una pieza final no se puede triangular, cae al camino viejo", () => {
    const roto = { ...finalPiece, edges: [{ a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, hole: true }] };
    const [pieza] = buildAssemblyPieces(data as never, steps, {
      ...baseLift,
      finalPieceById: new Map([["A1", roto]]),
    } as never);
    const xs = pieza.lifted!.positions.filter((_, i) => i % 3 === 0);
    expect(Math.max(...xs)).toBeCloseTo(9, 6);
  });
});

describe("formatWarningMeasure", () => {
  it("elige la unidad que se lee mejor", () => {
    // El backend manda todo en mm; un interpenetra a lo largo de una pared da
    // 6700 mm, que como "670 cm" es correcto pero ilegible.
    expect(formatWarningMeasure(6700)).toBe("6,70 m");
    expect(formatWarningMeasure(12)).toBe("1,2 cm");
    expect(formatWarningMeasure(5)).toBe("5,0 mm");
  });

  it("un valor sin medir no inventa un número", () => {
    expect(formatWarningMeasure(0)).toBe("—");
    expect(formatWarningMeasure(NaN)).toBe("—");
  });
});
