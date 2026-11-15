import { describe, expect, it } from "vitest";
import { conEtiquetasDeCorte } from "@/core/assembly-cutset";
import {
  buildAssemblyGuideFromTopology as construirGuia,
  centroDePlacement,
} from "@/core/assembly-guide-build";
import { edgesToRings, liftOutline } from "@/core/assembly-lift";
import { parseNestingPlacements, type NestingPlacement } from "@/core/final-pieces";
import type { GeometryGroup, FaceCategory } from "@/core/group-classifier";
import type { Phase1Result } from "@/core/pipeline";
import { estadoNoRecibido } from "@/services/api";
// Respuesta REAL de /verificacion con cuatro tramos fusionados en el visor.
import fusion from "./fixtures/verificacion-fusion-demo.json";

// CONTRATO_verificacion §0.3: lo que se cambia en el visor tiene que verse en el
// instructivo, y qué se dibuja lo decide el set de corte:
//   1. está en `placements` → se dibuja ese placement;
//   2. está en `absorbed_groups` → nada propio, ya está dentro del otro;
//   3. en ninguno → no se corta.

function grupo(id: number, category: FaceCategory): GeometryGroup {
  return {
    id,
    label: "",
    category,
    faceIndices: [],
    totalArea: 1,
    centroid: { x: id, y: 0, z: 0 },
    orientation: "",
    representativeNormal: { x: 0, y: 0, z: 1 },
    minY: 0,
    maxY: 1,
  };
}

function topologia(groups: GeometryGroup[]): Phase1Result {
  return {
    faces: [],
    rawFaces: [],
    appliedAxis: "Y",
    groups,
    joints: [],
    adjustments: [],
    wallWallJoints: [],
    stem: "t",
    warnings: [],
    preSplitFaceCount: 0,
    suggestedMerges: [],
  };
}

function placement(panelId: string, category = "wall"): NestingPlacement {
  return {
    panelId,
    origin: { x: 10, y: 0, z: 5 },
    uAxis: { x: 1, y: 0, z: 0 },
    vAxis: { x: 0, y: 1, z: 0 },
    normal: { x: 0, y: 0, z: 1 },
    widthM: 4,
    heightM: 2,
    mirrored: false,
    areaM2: 8,
    category,
  };
}

/** Como la arma la página: la topología con las etiquetas del set de corte. */
function buildAssemblyGuideFromTopology(
  fase: Phase1Result,
  opts: { setDeCorte: Map<number, NestingPlacement>; overrides?: Map<number, FaceCategory> },
) {
  return construirGuia(conEtiquetasDeCorte(fase, opts.setDeCorte), opts);
}

/** Suma del área de los triángulos de una geometría (x,y,z por vértice). */
function areaDibujada(positions: number[]): number {
  let area = 0;
  for (let i = 0; i < positions.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = positions.slice(i, i + 9);
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return area;
}

const setReal = parseNestingPlacements(fusion.placements);
const fusionada = setReal.get(180)!;

describe("pieza fusionada del backend real", () => {
  it("llega entera en el grupo que quedó; los otros tramos figuran como absorbidos", () => {
    expect([...setReal.keys()]).toEqual([180]);
    expect(fusionada.panelId).toBe("A9");
    expect(fusion.absorbed_groups).toMatchObject({ "179": 180, "236": 180, "181": 180 });
  });

  /**
   * Trae dos contornos: el de la pieza y, adentro, una ranura cerrada del ancho
   * de la placa (0,3 m de edificio a 1:100) por donde pasa una losa. La ranura
   * no viene marcada como abertura, pero cae dentro del contorno: se dibuja
   * como hueco, no como material.
   */
  it("se dibuja entera, con su ranura interior como hueco", () => {
    const { outer, holes } = edgesToRings(
      fusionada.outline!.map((e) => ({ a: e.a, b: e.b, hole: e.hole === true })),
    );
    expect(outer).toHaveLength(2);
    expect(holes).toHaveLength(0);

    const areaRanura = 2.318;
    // `area_m2` del backend es la del contorno exterior, sin restar la ranura.
    expect(areaDibujada(liftOutline(fusionada, fusionada.outline!).positions)).toBeCloseTo(
      fusionada.areaM2 - areaRanura,
      2,
    );
  });

  /**
   * Tramos separados por un vano: una sola etiqueta y contornos que no se
   * tocan. Se dibujan todos; ninguno se toma por hueco del otro.
   */
  it("una pieza con contornos separados se dibuja con todas sus partes", () => {
    const rect = (x0: number, x1: number) => [
      { a: { x: x0, y: 0 }, b: { x: x1, y: 0 } },
      { a: { x: x1, y: 0 }, b: { x: x1, y: 2 } },
      { a: { x: x1, y: 2 }, b: { x: x0, y: 2 } },
      { a: { x: x0, y: 2 }, b: { x: x0, y: 0 } },
    ];
    const partes = [...rect(0, 3), ...rect(4, 5)]; // un vano de 1 m en el medio
    const { positions } = liftOutline(placement("A9"), partes);
    expect(areaDibujada(positions)).toBeCloseTo(3 * 2 + 1 * 2, 6);
  });
});

describe("qué piezas muestra el instructivo (§0.3)", () => {
  it("una fusión sin recalcular la topología: se dibuja la pieza que quedó y nada de los absorbidos", () => {
    // La topología todavía lista los cuatro tramos; el set de corte, sólo el 180.
    const guia = buildAssemblyGuideFromTopology(
      topologia([179, 180, 181, 236].map((id) => grupo(id, "wall"))),
      { setDeCorte: setReal },
    );
    expect(guia.panels.map((p) => [p.source_group_id, p.id])).toEqual([[180, "A9"]]);
    expect(guia.panels[0].area_m2).toBeCloseTo(fusionada.areaM2, 6);
    expect(guia.steps?.flatMap((s) => s.panel_ids)).toEqual(["A9"]);
  });

  it("una pieza del set de corte se dibuja aunque su grupo figure descartado en la topología", () => {
    // El grupo dueño de una fusión puede ser uno que el clasificador descartó.
    const guia = buildAssemblyGuideFromTopology(topologia([grupo(7, "discard")]), {
      setDeCorte: new Map([[7, placement("A3")]]),
    });
    expect(guia.panels.map((p) => [p.id, p.category])).toEqual([["A3", "wall"]]);
  });

  it("un descartado que el usuario pasa a pared aparece, y entra en los pasos", () => {
    const overrides = new Map<number, FaceCategory>([[2, "wall"]]);
    const fase = {
      ...topologia([grupo(1, "wall"), grupo(2, "discard")]),
      // El orden de armado de la subida no conoce al grupo rescatado.
      assemblySteps: [{ step: 1, level: 0, groupId: 1 }],
    } as Phase1Result;
    const guia = buildAssemblyGuideFromTopology(fase, {
      overrides,
      setDeCorte: new Map([
        [1, placement("A1")],
        [2, placement("A30")],
      ]),
    });
    expect(guia.panels.map((p) => p.id).sort()).toEqual(["A1", "A30"]);
    expect(guia.steps?.flatMap((s) => s.panel_ids).sort()).toEqual(["A1", "A30"]);
  });

  it("una pieza que se corta pero no tiene grupo en la topología del front también se dibuja", () => {
    const pl = placement("B7", "floor");
    const guia = buildAssemblyGuideFromTopology(topologia([grupo(1, "wall")]), {
      setDeCorte: new Map([
        [1, placement("A1")],
        [99, pl],
      ]),
    });
    const huerfana = guia.panels.find((p) => p.source_group_id === 99)!;
    expect(huerfana).toMatchObject({ id: "B7", category: "floor", width_m: 4, height_m: 2 });
    // Ubicada con su propio marco: el centro del rectángulo del placement.
    expect(huerfana.centroid).toEqual({ x: 12, y: 1, z: 5 });
    expect(centroDePlacement(pl)).toEqual({ x: 12, y: 1, z: 5 });
    expect(guia.elevations.floor?.panel_ids).toEqual(["B7"]);
  });

  it("lo que no está en el set de corte no se dibuja, aunque la topología lo tenga como pared", () => {
    const guia = buildAssemblyGuideFromTopology(topologia([grupo(1, "wall"), grupo(2, "wall")]), {
      setDeCorte: new Map([[1, placement("A1")]]),
    });
    expect(guia.panels.map((p) => p.id)).toEqual(["A1"]);
  });
});

describe("estadoNoRecibido: el backend dice cuánto estado le llegó", () => {
  const enviado = {
    overrides: { 2: "wall", 182: "discard" },
    merges: [[179, 180, 181, 236]],
    wall_wall_decisions: { 3: 245 },
    wall_wall_decisions_by_pair: [{ group_a: 179, group_b: 245, yield_group_id: 245 }],
  };

  it("sin diferencias cuando llegó todo", () => {
    expect(
      estadoNoRecibido(enviado, { recibido: { overrides: 2, merges: 1, decisiones: 2 } }),
    ).toEqual([]);
    // La respuesta real de esa fusión.
    expect(estadoNoRecibido({ ...enviado, overrides: {}, wall_wall_decisions: {}, wall_wall_decisions_by_pair: [] }, fusion.servidor)).toEqual([]);
  });

  it("dice qué llegó de menos", () => {
    expect(
      estadoNoRecibido(enviado, { recibido: { overrides: 2, merges: 0, decisiones: 2 } }),
    ).toEqual(["merges: enviados 1, recibidos 0"]);
  });

  it("un backend que no informa no genera avisos", () => {
    expect(estadoNoRecibido(enviado, { ms: 12 })).toEqual([]);
    expect(estadoNoRecibido(enviado, undefined)).toEqual([]);
  });
});
