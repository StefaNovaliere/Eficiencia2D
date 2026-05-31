import { describe, it, expect } from "vitest";
import { parseObj } from "@/core/obj-parser";
import { detectJoints } from "@/core/joint-detector";
import { projectFacesTo2D } from "@/core/cutting-sheet";
import type { Face3D, IndexedFace3D, Vec3 } from "@/core/types";
import type { GeometryGroup, FaceCategory } from "@/core/group-classifier";

function makeIndexedFace(vertices: Vec3[], normal: Vec3, vertexIndices: number[]): IndexedFace3D {
  return { vertices, normal, innerLoops: [], vertexIndices };
}

function makePlainFace(vertices: Vec3[], normal: Vec3): Face3D {
  return { vertices, normal, innerLoops: [] };
}

function makeGroup(overrides: Partial<GeometryGroup> & { id: number; category: FaceCategory; representativeNormal: Vec3 }): GeometryGroup {
  return {
    label: `Grupo ${overrides.id}`,
    faceIndices: [],
    totalArea: 1,
    centroid: { x: 0, y: 0, z: 0 },
    orientation: "N",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// OBJ Parser — vertex indices preserved
// ---------------------------------------------------------------------------

describe("parseObj — topology preservation", () => {
  it("preserves vertex indices from OBJ face definitions", () => {
    const obj = `
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
f 1 2 3 4
`;
    const result = parseObj(obj);
    expect(result.faces.length).toBe(1);
    expect(result.faces[0].vertexIndices).toEqual([0, 1, 2, 3]);
  });

  it("returns the global vertex table", () => {
    const obj = `
v 0 0 0
v 1 0 0
v 1 1 0
f 1 2 3
`;
    const result = parseObj(obj);
    expect(result.vertices.length).toBe(3);
    expect(result.vertices[0]).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("handles negative OBJ indices correctly", () => {
    const obj = `
v 0 0 0
v 1 0 0
v 1 1 0
f -3 -2 -1
`;
    const result = parseObj(obj);
    expect(result.faces[0].vertexIndices).toEqual([0, 1, 2]);
  });

  it("two faces sharing vertex indices share exact topology", () => {
    const obj = `
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
v 2 0 0
v 2 1 0
f 1 2 3 4
f 2 5 6 3
`;
    const result = parseObj(obj);
    expect(result.faces.length).toBe(2);
    const shared = result.faces[0].vertexIndices.filter(
      (vi) => result.faces[1].vertexIndices.includes(vi),
    );
    expect(shared.sort()).toEqual([1, 2]);
  });
});

// ---------------------------------------------------------------------------
// Boundary edge detection — exact via indices
// ---------------------------------------------------------------------------

describe("projectFacesTo2D — index-based boundary edges", () => {
  it("correctly identifies boundary edges using vertex indices", () => {
    // Two adjacent triangles sharing edge 1-2 (indices).
    // Triangle 1: vertices 0,1,2. Triangle 2: vertices 1,3,2.
    // Shared edge: 1-2 (internal → not boundary).
    // Boundary edges: 0-1, 0-2, 1-3, 2-3.
    const f1 = makeIndexedFace(
      [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0.5, y: 0, z: 1 }],
      { x: 0, y: 1, z: 0 },
      [0, 1, 2],
    );
    const f2 = makeIndexedFace(
      [{ x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 0.5, y: 0, z: 1 }],
      { x: 0, y: 1, z: 0 },
      [1, 3, 2],
    );

    const result = projectFacesTo2D([f1, f2], { x: 0, y: 1, z: 0 }, "Y");
    expect(result).not.toBeNull();
    // 4 boundary edges (the shared edge 1-2 is internal).
    expect(result!.edges.length).toBe(4);
  });

  it("keeps shared-index edge as internal (not boundary)", () => {
    // Two quads sharing edge 1-2 by index. That edge is internal → 6 boundary edges.
    const f1 = makeIndexedFace(
      [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 1 }, { x: 0, y: 0, z: 1 }],
      { x: 0, y: 1, z: 0 },
      [0, 1, 2, 3],
    );
    const f2 = makeIndexedFace(
      [{ x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 2, y: 0, z: 1 }, { x: 1, y: 0, z: 1 }],
      { x: 0, y: 1, z: 0 },
      [1, 4, 5, 2],
    );

    const result = projectFacesTo2D([f1, f2], { x: 0, y: 1, z: 0 }, "Y");
    expect(result).not.toBeNull();
    // Combined 2×1 rectangle: 4 outer edges. Shared edge 1-2 is internal.
    // (traceContours may or may not add edges but the outer loop has 4)
    expect(result!.edges.length).toBeGreaterThanOrEqual(4);
    expect(result!.edges.length).toBeLessThanOrEqual(6);
    expect(result!.widthM).toBeCloseTo(2, 1);
    expect(result!.heightM).toBeCloseTo(1, 1);
  });
});

// ---------------------------------------------------------------------------
// Joint detection — exact via indices
// ---------------------------------------------------------------------------

describe("detectJoints — index-based edge sharing", () => {
  it("detects joint via shared vertex indices", () => {
    // Floor face uses vertices 0,1,2,3; wall face uses 1,4,5,2.
    // Shared edge: indices 1-2.
    const floor = makeIndexedFace(
      [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 2, y: 0, z: 3 }, { x: 0, y: 0, z: 3 }],
      { x: 0, y: 1, z: 0 },
      [0, 1, 2, 3],
    );
    const wall = makeIndexedFace(
      [{ x: 2, y: 0, z: 0 }, { x: 2, y: 2.5, z: 0 }, { x: 2, y: 2.5, z: 3 }, { x: 2, y: 0, z: 3 }],
      { x: 1, y: 0, z: 0 },
      [1, 4, 5, 2],
    );

    const groups: GeometryGroup[] = [
      makeGroup({ id: 1, category: "floor", faceIndices: [0], representativeNormal: { x: 0, y: 1, z: 0 } }),
      makeGroup({ id: 2, category: "wall", faceIndices: [1], representativeNormal: { x: 1, y: 0, z: 0 } }),
    ];

    const joints = detectJoints([floor, wall], groups);
    expect(joints.length).toBe(1);
    expect(joints[0].totalLength).toBeCloseTo(3, 1);
  });

  it("no joint when faces are at same position but different indices", () => {
    // Two faces with overlapping edge coordinates but NO shared vertex indices.
    const f1 = makeIndexedFace(
      [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 1 }, { x: 0, y: 0, z: 1 }],
      { x: 0, y: 1, z: 0 },
      [0, 1, 2, 3],
    );
    const f2 = makeIndexedFace(
      [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }],
      { x: 0, y: 0, z: -1 },
      [10, 11, 12, 13],
    );

    const groups: GeometryGroup[] = [
      makeGroup({ id: 1, category: "floor", faceIndices: [0], representativeNormal: { x: 0, y: 1, z: 0 } }),
      makeGroup({ id: 2, category: "wall", faceIndices: [1], representativeNormal: { x: 0, y: 0, z: -1 } }),
    ];

    const joints = detectJoints([f1, f2], groups);
    // With exact topology, these don't share edges despite overlapping coordinates.
    expect(joints.length).toBe(0);
  });

  it("falls back to snap for faces without vertex indices", () => {
    // Plain Face3D (no vertexIndices) — should still find joints via snap fallback.
    const f1 = makePlainFace(
      [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 2, y: 0, z: 3 }, { x: 0, y: 0, z: 3 }],
      { x: 0, y: 1, z: 0 },
    );
    const f2 = makePlainFace(
      [{ x: 2, y: 0, z: 0 }, { x: 2, y: 2.5, z: 0 }, { x: 2, y: 2.5, z: 3 }, { x: 2, y: 0, z: 3 }],
      { x: 1, y: 0, z: 0 },
    );

    const groups: GeometryGroup[] = [
      makeGroup({ id: 1, category: "floor", faceIndices: [0], representativeNormal: { x: 0, y: 1, z: 0 } }),
      makeGroup({ id: 2, category: "wall", faceIndices: [1], representativeNormal: { x: 1, y: 0, z: 0 } }),
    ];

    const joints = detectJoints([f1, f2], groups);
    expect(joints.length).toBe(1);
  });
});
