import { describe, it, expect } from "vitest";
import type { Face3D } from "@/core/types";
import type { GeometryGroup } from "@/core/group-classifier";
import {
  buildDisplayGroupsFromCuts,
  cutDerivedParentId,
  isCutDerivedGroupId,
  toSplitPieceGroupId,
} from "@/core/cut-derived-groups";
import type { UserCut } from "@/core/user-cuts";
import { applyUserCutsToPanel } from "@/core/user-cuts";
import { projectFacesTo2D } from "@/core/panel-projection";

function wallGroup(id: number, faceIndex: number): GeometryGroup {
  return {
    id,
    label: `Pared ${id}`,
    category: "wall",
    faceIndices: [faceIndex],
    totalArea: 6,
    centroid: { x: 1, y: 1.5, z: 0 },
    orientation: "vertical",
    representativeNormal: { x: 0, y: 0, z: 1 },
  };
}

describe("cut-derived-groups", () => {
  const face: Face3D = {
    vertices: [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 2, y: 3, z: 0 },
      { x: 0, y: 3, z: 0 },
    ],
    normal: { x: 0, y: 0, z: 1 },
    innerLoops: [],
  };

  it("expone ids derivados negativos con parent recuperable", () => {
    const id = toSplitPieceGroupId(12, 0);
    expect(isCutDerivedGroupId(id)).toBe(true);
    expect(cutDerivedParentId(id)).toBe(12);
  });

  it("parte una pared en dos piezas seleccionables tras un recorte rectangular", () => {
    const parent = wallGroup(5, 0);
    const cuts: UserCut[] = [
      {
        id: "cut-1",
        groupId: 5,
        kind: "rect",
        u0: 0,
        v0: 1.0,
        u1: 2,
        v1: 1.4,
      },
    ];

    const proj = projectFacesTo2D([face], parent.representativeNormal, "Y");
    expect(proj).not.toBeNull();
    const panelPieces = applyUserCutsToPanel(
      proj!.widthM,
      proj!.heightM,
      proj!.edges,
      cuts,
    );
    expect(panelPieces.length).toBeGreaterThanOrEqual(2);

    const { displayGroups, splitParentIds, derivedTriangles } = buildDisplayGroupsFromCuts(
      [parent],
      [face],
      cuts,
      "Y",
    );

    expect(displayGroups.length).toBeGreaterThanOrEqual(2);
    expect(splitParentIds.has(5)).toBe(true);
    expect(displayGroups.every((g) => isCutDerivedGroupId(g.id))).toBe(true);
    const triCount = [...derivedTriangles.values()].reduce((n, t) => n + t.length, 0);
    expect(triCount).toBeGreaterThanOrEqual(2);
  });

  it("parte una pared en dos piezas tras un corte en línea", () => {
    const parent = wallGroup(5, 0);
    const cuts: UserCut[] = [
      {
        id: "cut-line",
        groupId: 5,
        kind: "line",
        u0: 0,
        v0: 1.5,
        u1: 2,
        v1: 1.5,
      },
    ];

    const proj = projectFacesTo2D([face], parent.representativeNormal, "Y");
    expect(proj).not.toBeNull();
    const panelPieces = applyUserCutsToPanel(
      proj!.widthM,
      proj!.heightM,
      proj!.edges,
      cuts,
    );
    expect(panelPieces.length).toBe(2);

    const { displayGroups, splitParentIds } = buildDisplayGroupsFromCuts(
      [parent],
      [face],
      cuts,
      "Y",
    );

    expect(displayGroups.length).toBe(2);
    expect(splitParentIds.has(5)).toBe(true);
    expect(displayGroups.map((g) => g.label)).toEqual([
      "Pared 5 · 1/2",
      "Pared 5 · 2/2",
    ]);
  });

  it("genera resto + recorte circular como componentes separados", () => {
    const parent = wallGroup(5, 0);
    const cuts: UserCut[] = [
      {
        id: "cut-circle",
        groupId: 5,
        kind: "circle",
        u0: 0.5,
        v0: 1.0,
        u1: 1.5,
        v1: 2.0,
      },
    ];

    const { displayGroups, splitParentIds, derivedTriangles, derivedPanelPolys } =
      buildDisplayGroupsFromCuts([parent], [face], cuts, "Y");

    expect([...derivedTriangles.keys()].length).toBeGreaterThanOrEqual(2);
    expect(displayGroups.length).toBeGreaterThanOrEqual(2);
    expect(splitParentIds.has(5)).toBe(true);
    expect(displayGroups.some((g) => g.label.includes("círculo"))).toBe(true);
    expect(displayGroups.some((g) => g.label.includes("resto"))).toBe(true);
    const circleGroup = displayGroups.find((g) => g.label.includes("círculo"));
    expect(circleGroup).toBeDefined();
    expect(derivedPanelPolys.size).toBeGreaterThanOrEqual(1);
    expect(derivedPanelPolys.has(circleGroup!.id)).toBe(true);
  });

  it("sin cortes devuelve los grupos originales", () => {
    const parent = wallGroup(5, 0);
    const { displayGroups, splitParentIds } = buildDisplayGroupsFromCuts(
      [parent],
      [face],
      [],
      "Y",
    );
    expect(splitParentIds.size).toBe(0);
    expect(displayGroups).toEqual([parent]);
  });

  it("corte pequeño mantiene la pared (resto con triángulos, sin pieza extraída)", () => {
    const parent = wallGroup(5, 0);
    const cuts: UserCut[] = [
      {
        id: "cut-tiny",
        groupId: 5,
        kind: "rect",
        u0: 1.0,
        v0: 1.5,
        u1: 1.1,
        v1: 1.6,
      },
    ];

    const { displayGroups, splitParentIds, derivedTriangles, derivedPanelPolys } =
      buildDisplayGroupsFromCuts([parent], [face], cuts, "Y");

    expect(splitParentIds.has(5)).toBe(true);
    expect(displayGroups.some((g) => g.label.includes("resto"))).toBe(true);
    expect(displayGroups.some((g) => g.label.includes("recorte"))).toBe(false);
    const resto = displayGroups.find((g) => g.label.includes("resto"));
    expect(resto).toBeDefined();
    expect((derivedTriangles.get(resto!.id)?.length ?? 0)).toBeGreaterThan(0);
    // resto always gets a panel poly now so the viewer can triangulate clean holes
    expect(derivedPanelPolys.has(resto!.id)).toBe(true);
  });

  it("muchos cortes pequeños no eliminan la pared — resto conserva malla", () => {
    const parent = wallGroup(5, 0);
    const cuts: UserCut[] = Array.from({ length: 12 }, (_, i) => ({
      id: `cut-${i}`,
      groupId: 5,
      kind: "rect" as const,
      u0: 0.2 + (i % 4) * 0.4,
      v0: 0.3 + Math.floor(i / 4) * 0.7,
      u1: 0.35 + (i % 4) * 0.4,
      v1: 0.45 + Math.floor(i / 4) * 0.7,
    }));

    const { displayGroups, splitParentIds, derivedTriangles } = buildDisplayGroupsFromCuts(
      [parent],
      [face],
      cuts,
      "Y",
    );

    expect(splitParentIds.has(5)).toBe(true);
    const resto = displayGroups.find((g) => g.label.includes("resto"));
    expect(resto).toBeDefined();
    expect((derivedTriangles.get(resto!.id)?.length ?? 0)).toBeGreaterThan(0);
  });

  it("con surfaceNormal solo asigna triángulos de la cara clickeada", () => {
    const backFace: Face3D = {
      vertices: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 3, z: 0 },
        { x: 2, y: 3, z: 0 },
        { x: 2, y: 0, z: 0 },
      ],
      normal: { x: 0, y: 0, z: -1 },
      innerLoops: [],
    };
    const parent: GeometryGroup = {
      ...wallGroup(5, 0),
      faceIndices: [0, 1],
    };
    const cuts: UserCut[] = [
      {
        id: "cut-front",
        groupId: 5,
        kind: "circle",
        u0: 0.5,
        v0: 1.0,
        u1: 1.5,
        v1: 2.0,
        surfaceNormal: { x: 0, y: 0, z: 1 },
      },
    ];

    const { derivedTriangles } = buildDisplayGroupsFromCuts(
      [parent],
      [face, backFace],
      cuts,
      "Y",
    );

    const allRefs = [...derivedTriangles.values()].flat();
    for (const ref of allRefs) {
      expect(ref.faceIndex).toBe(0);
    }
  });
});
