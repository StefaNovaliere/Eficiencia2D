import { describe, it, expect } from "vitest";
import type { Face3D } from "@/core/types";
import type { GeometryGroup } from "@/core/group-classifier";
import { applyUserCutsToPanel, panelPiecePolygons, type UserCut } from "@/core/user-cuts";
import { projectFacesTo2D } from "@/core/panel-projection";

describe("applyUserCutsToPanel", () => {
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

  const group: GeometryGroup = {
    id: 5,
    label: "Pared",
    category: "wall",
    faceIndices: [0],
    totalArea: 6,
    centroid: { x: 1, y: 1.5, z: 0 },
    orientation: "vertical",
    representativeNormal: { x: 0, y: 0, z: 1 },
  };

  it("resta un círculo y deja un agujero en la pieza restante", () => {
    const proj = projectFacesTo2D([face], group.representativeNormal, "Y");
    expect(proj).not.toBeNull();

    const cuts: UserCut[] = [
      {
        id: "c1",
        groupId: 5,
        kind: "circle",
        u0: 0.5,
        v0: 1.0,
        u1: 1.5,
        v1: 2.0,
      },
    ];

    const pieces = applyUserCutsToPanel(
      proj!.widthM,
      proj!.heightM,
      proj!.edges,
      cuts,
    );
    expect(pieces.length).toBe(1);

    const parentEdges = pieces[0].edges.map((e) => ({
      a: { x: e.a.x + pieces[0].minU, y: e.a.y + pieces[0].minV },
      b: { x: e.b.x + pieces[0].minU, y: e.b.y + pieces[0].minV },
      hole: e.hole,
    }));
    const poly = panelPiecePolygons(parentEdges);
    expect(poly?.holes.length).toBeGreaterThanOrEqual(1);
  });
});
