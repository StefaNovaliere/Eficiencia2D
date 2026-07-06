import { describe, it, expect } from "vitest";
import { buildAssemblyGuideFromTopology, groupLabel } from "@/core/assembly-guide-build";
import type { Phase1Result, Placement } from "@/core/pipeline";
import type { GeometryGroup, FaceCategory } from "@/core/group-classifier";
import type { Face3D } from "@/core/types";

function group(
  id: number,
  category: FaceCategory,
  normal: { x: number; y: number; z: number },
  faceIndices: number[] = [],
  label = "",
): GeometryGroup {
  return {
    id,
    label,
    category,
    faceIndices,
    totalArea: 1,
    centroid: { x: 0, y: 0, z: 0 },
    orientation: "",
    representativeNormal: normal,
    minY: 0,
    maxY: 1,
  };
}

// Cara cuadrada 3×2 en el plano XY (para el bounding del fallback).
const QUAD: Face3D = {
  vertices: [
    { x: 0, y: 0, z: 0 },
    { x: 3, y: 0, z: 0 },
    { x: 3, y: 2, z: 0 },
    { x: 0, y: 2, z: 0 },
  ],
  normal: { x: 0, y: 0, z: 1 },
  innerLoops: [],
};

function phase1(over: Partial<Phase1Result>): Phase1Result {
  return {
    faces: [],
    rawFaces: [],
    appliedAxis: "Y",
    groups: [],
    joints: [],
    adjustments: [],
    wallWallJoints: [],
    stem: "t",
    warnings: [],
    preSplitFaceCount: 0,
    suggestedMerges: [],
    ...over,
  };
}

describe("groupLabel", () => {
  it("prefers panelIdByGroup, then group.label, then P{id}", () => {
    expect(groupLabel(group(1, "wall", { x: 1, y: 0, z: 0 }), { 1: "A1" })).toBe("A1");
    expect(groupLabel(group(2, "wall", { x: 1, y: 0, z: 0 }, [], "Muro"))).toBe("Muro");
    expect(groupLabel(group(3, "wall", { x: 1, y: 0, z: 0 }))).toBe("P3");
  });
});

describe("buildAssemblyGuideFromTopology", () => {
  const groups = [
    group(1, "floor", { x: 0, y: 1, z: 0 }, [0]),
    group(2, "wall", { x: 1, y: 0, z: 0 }),
    group(3, "wall", { x: 0, y: 0, z: 1 }, [0]),
    group(4, "discard", { x: 0, y: 1, z: 0 }),
  ];
  const placements: Record<number, Placement> = {
    2: {
      origin: { x: 0, y: 0, z: 0 },
      uAxis: { x: 1, y: 0, z: 0 },
      vAxis: { x: 0, y: 1, z: 0 },
      normal: { x: 1, y: 0, z: 0 },
      widthM: 2,
      heightM: 1,
      mirrored: false,
    },
  };

  it("creates one panel per non-discard group and steps cover all labels", () => {
    const data = buildAssemblyGuideFromTopology(
      phase1({ groups, faces: [QUAD], placements, panelIdByGroup: { 1: "A1" } }),
    );
    expect(data.panels.map((p) => p.id).sort()).toEqual(["A1", "P2", "P3"]);
    expect(data.totals.total_panels).toBe(3);
    expect(data.totals.floor_count).toBe(1);
    expect(data.totals.wall_count).toBe(2);

    // Todos los labels aparecen en algún step (si no, no se construyen las piezas).
    const inSteps = new Set((data.steps ?? []).flatMap((s) => s.panel_ids));
    for (const p of data.panels) expect(inSteps.has(p.id)).toBe(true);
    // El primer step es la base (pisos).
    expect(data.steps?.[0].panel_ids).toEqual(["A1"]);
  });

  it("uses placement dims when present and face bbox otherwise", () => {
    const data = buildAssemblyGuideFromTopology(
      phase1({ groups, faces: [QUAD], placements, panelIdByGroup: { 1: "A1" } }),
    );
    const wall2 = data.panels.find((p) => p.id === "P2")!; // tiene placement
    expect(wall2.width_m).toBe(2);
    expect(wall2.height_m).toBe(1);
    const wall3 = data.panels.find((p) => p.id === "P3")!; // sin placement → bbox QUAD (3×2)
    expect(wall3.width_m).toBeCloseTo(3);
    expect(wall3.height_m).toBeCloseTo(2);
  });

  it("orders steps from backend assembly_steps (one piece per step, discards excluded)", () => {
    const data = buildAssemblyGuideFromTopology(
      phase1({
        groups,
        faces: [QUAD],
        placements,
        panelIdByGroup: { 1: "A1" },
        assemblySteps: [
          { step: 1, groupId: 1, label: "A1", level: 0 },
          { step: 3, groupId: 2, label: "P2", level: 1 },
          { step: 2, groupId: 3, label: "P3", level: 0 },
          { step: 4, groupId: 4, label: "X", level: 1 }, // descartado → se ignora
        ],
      }),
    );
    // Orden por `step` (1,2,3), una pieza por paso, sin el grupo descartado.
    expect(data.steps?.map((s) => s.panel_ids)).toEqual([["A1"], ["P3"], ["P2"]]);
  });

  it("within a level, reveals the largest wall before smaller pieces (openings)", () => {
    // Un piso (base) + dos muros y una "abertura" chica, todos en el nivel 0.
    // El backend los emite en un orden donde la abertura chica va antes que los
    // muros grandes; el front debe reordenar grande→chico dentro del nivel.
    function g(id: number, cat: FaceCategory, area: number): GeometryGroup {
      return {
        id,
        label: "",
        category: cat,
        faceIndices: [],
        totalArea: area,
        centroid: { x: 0, y: 0, z: 0 },
        orientation: "",
        representativeNormal: { x: 1, y: 0, z: 0 },
        minY: 0,
        maxY: 1,
      };
    }
    const lvlGroups = [
      g(1, "floor", 10), // piso base
      g(2, "wall", 6), // muro grande
      g(3, "wall", 0.3), // abertura / carpintería chica
      g(4, "wall", 3), // muro mediano
    ];
    const data = buildAssemblyGuideFromTopology(
      phase1({
        groups: lvlGroups,
        faces: [QUAD],
        panelIdByGroup: { 1: "F1", 2: "W1", 3: "OP", 4: "W2" },
        assemblySteps: [
          { step: 1, groupId: 1, label: "F1", level: 0 }, // piso
          { step: 2, groupId: 3, label: "OP", level: 0 }, // abertura chica primero (raro)
          { step: 3, groupId: 2, label: "W1", level: 0 }, // muro grande
          { step: 4, groupId: 4, label: "W2", level: 0 }, // muro mediano
        ],
      }),
    );
    // Piso primero (base), luego muros de mayor a menor área: W1(6) → W2(3) → OP(0.3).
    expect(data.steps?.map((s) => s.panel_ids)).toEqual([
      ["F1"],
      ["W1"],
      ["W2"],
      ["OP"],
    ]);
  });

  it("chains walls by contact: an adjacent smaller wall goes before a larger disconnected one", () => {
    // Nivel 0: piso F + 3 muros A(10) B(8) C(6). Contactos pared-pared: A–C y C–B
    // (cadena A-C-B); A y B NO se tocan. Por área pura sería A, B, C; encadenado
    // debe ser A, C, B (C toca A; luego B toca C) → nada "colgado" sólo por el piso.
    function g(id: number, cat: FaceCategory, area: number): GeometryGroup {
      return {
        id,
        label: "",
        category: cat,
        faceIndices: [],
        totalArea: area,
        centroid: { x: 0, y: 0, z: 0 },
        orientation: "",
        representativeNormal: { x: 1, y: 0, z: 0 },
        minY: 0,
        maxY: 1,
      };
    }
    const data = buildAssemblyGuideFromTopology(
      phase1({
        groups: [g(1, "floor", 20), g(2, "wall", 10), g(3, "wall", 8), g(4, "wall", 6)],
        faces: [QUAD],
        panelIdByGroup: { 1: "F", 2: "A", 3: "B", 4: "C" },
        // Contactos: A(2)–C(4) y C(4)–B(3). A(2)–B(3) NO adyacentes.
        wallWallJoints: [
          { jointIndex: 0, groupA: 2, groupB: 4 },
          { jointIndex: 1, groupA: 4, groupB: 3 },
        ],
        assemblySteps: [
          { step: 1, groupId: 1, label: "F", level: 0 },
          { step: 2, groupId: 2, label: "A", level: 0 },
          { step: 3, groupId: 3, label: "B", level: 0 },
          { step: 4, groupId: 4, label: "C", level: 0 },
        ],
      }),
    );
    expect(data.steps?.map((s) => s.panel_ids)).toEqual([["F"], ["A"], ["C"], ["B"]]);
  });

  it("excludes groups whose effective category is discard (override)", () => {
    const overrides = new Map<number, FaceCategory>([[1, "discard"]]);
    const data = buildAssemblyGuideFromTopology(
      phase1({ groups, faces: [QUAD], placements, panelIdByGroup: { 1: "A1" } }),
      { overrides },
    );
    expect(data.panels.find((p) => p.id === "A1")).toBeUndefined();
    expect(data.totals.floor_count).toBe(0);
  });
});
