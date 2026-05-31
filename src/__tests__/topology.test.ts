import { describe, it, expect } from "vitest";
import { parseObj } from "@/core/obj-parser";
import { detectJoints } from "@/core/joint-detector";
import { projectFacesTo2D, traceContours } from "@/core/cutting-sheet";
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

describe("projectFacesTo2D — union outline", () => {
  it("merges two adjacent triangles into a single clean outline", () => {
    // Triangle 1: (0,0),(1,0),(0.5,1). Triangle 2: (1,0),(2,0),(0.5,1).
    // They share edge (1,0)-(0.5,1) and the base point (1,0) is collinear with
    // (0,0)-(2,0). The union is therefore a single triangle (0,0)-(2,0)-(0.5,1):
    // the shared edge and the collinear midpoint both vanish → 3 edges.
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
    expect(result!.edges.length).toBe(3);
    expect(result!.widthM).toBeCloseTo(2, 1);
    expect(result!.heightM).toBeCloseTo(1, 1);
  });

  it("merges two abutting quads into one rectangle with no internal seam", () => {
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
    // Clean 2×1 rectangle: exactly 4 edges, no internal seam at x=1.
    expect(result!.edges.length).toBe(4);
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

// ---------------------------------------------------------------------------
// traceContours — index-based vertex identity
// ---------------------------------------------------------------------------

describe("traceContours — index-based vertex identity", () => {
  it("preserves hole edges when indices prevent false snap merge", () => {
    // Outer rectangle (4 edges, indices 0-3).
    // Inner hole (4 edges, indices 10-13).
    // Hole corner at (2.005, 1) would snap to (2.00, 1.00) = same as outer
    // vertex (2, 1) under 1cm snap. With indices, they stay separate.
    const edges = [
      { ax: 0, ay: 0, bx: 4, by: 0, via: 0, vib: 1 },
      { ax: 4, ay: 0, bx: 4, by: 3, via: 1, vib: 2 },
      { ax: 4, ay: 3, bx: 0, by: 3, via: 2, vib: 3 },
      { ax: 0, ay: 3, bx: 0, by: 0, via: 3, vib: 0 },
      { ax: 1, ay: 1, bx: 2.005, by: 1, via: 10, vib: 11 },
      { ax: 2.005, ay: 1, bx: 2.005, by: 2, via: 11, vib: 12 },
      { ax: 2.005, ay: 2, bx: 1, by: 2, via: 12, vib: 13 },
      { ax: 1, ay: 2, bx: 1, by: 1, via: 13, vib: 10 },
    ];
    const result = traceContours(edges);
    expect(result.length).toBe(8);
  });

  it("preserves door frame hole with close vertices", () => {
    // Wall: 5m wide x 2.5m tall.
    // Door opening at the bottom: 0.8m wide x 2.1m tall.
    // Door bottom edge shares y=0 with wall bottom but different indices.
    const edges = [
      { ax: 0, ay: 0, bx: 5, by: 0, via: 0, vib: 1 },
      { ax: 5, ay: 0, bx: 5, by: 2.5, via: 1, vib: 2 },
      { ax: 5, ay: 2.5, bx: 0, by: 2.5, via: 2, vib: 3 },
      { ax: 0, ay: 2.5, bx: 0, by: 0, via: 3, vib: 0 },
      { ax: 1, ay: 0, bx: 1.8, by: 0, via: 20, vib: 21 },
      { ax: 1.8, ay: 0, bx: 1.8, by: 2.1, via: 21, vib: 22 },
      { ax: 1.8, ay: 2.1, bx: 1, by: 2.1, via: 22, vib: 23 },
      { ax: 1, ay: 2.1, bx: 1, by: 0, via: 23, vib: 20 },
    ];
    const result = traceContours(edges);
    expect(result.length).toBe(8);
  });

  it("falls back to snap for edges without indices", () => {
    // Same window-hole scenario as geometry-processing.test.ts,
    // without via/vib fields — uses snap fallback.
    const edges = [
      { ax: 0, ay: 0, bx: 4, by: 0 },
      { ax: 4, ay: 0, bx: 4, by: 3 },
      { ax: 4, ay: 3, bx: 0, by: 3 },
      { ax: 0, ay: 3, bx: 0, by: 0 },
      { ax: 1, ay: 1, bx: 2, by: 1 },
      { ax: 2, ay: 1, bx: 2, by: 2 },
      { ax: 2, ay: 2, bx: 1, by: 2 },
      { ax: 1, ay: 2, bx: 1, by: 1 },
    ];
    const result = traceContours(edges);
    expect(result.length).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// projectFacesTo2D — polygon union (silhouette + holes, no internal lines)
// ---------------------------------------------------------------------------

describe("projectFacesTo2D — polygon union", () => {
  const Y: Vec3 = { x: 0, y: 1, z: 0 };

  it("collapses two coincident thick-wall skins into one outline", () => {
    // Front and back skin of a wall with thickness project to the SAME 2D
    // rectangle. The union must yield a single outline, not a double one.
    const front = makeIndexedFace(
      [{ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }, { x: 3, y: 0, z: 2 }, { x: 0, y: 0, z: 2 }],
      Y,
      [0, 1, 2, 3],
    );
    const back = makeIndexedFace(
      [{ x: 0, y: 0.1, z: 0 }, { x: 3, y: 0.1, z: 0 }, { x: 3, y: 0.1, z: 2 }, { x: 0, y: 0.1, z: 2 }],
      Y,
      [10, 11, 12, 13],
    );

    const result = projectFacesTo2D([front, back], Y, "Y");
    expect(result).not.toBeNull();
    expect(result!.edges.length).toBe(4); // single rectangle, no doubling
    expect(result!.widthM).toBeCloseTo(3, 1);
    expect(result!.heightM).toBeCloseTo(2, 1);
  });

  it("merges 4 quads around a window into outline + hole", () => {
    // Wall 4×3 with a 1×1 window hole at [1,1]-[2,2], modeled as 4 quads.
    const mk = (pts: Array<[number, number]>, idx: number[]) =>
      makeIndexedFace(
        pts.map(([x, z]) => ({ x, y: 0, z })),
        Y,
        idx,
      );
    const below = mk([[0, 0], [4, 0], [4, 1], [0, 1]], [0, 1, 2, 3]);
    const above = mk([[0, 2], [4, 2], [4, 3], [0, 3]], [4, 5, 6, 7]);
    const left = mk([[0, 1], [1, 1], [1, 2], [0, 2]], [8, 9, 10, 11]);
    const right = mk([[2, 1], [4, 1], [4, 2], [2, 2]], [12, 13, 14, 15]);

    const result = projectFacesTo2D([below, above, left, right], Y, "Y");
    expect(result).not.toBeNull();
    // Outer rectangle (4) + window hole (4) = 8 edges, no internal seams.
    expect(result!.edges.length).toBe(8);
    expect(result!.widthM).toBeCloseTo(4, 1);
    expect(result!.heightM).toBeCloseTo(3, 1);
  });

  it("drops a tiny mesh-noise hole but keeps the outer silhouette", () => {
    // A solid 2×2 panel with a 2cm×2cm pinhole — below MIN_HOLE_AREA.
    const mk = (pts: Array<[number, number]>, idx: number[]) =>
      makeIndexedFace(pts.map(([x, z]) => ({ x, y: 0, z })), Y, idx);
    // Frame around a 0.02×0.02 hole centred at (1,1).
    const below = mk([[0, 0], [2, 0], [2, 0.99], [0, 0.99]], [0, 1, 2, 3]);
    const above = mk([[0, 1.01], [2, 1.01], [2, 2], [0, 2]], [4, 5, 6, 7]);
    const left = mk([[0, 0.99], [0.99, 0.99], [0.99, 1.01], [0, 1.01]], [8, 9, 10, 11]);
    const right = mk([[1.01, 0.99], [2, 0.99], [2, 1.01], [1.01, 1.01]], [12, 13, 14, 15]);

    const result = projectFacesTo2D([below, above, left, right], Y, "Y");
    expect(result).not.toBeNull();
    // Pinhole (0.02×0.02 = 0.0004 m² < 0.0025) is dropped → only the 4 outer edges.
    expect(result!.edges.length).toBe(4);
  });

  it("removes the diagonal of a triangulated quad", () => {
    // A square split into two triangles along the diagonal → union outline
    // is the square (4 edges), the internal diagonal is gone.
    const t1 = makeIndexedFace(
      [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 2, y: 0, z: 2 }],
      Y,
      [0, 1, 2],
    );
    const t2 = makeIndexedFace(
      [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 2 }, { x: 0, y: 0, z: 2 }],
      Y,
      [0, 2, 3],
    );

    const result = projectFacesTo2D([t1, t2], Y, "Y");
    expect(result).not.toBeNull();
    expect(result!.edges.length).toBe(4);
    expect(result!.widthM).toBeCloseTo(2, 1);
    expect(result!.heightM).toBeCloseTo(2, 1);
  });
});
