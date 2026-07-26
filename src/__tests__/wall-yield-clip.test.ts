import { describe, it, expect } from "vitest";
import type { GeometryGroup } from "@/core/group-classifier";
import type { Joint } from "@/core/joint-detector";
import type { WallWallJoint } from "@/core/assembly-adjuster";
import {
  clipPositionsAgainstDominantFace,
  buildYieldClipSpecs,
} from "@/core/wall-yield-clip";

describe("wall-yield-clip", () => {
  it("corta contra la cara del slab dominante sin abrir huecos grandes", () => {
    // Dominante en x=0 (plano YZ). Yielder avanza en +X. Cara a x=0.05 (half slab).
    const positions = [
      -0.02, 0, 0, 1, 0, 0, 1, 1, 0, // un vértice penetra
    ];
    const out = clipPositionsAgainstDominantFace(
      positions,
      { x: 0.05, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 0.5, z: 0 },
      2,
    );
    expect(out[0]).toBeCloseTo(0.05, 5);
    expect(out[3]).toBeCloseTo(1, 5);
    expect(out[6]).toBeCloseTo(1, 5);
  });

  it("no mueve vértices lejos del encuentro", () => {
    const positions = [-0.02, 0, 0, 1, 0, 0, 1, 1, 0];
    const out = clipPositionsAgainstDominantFace(
      positions,
      { x: 0.05, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 100, y: 0, z: 0 }, // encuentro lejos
      0.5,
    );
    expect(out[0]).toBeCloseTo(-0.02, 5);
  });

  it("usa espesor de slab, no thickness arquitectónico", () => {
    const groups: GeometryGroup[] = [
      {
        id: 1,
        label: "A",
        category: "wall",
        faceIndices: [],
        totalArea: 1,
        centroid: { x: 1, y: 1, z: 0 },
        orientation: "N",
        representativeNormal: { x: 0, y: 0, z: 1 },
        thickness: 0.15,
      },
      {
        id: 2,
        label: "B",
        category: "wall",
        faceIndices: [],
        totalArea: 1,
        centroid: { x: 0, y: 1, z: 1 },
        orientation: "E",
        representativeNormal: { x: 1, y: 0, z: 0 },
        thickness: 0.4, // arquitectónico enorme — no debe usarse
      },
    ];
    const ww: WallWallJoint[] = [
      { jointIndex: 0, groupA: 1, groupB: 2, suggestedYieldGroupId: 1 },
    ];
    const joints: Joint[] = [
      {
        groupA: 1,
        groupB: 2,
        totalLength: 1,
        dihedralAngle: Math.PI / 2,
        edgeMid: { x: 0, y: 1, z: 0 },
        edgeDir: { x: 0, y: 1, z: 0 },
        horizontalFrac: 0,
      },
    ];
    const slab = 0.1;
    const specs = buildYieldClipSpecs(ww, joints, groups, new Map([[0, 1]]), slab);
    expect(specs).toHaveLength(1);
    expect(specs[0].groupId).toBe(1);
    // Cara interior del dominante (id 2, normal +X) hacia el yielder: x = depth
    expect(specs[0].planePoint.x).toBeCloseTo(slab, 5);
    expect(specs[0].planeNormal.x).toBeCloseTo(1, 5);
  });
});
