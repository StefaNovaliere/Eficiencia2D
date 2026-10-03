import { describe, expect, it } from "vitest";
import { conEtiquetasDeCorte } from "@/core/assembly-cutset";
import { buildAssemblyGuideFromTopology } from "@/core/assembly-guide-build";
import { buildAssemblyPieces, computeSequenceBounds } from "@/core/assembly-sequence";
import type { NestingPlacement } from "@/core/final-pieces";
import type { Phase1Result } from "@/core/pipeline";
import type { GeometryGroup } from "@/core/group-classifier";

function grupo(id: number, over: Partial<GeometryGroup> = {}): GeometryGroup {
  return {
    id,
    category: "wall",
    faceIndices: [],
    totalArea: 10,
    centroid: { x: id, y: 0, z: 0 },
    representativeNormal: { x: 0, y: 0, z: 1 },
    ...over,
  } as GeometryGroup;
}

function corte(panelId: string, over: Partial<NestingPlacement> = {}): NestingPlacement {
  return {
    panelId,
    origin: { x: 0, y: 0, z: 0 },
    uAxis: { x: 1, y: 0, z: 0 },
    vAxis: { x: 0, y: 1, z: 0 },
    normal: { x: 0, y: 0, z: 1 },
    widthM: 4,
    heightM: 3,
    mirrored: false,
    areaM2: 12,
    ...over,
  };
}

/**
 * Lo que pasa con un modelo real: la topología numera los grupos no
 * descartados, el set de corte descarta uno y RENUMERA. En `demo.obj` 33 de 50
 * piezas tenían una etiqueta en el visor y otra en la plancha.
 */
const phase1 = {
  groups: [grupo(10), grupo(20), grupo(30)],
  faces: [],
  panelIdByGroup: { 10: "A1", 20: "A2", 30: "A3" },
  assemblySteps: [
    { step: 1, groupId: 10, label: "A1", level: 0 },
    { step: 2, groupId: 20, label: "A2", level: 0 },
    { step: 3, groupId: 30, label: "A3", level: 0 },
  ],
} as unknown as Phase1Result;

// El grupo 20 no se corta; el 30 pasa a llamarse A2 en la plancha.
const setDeCorte = new Map<number, NestingPlacement>([
  [10, corte("A1")],
  [30, corte("A2", { widthM: 2.5, heightM: 2, areaM2: 4.2 })],
]);

describe("conEtiquetasDeCorte", () => {
  it("cada grupo pasa a llamarse como en la plancha", () => {
    const p = conEtiquetasDeCorte(phase1, setDeCorte);
    expect(p.panelIdByGroup).toEqual({ 10: "A1", 30: "A2" });
  });
});

describe("buildAssemblyGuideFromTopology con set de corte", () => {
  const guia = buildAssemblyGuideFromTopology(conEtiquetasDeCorte(phase1, setDeCorte), {
    setDeCorte,
  });

  it("lista exactamente las piezas que se cortan, ni una más", () => {
    expect(guia.panels.map((p) => p.source_group_id).sort()).toEqual([10, 30]);
  });

  /**
   * Antes el grupo 30 aparecía como "A3" y el visor le buscaba la geometría a
   * la pieza que en la plancha se llama A3 — otra.
   */
  it("con el nombre de la plancha y sus medidas", () => {
    const g30 = guia.panels.find((p) => p.source_group_id === 30)!;
    expect(g30.id).toBe("A2");
    expect(g30.width_m).toBe(2.5);
    expect(g30.area_m2).toBe(4.2);
  });
});

describe("placa centrada en el plano medio", () => {
  /**
   * El backend calcula cada recorte con la placa centrada en el plano medio
   * (borde de A a media placa del plano medio de B). Engrosarla hacia adentro
   * el espesor entero la corría media placa: 15 cm de edificio a 1:100.
   */
  it("un muro que sale del contorno de corte no se engrosa hacia adentro", () => {
    const outline = [
      { a: { x: 0, y: 0 }, b: { x: 4, y: 0 } },
      { a: { x: 4, y: 0 }, b: { x: 4, y: 3 } },
      { a: { x: 4, y: 3 }, b: { x: 0, y: 3 } },
      { a: { x: 0, y: 3 }, b: { x: 0, y: 0 } },
    ];
    const [pieza] = buildAssemblyPieces(
      {
        panels: [
          {
            id: "A1",
            category: "wall",
            source_group_id: 10,
            width_m: 4,
            height_m: 3,
            area_m2: 12,
            centroid: { x: 2, y: 1.5, z: 0 },
            normal: { x: 0, y: 0, z: 1 },
            label: "A1",
          },
        ],
        elevations: {},
        totals: { wall_count: 1, floor_count: 0, total_panels: 1 },
      },
      [{ title: "", description: "", panel_ids: ["A1"] }],
      {
        labelToGroupId: new Map([["A1", 10]]),
        faces: [],
        faceIndicesByLabel: new Map(),
        nestingPlacementByGroupId: new Map([[10, corte("A1", { outline, thicknessM: 0.3 })]]),
      },
    );
    expect(pieza.liftSource).toBe("outline");
    expect(pieza.lifted?.inwardSlab).toBe(false);
    expect(pieza.depth_m).toBe(0.3);
  });
});

describe("computeSequenceBounds", () => {
  /**
   * El visor centraba la escena con los CENTROIDES de las piezas VISIBLES: un
   * piso de 17 m daba 3 m de tamaño y la maqueta se corría en cada paso.
   */
  it("mide la geometría real, no los centroides", () => {
    const b = computeSequenceBounds([
      {
        id: "B1",
        stepIndex: 0,
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        normal: { x: 0, y: 1, z: 0 },
        width_m: 17,
        height_m: 9,
        depth_m: 0.3,
        category: "floor",
        lifted: {
          positions: [0, 0, 0, 17, 0, 0, 17, 0, 9],
          openings: [],
          hasHoles: false,
        },
      },
    ]);
    expect(b.center).toEqual({ x: 8.5, y: 0, z: 4.5 });
    expect(b.diag).toBeCloseTo(Math.hypot(17, 9), 9);
  });
});
