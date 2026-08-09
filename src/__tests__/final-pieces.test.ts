import { describe, expect, it } from "vitest";
import {
  formatWarningMeasure,
  parseAssemblyWarnings,
  parseFinalPieces,
  parseNestingPlacements,
  sortWarningsBySeverity,
  warningAdvice,
  warningTypeLabel,
} from "@/core/final-pieces";
import { liftFinalPiece, liftOutline } from "@/core/assembly-lift";
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

describe("parseNestingPlacements", () => {
  /** Marco tal cual lo manda el contrato (clave = group_id como string). */
  const crudoMapa = {
    "250": {
      panel_id: "A1",
      origin: { x: 3.35, y: 2.69, z: 3.75 },
      u_axis: { x: -1, y: 0, z: 0 },
      v_axis: { x: 0, y: 1, z: 0 },
      normal: { x: 0, y: 0.8, z: 0.6 },
      width_m: 7.35,
      height_m: 4.7728,
      mirrored: true,
      area_m2: 33.96,
    },
  };

  it("lee el formato del contrato, con la clave numérica", () => {
    const m = parseNestingPlacements(crudoMapa);
    const pl = m.get(250)!;
    expect(pl.panelId).toBe("A1");
    expect(pl.uAxis).toEqual({ x: -1, y: 0, z: 0 });
    expect(pl.widthM).toBeCloseTo(7.35);
    expect(pl.mirrored).toBe(true);
    expect(pl.areaM2).toBeCloseTo(33.96);
  });

  it("acepta también la respuesta ya camelizada", () => {
    const m = parseNestingPlacements({
      "250": {
        panelId: "A1",
        origin: { x: 0, y: 0, z: 0 },
        uAxis: { x: 1, y: 0, z: 0 },
        vAxis: { x: 0, y: 1, z: 0 },
        widthM: 2,
        areaM2: 4,
      },
    });
    expect(m.get(250)!.widthM).toBe(2);
    expect(m.get(250)!.areaM2).toBe(4);
  });

  it("descarta entradas sin marco usable", () => {
    expect(parseNestingPlacements({ "1": { panel_id: "A1" } }).size).toBe(0);
    expect(parseNestingPlacements({ abc: crudoMapa["250"] }).size).toBe(0);
    expect(parseNestingPlacements(null).size).toBe(0);
    expect(parseNestingPlacements([]).size).toBe(0);
  });

  /**
   * Es el punto del contrato: estos marcos vienen recortados, y son los que hay
   * que dibujar en el instructivo en vez de la topología cruda.
   */
  it("conserva las medidas recortadas tal como llegan", () => {
    // A1 del modelo de prueba: 735 cm recortado contra 790 cm en la topología.
    const pl = parseNestingPlacements(crudoMapa).get(250)!;
    expect(pl.widthM).toBeLessThan(7.9);
    expect(pl.widthM).toBeCloseTo(7.35, 4);
  });
});

/**
 * Hay tres fuentes posibles para el cuerpo de una pieza, de mejor a peor:
 * la pieza final, el marco recortado del nesting, y las caras crudas del
 * modelo. Las dos primeras traen los recortes del ensamble; la tercera es el
 * modelo sin recortar, que es lo que hacía que los muros se pisaran.
 */
describe("de dónde saca el instructivo cada pieza", () => {
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
        id: "A1", category: "wall", source_group_id: 1,
        width_m: 2, height_m: 1, area_m2: 2,
        centroid: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 }, label: "A1",
      },
    ],
    elevations: {},
    totals: { wall_count: 1, floor_count: 0, total_panels: 1 },
  };
  const steps = [{ title: "Paso 1", description: "", panel_ids: ["A1"] }];
  const baseLift = {
    labelToGroupId: new Map([["A1", 1]]),
    faces: [QUAD],
    faceIndicesByLabel: new Map([["A1", [0]]]),
  };

  /** Contorno de corte en la plancha (a escala 1:100 → metros de plancha). */
  const nestingPanel = {
    id: "A1",
    category: "wall" as const,
    widthM: 0.02,
    heightM: 0.01,
    edges: [
      { a: { x: 0, y: 0 }, b: { x: 0.02, y: 0 } },
      { a: { x: 0.02, y: 0 }, b: { x: 0.02, y: 0.01 } },
      { a: { x: 0.02, y: 0.01 }, b: { x: 0, y: 0.01 } },
      { a: { x: 0, y: 0.01 }, b: { x: 0, y: 0 } },
    ],
  };
  const nestingPlacement = {
    panelId: "A1",
    origin: { x: 50, y: 0, z: 0 },
    uAxis: { x: 1, y: 0, z: 0 },
    vAxis: { x: 0, y: 1, z: 0 },
    normal: { x: 0, y: 0, z: 1 },
    widthM: 2,
    heightM: 1,
    mirrored: false,
    areaM2: 2,
  };

  function anchoDibujado(lift: unknown) {
    const [pieza] = buildAssemblyPieces(data as never, steps, lift as never);
    const xs = pieza.lifted!.positions.filter((_, i) => i % 3 === 0);
    return { min: Math.min(...xs), max: Math.max(...xs) };
  }

  it("usa el marco recortado del nesting", () => {
    const r = anchoDibujado({
      ...baseLift,
      nestingPlacementByGroupId: new Map([[1, nestingPlacement]]),
      nestingPanelByLabel: new Map([["A1", nestingPanel]]),
    });
    // El marco recortado ubica la pieza en x=50..52; la cara cruda, en 0..9.
    expect(r.min).toBeCloseTo(50, 4);
    expect(r.max).toBeCloseTo(52, 4);
  });

  it("sin ninguna de las dos, cae a las caras del modelo", () => {
    expect(anchoDibujado(baseLift).max).toBeCloseTo(9, 6);
  });

  it("si el marco recortado no sirve, no deja la pieza sin dibujar", () => {
    const r = anchoDibujado({
      ...baseLift,
      nestingPlacementByGroupId: new Map([[1, nestingPlacement]]),
      nestingPanelByLabel: new Map(), // falta el contorno de la plancha
    });
    expect(r.max).toBeCloseTo(9, 6); // cayó a las caras crudas
  });
});

/**
 * El contorno de corte se espeja antes de cortarse, para que el quemado del
 * láser quede del lado interior de la maqueta. Ese espejado ya viene horneado en
 * el marco del nesting (origen corrido al otro extremo y u_axis invertido), y la
 * fórmula del contrato no tiene término de espejo. Compensarlo otra vez da vuelta
 * cada pieza asimétrica sobre su propio eje: es lo que hacía que el instructivo
 * siguiera mostrando piezas superpuestas.
 */
describe("el marco del nesting nunca se espeja", () => {
  const data = {
    panels: [
      {
        id: "A1", category: "wall", source_group_id: 1,
        width_m: 2, height_m: 1, area_m2: 2,
        centroid: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 }, label: "A1",
      },
    ],
    elevations: {},
    totals: { wall_count: 1, floor_count: 0, total_panels: 1 },
  };
  const steps = [{ title: "Paso 1", description: "", panel_ids: ["A1"] }];

  /** Contorno ASIMÉTRICO: un espejado de más se nota. */
  const panelAsimetrico = {
    id: "A1",
    category: "wall" as const,
    widthM: 1,
    heightM: 1,
    edges: [
      { a: { x: 0, y: 0 }, b: { x: 1, y: 0 } },
      { a: { x: 1, y: 0 }, b: { x: 1, y: 0.2 } }, // muesca sólo de un lado
      { a: { x: 1, y: 0.2 }, b: { x: 0, y: 1 } },
      { a: { x: 0, y: 1 }, b: { x: 0, y: 0 } },
    ],
  };

  const marco = {
    panelId: "A1",
    origin: { x: 0, y: 0, z: 0 },
    uAxis: { x: 1, y: 0, z: 0 },
    vAxis: { x: 0, y: 1, z: 0 },
    normal: { x: 0, y: 0, z: 1 },
    widthM: 1,
    heightM: 1,
    areaM2: 1,
  };

  function vertices(mirrored: boolean) {
    const [pieza] = buildAssemblyPieces(data as never, steps, {
      labelToGroupId: new Map([["A1", 1]]),
      faces: [],
      faceIndicesByLabel: new Map(),
      nestingPlacementByGroupId: new Map([[1, { ...marco, mirrored }]]),
      nestingPanelByLabel: new Map([["A1", panelAsimetrico]]),
    } as never);
    return pieza.lifted!.positions;
  }

  it("da el mismo resultado con mirrored true o false", () => {
    // El contrato dice que llega en `false`, pero su propio ejemplo JSON lo
    // muestra en `true`: el dibujo no puede depender de cuál de los dos venga.
    expect(vertices(true)).toEqual(vertices(false));
  });

  it("dibuja el contorno tal cual, sin dar vuelta la asimetría", () => {
    const pos = vertices(false);
    const xs = pos.filter((_, i) => i % 3 === 0);
    const ys = pos.filter((_, i) => i % 3 === 1);
    expect(Math.min(...xs)).toBeCloseTo(0, 4);
    expect(Math.max(...xs)).toBeCloseTo(1, 4);

    // La muesca (y ≈ 0.2) está del lado x=1, no del x=0. Si se espejara,
    // el vértice de y baja caería en x=0.
    let xDeLaMuesca = NaN;
    for (let i = 0; i < ys.length; i++) {
      if (Math.abs(ys[i] - 0.2) < 1e-4) xDeLaMuesca = xs[i];
    }
    expect(xDeLaMuesca).toBeCloseTo(1, 4);
  });
});

describe("avisos de interferencia entre piezas", () => {
  it("lee el tipo nuevo con su causa y su explicación", () => {
    const [w] = parseAssemblyWarnings([
      {
        pieces: ["A11", "A2"],
        type: "interference",
        measure_mm: 0.42,
        cause: "escala",
        message: "A 1:100 las piezas se pisan 0.42 mm.",
      },
    ]);
    expect(w.type).toBe("interference");
    expect(w.cause).toBe("escala");
    expect(w.message).toContain("0.42");
    expect(warningTypeLabel("interference")).toBe("Se atraviesan");
  });

  it("los avisos sin causa ni mensaje siguen andando", () => {
    const [w] = parseAssemblyWarnings([{ type: "gap", measure_mm: 5 }]);
    expect(w.cause).toBeUndefined();
    expect(w.message).toBeUndefined();
  });
});

describe("qué se le dice al usuario según la causa", () => {
  /**
   * La causa dice DE QUIÉN es el problema, y eso decide qué mostrar. Pedirle al
   * usuario que revise su modelo cuando la junta no la resolvimos nosotros le
   * carga un problema ajeno; callarse cuando sí puede hacer algo lo deja sin
   * salida.
   */
  it("los problemas del usuario vienen con qué hacer", () => {
    expect(warningAdvice("modelo")).toEqual({
      action: "Revisá el modelo",
      owner: "usuario",
    });
    expect(warningAdvice("escala")).toEqual({
      action: "Probá una escala menor",
      owner: "usuario",
    });
  });

  it("los problemas nuestros no le piden nada al usuario", () => {
    for (const causa of ["sin_recorte", "no_detectada"]) {
      const consejo = warningAdvice(causa);
      expect(consejo.owner).toBe("nosotros");
      expect(consejo.action).toBeNull();
    }
  });

  it("una causa desconocida no inventa un consejo", () => {
    expect(warningAdvice("otra").action).toBeNull();
    expect(warningAdvice(undefined).action).toBeNull();
  });
});

describe("el contorno de corte dentro del placement", () => {
  /** Pieza A4 del contrato: rectángulo de 7.18 × 2.367 con su marco. */
  const a4 = {
    "255": {
      panel_id: "A4",
      category: "wall",
      origin: { x: 3.59, y: 0.15, z: 3.49 },
      u_axis: { x: -1, y: 0, z: 0 },
      v_axis: { x: 0, y: 1, z: 0 },
      normal: { x: 0, y: 0, z: 1 },
      mirrored: false,
      width_m: 7.18,
      height_m: 2.367,
      area_m2: 16.998,
      thickness_m: 0.3,
      outline: [
        { a: { x: 7.18, y: 2.367 }, b: { x: 0, y: 2.367 }, hole: false },
        { a: { x: 0, y: 2.367 }, b: { x: 0, y: 0 }, hole: false },
        { a: { x: 0, y: 0 }, b: { x: 7.18, y: 0 }, hole: false },
        { a: { x: 7.18, y: 0 }, b: { x: 7.18, y: 2.367 }, hole: false },
      ],
    },
  };

  it("lee contorno, categoría y espesor", () => {
    const pl = parseNestingPlacements(a4).get(255)!;
    expect(pl.category).toBe("wall");
    expect(pl.thicknessM).toBeCloseTo(0.3);
    expect(pl.outline).toHaveLength(4);
  });

  /**
   * El bounding box de un faldón triangular tiene el doble de superficie que el
   * faldón: dibujarlo muestra material donde no hay y tapa los huecos por donde
   * entra la pieza vecina.
   */
  it("dibuja el contorno, no el rectángulo que lo contiene", () => {
    const faldon = [
      { a: { x: 0, y: 0 }, b: { x: 4, y: 0 } },
      { a: { x: 4, y: 0 }, b: { x: 0, y: 3 } }, // hipotenusa
      { a: { x: 0, y: 3 }, b: { x: 0, y: 0 } },
    ];
    const g = liftOutline(
      {
        origin: { x: 0, y: 0, z: 0 },
        uAxis: { x: 1, y: 0, z: 0 },
        vAxis: { x: 0, y: 1, z: 0 },
      },
      faldon,
    );
    // Un triángulo son 3 vértices: si dibujara el rectángulo serían 2 triángulos.
    expect(g.positions).toHaveLength(9);

    // Y la esquina superior derecha del bounding box NO tiene material.
    const puntos: Array<[number, number]> = [];
    for (let i = 0; i + 2 < g.positions.length; i += 3) {
      puntos.push([g.positions[i], g.positions[i + 1]]);
    }
    expect(puntos.some(([x, y]) => x > 3.9 && y > 2.9)).toBe(false);
  });

  it("los anillos con hole salen como huecos del polígono", () => {
    const conVentana = [
      { a: { x: 0, y: 0 }, b: { x: 4, y: 0 } },
      { a: { x: 4, y: 0 }, b: { x: 4, y: 3 } },
      { a: { x: 4, y: 3 }, b: { x: 0, y: 3 } },
      { a: { x: 0, y: 3 }, b: { x: 0, y: 0 } },
      { a: { x: 1, y: 1 }, b: { x: 2, y: 1 }, hole: true },
      { a: { x: 2, y: 1 }, b: { x: 2, y: 2 }, hole: true },
      { a: { x: 2, y: 2 }, b: { x: 1, y: 2 }, hole: true },
      { a: { x: 1, y: 2 }, b: { x: 1, y: 1 }, hole: true },
    ];
    const g = liftOutline(
      {
        origin: { x: 0, y: 0, z: 0 },
        uAxis: { x: 1, y: 0, z: 0 },
        vAxis: { x: 0, y: 1, z: 0 },
      },
      conVentana,
    );
    expect(g.hasHoles).toBe(true);
    expect(g.openings.length).toBeGreaterThan(0);
  });
});
