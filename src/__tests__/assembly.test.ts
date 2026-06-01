import { describe, it, expect } from "vitest";
import { areThinTwins } from "@/core/wall-thickness";
import type { TwinCandidate } from "@/core/wall-thickness";
import { detectJoints } from "@/core/joint-detector";
import { computeAdjustments } from "@/core/assembly-adjuster";
import { clipPanelAtV, mirrorEdgesHorizontal } from "@/core/cutting-sheet";
import type { GeometryGroup, FaceCategory } from "@/core/group-classifier";
import type { Face3D, Vec3 } from "@/core/types";

function makeFace(vertices: Vec3[], normal: Vec3): Face3D {
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

function makeJoint(groupA: number, groupB: number, totalLength: number, dihedralAngle: number, horizontalFrac = 1) {
  return {
    groupA,
    groupB,
    totalLength,
    dihedralAngle,
    edgeMid: { x: 0, y: 0, z: 0 },
    edgeDir: { x: 1, y: 0, z: 0 },
    horizontalFrac,
  };
}

// ---------------------------------------------------------------------------
// areThinTwins — returns thickness (number) instead of boolean
// ---------------------------------------------------------------------------

describe("areThinTwins — returns thickness", () => {
  it("returns distance for parallel opposing faces", () => {
    const a: TwinCandidate = {
      normal: { x: 1, y: 0, z: 0 },
      d: 0,
      centroid: { x: 0, y: 1, z: 1 },
      extent: 4,
    };
    const b: TwinCandidate = {
      normal: { x: -1, y: 0, z: 0 },
      d: -0.1,
      centroid: { x: 0.1, y: 1, z: 1 },
      extent: 4,
    };
    const result = areThinTwins(a, b, 0.5);
    expect(result).not.toBeNull();
    expect(result).toBeCloseTo(0.1, 3);
  });

  it("returns null for non-opposing normals", () => {
    const a: TwinCandidate = {
      normal: { x: 1, y: 0, z: 0 },
      d: 0,
      centroid: { x: 0, y: 0, z: 0 },
      extent: 2,
    };
    const b: TwinCandidate = {
      normal: { x: 0, y: 1, z: 0 },
      d: 0,
      centroid: { x: 0.1, y: 0, z: 0 },
      extent: 2,
    };
    expect(areThinTwins(a, b, 0.5)).toBeNull();
  });

  it("returns null when distance exceeds threshold", () => {
    const a: TwinCandidate = {
      normal: { x: 1, y: 0, z: 0 },
      d: 0,
      centroid: { x: 0, y: 1, z: 1 },
      extent: 4,
    };
    const b: TwinCandidate = {
      normal: { x: -1, y: 0, z: 0 },
      d: -2.0,
      centroid: { x: 2.0, y: 1, z: 1 },
      extent: 4,
    };
    expect(areThinTwins(a, b, 0.5)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// detectJoints — shared 3D edges between groups
// ---------------------------------------------------------------------------

describe("detectJoints", () => {
  it("detects a joint between two groups sharing an edge with spatial data", () => {
    // Floor face (horizontal, y=0)
    const floor = makeFace(
      [
        { x: 0, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 2, y: 0, z: 3 },
        { x: 0, y: 0, z: 3 },
      ],
      { x: 0, y: 1, z: 0 },
    );
    // Wall face (vertical, shares edge at x=2, y=0, z=0..3)
    const wall = makeFace(
      [
        { x: 2, y: 0, z: 0 },
        { x: 2, y: 2.5, z: 0 },
        { x: 2, y: 2.5, z: 3 },
        { x: 2, y: 0, z: 3 },
      ],
      { x: 1, y: 0, z: 0 },
    );

    const groups: GeometryGroup[] = [
      makeGroup({ id: 1, category: "floor", faceIndices: [0], representativeNormal: { x: 0, y: 1, z: 0 } }),
      makeGroup({ id: 2, category: "wall", faceIndices: [1], representativeNormal: { x: 1, y: 0, z: 0 } }),
    ];

    const joints = detectJoints([floor, wall], groups);
    expect(joints.length).toBe(1);
    expect(joints[0].totalLength).toBeCloseTo(3, 1);
    expect(joints[0].dihedralAngle).toBeCloseTo(90, 5);
    expect(joints[0].edgeMid).toBeDefined();
    expect(joints[0].edgeDir).toBeDefined();
    // The shared edge runs along Z at x=2, y=0 → horizontal (no Y component).
    expect(joints[0].horizontalFrac).toBeCloseTo(1, 1);
  });

  it("reports vertical edge as non-horizontal (wall-wall corner)", () => {
    // Two perpendicular walls sharing a vertical corner edge (0,0,0)→(0,3,0).
    const wallA = makeFace(
      [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 3, z: 0 },
        { x: 0, y: 3, z: 4 },
        { x: 0, y: 0, z: 4 },
      ],
      { x: -1, y: 0, z: 0 },
    );
    const wallB = makeFace(
      [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 3, z: 0 },
        { x: 3, y: 3, z: 0 },
        { x: 3, y: 0, z: 0 },
      ],
      { x: 0, y: 0, z: -1 },
    );

    const groups: GeometryGroup[] = [
      makeGroup({ id: 1, category: "wall", faceIndices: [0], representativeNormal: { x: -1, y: 0, z: 0 } }),
      makeGroup({ id: 2, category: "wall", faceIndices: [1], representativeNormal: { x: 0, y: 0, z: -1 } }),
    ];

    const joints = detectJoints([wallA, wallB], groups);
    expect(joints.length).toBe(1);
    // The shared edge is vertical → horizontalFrac ≈ 0.
    expect(joints[0].horizontalFrac).toBeCloseTo(0, 1);
  });

  it("returns empty for groups with no shared edges", () => {
    const face1 = makeFace(
      [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 1, y: 0, z: 1 },
        { x: 0, y: 0, z: 1 },
      ],
      { x: 0, y: 1, z: 0 },
    );
    const face2 = makeFace(
      [
        { x: 10, y: 0, z: 10 },
        { x: 11, y: 0, z: 10 },
        { x: 11, y: 0, z: 11 },
        { x: 10, y: 0, z: 11 },
      ],
      { x: 0, y: 1, z: 0 },
    );

    const groups: GeometryGroup[] = [
      makeGroup({ id: 1, category: "floor", faceIndices: [0], representativeNormal: { x: 0, y: 1, z: 0 } }),
      makeGroup({ id: 2, category: "floor", faceIndices: [1], representativeNormal: { x: 0, y: 1, z: 0 } }),
    ];

    const joints = detectJoints([face1, face2], groups);
    expect(joints.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeAdjustments — assembly compensation
// ---------------------------------------------------------------------------

describe("computeAdjustments", () => {
  it("shortens wall ON TOP of floor by floor thickness at 90° joint", () => {
    // Wall sits on top of the floor slab (wall.minY ≈ floor.maxY).
    const groups: GeometryGroup[] = [
      makeGroup({
        id: 1,
        category: "floor",
        representativeNormal: { x: 0, y: 1, z: 0 },
        thickness: 0.10,
        minY: 0,
        maxY: 0.10,
      }),
      makeGroup({
        id: 2,
        category: "wall",
        representativeNormal: { x: 1, y: 0, z: 0 },
        thickness: 0.20,
        minY: 0.10,
        maxY: 3.0,
      }),
    ];

    const joints = [makeJoint(1, 2, 3.0, 90)];

    const { adjustments } = computeAdjustments(joints, groups);
    expect(adjustments.length).toBe(1);
    expect(adjustments[0].groupId).toBe(2);
    expect(adjustments[0].delta).toBeCloseTo(-0.10, 3);
  });

  it("does NOT shorten wall BESIDE the floor", () => {
    // Wall is beside the slab (wall.minY < floor.maxY - tol, vertical edge).
    const groups: GeometryGroup[] = [
      makeGroup({
        id: 1,
        category: "floor",
        representativeNormal: { x: 0, y: 1, z: 0 },
        thickness: 0.10,
        minY: 0,
        maxY: 0.10,
      }),
      makeGroup({
        id: 2,
        category: "wall",
        representativeNormal: { x: 1, y: 0, z: 0 },
        minY: 0,
        maxY: 3.0,
      }),
    ];

    // Vertical shared edge → horizontalFrac = 0
    const joints = [makeJoint(1, 2, 3.0, 90, 0)];

    const { adjustments } = computeAdjustments(joints, groups);
    expect(adjustments.length).toBe(0);
  });

  it("produces no adjustment for non-90° joints", () => {
    const groups: GeometryGroup[] = [
      makeGroup({ id: 1, category: "floor", representativeNormal: { x: 0, y: 1, z: 0 }, thickness: 0.10, minY: 0, maxY: 0.10 }),
      makeGroup({ id: 2, category: "wall", representativeNormal: { x: 1, y: 0, z: 0 }, minY: 0.10, maxY: 3.0 }),
    ];

    const joints = [makeJoint(1, 2, 3.0, 45)];

    const { adjustments } = computeAdjustments(joints, groups);
    expect(adjustments.length).toBe(0);
  });

  it("skips adjustment when floor has no thickness", () => {
    const groups: GeometryGroup[] = [
      makeGroup({ id: 1, category: "floor", representativeNormal: { x: 0, y: 1, z: 0 }, minY: 0, maxY: 0 }),
      makeGroup({ id: 2, category: "wall", representativeNormal: { x: 1, y: 0, z: 0 }, minY: 0, maxY: 3.0 }),
    ];

    const joints = [makeJoint(1, 2, 3.0, 90)];

    const { adjustments } = computeAdjustments(joints, groups);
    expect(adjustments.length).toBe(0);
  });

  it("deduplicates: keeps largest adjustment per group", () => {
    // Two adjacent floor slabs of different thickness, wall sits on top of both.
    const groups: GeometryGroup[] = [
      makeGroup({ id: 1, category: "floor", representativeNormal: { x: 0, y: 1, z: 0 }, thickness: 0.10, minY: 0, maxY: 0.10 }),
      makeGroup({ id: 3, category: "floor", representativeNormal: { x: 0, y: 1, z: 0 }, thickness: 0.15, minY: 0, maxY: 0.15 }),
      makeGroup({ id: 2, category: "wall", representativeNormal: { x: 1, y: 0, z: 0 }, minY: 0.15, maxY: 3.0 }),
    ];

    const joints = [
      makeJoint(1, 2, 3.0, 90),
      makeJoint(3, 2, 2.0, 90),
    ];

    const { adjustments } = computeAdjustments(joints, groups);
    expect(adjustments.length).toBe(1);
    expect(adjustments[0].groupId).toBe(2);
    expect(adjustments[0].delta).toBeCloseTo(-0.15, 3);
  });

  it("wall-wall joints are reported for manual resolution (no auto adjustment)", () => {
    const groups: GeometryGroup[] = [
      makeGroup({ id: 1, category: "wall", representativeNormal: { x: 1, y: 0, z: 0 }, thickness: 0.20, minY: 0, maxY: 3 }),
      makeGroup({ id: 2, category: "wall", representativeNormal: { x: 0, y: 0, z: 1 }, thickness: 0.15, minY: 0, maxY: 3 }),
    ];

    const joints = [makeJoint(1, 2, 3.0, 90)];

    const { adjustments, wallWallJoints } = computeAdjustments(joints, groups);
    expect(adjustments.length).toBe(0);
    expect(wallWallJoints.length).toBe(1);
    expect(wallWallJoints[0].groupA).toBe(1);
    expect(wallWallJoints[0].groupB).toBe(2);
    expect(wallWallJoints[0].yieldGroupId).toBeUndefined();
    // Safe default: the thinner wall (group 2, 0.15 < 0.20) yields.
    expect(wallWallJoints[0].suggestedYieldGroupId).toBe(2);
  });

  it("suggests the wall WITH a thick partner yields when only one has thickness", () => {
    const groups: GeometryGroup[] = [
      makeGroup({ id: 1, category: "wall", representativeNormal: { x: 1, y: 0, z: 0 }, thickness: 0.18, minY: 0, maxY: 3 }),
      makeGroup({ id: 2, category: "wall", representativeNormal: { x: 0, y: 0, z: 1 }, minY: 0, maxY: 3 }),
    ];

    const joints = [makeJoint(1, 2, 3.0, 90)];

    const { wallWallJoints } = computeAdjustments(joints, groups);
    // Only group 1 has a thickness → group 2 yields (shortened by group 1's 0.18).
    expect(wallWallJoints[0].suggestedYieldGroupId).toBe(2);
  });

  it("offers no suggestion when neither wall has thickness", () => {
    const groups: GeometryGroup[] = [
      makeGroup({ id: 1, category: "wall", representativeNormal: { x: 1, y: 0, z: 0 }, minY: 0, maxY: 3 }),
      makeGroup({ id: 2, category: "wall", representativeNormal: { x: 0, y: 0, z: 1 }, minY: 0, maxY: 3 }),
    ];

    const joints = [makeJoint(1, 2, 3.0, 90)];

    const { wallWallJoints } = computeAdjustments(joints, groups);
    expect(wallWallJoints[0].suggestedYieldGroupId).toBeUndefined();
  });

  it("wall-wall joint applies adjustment when user decision is provided", () => {
    const groups: GeometryGroup[] = [
      makeGroup({ id: 1, category: "wall", representativeNormal: { x: 1, y: 0, z: 0 }, thickness: 0.20, minY: 0, maxY: 3 }),
      makeGroup({ id: 2, category: "wall", representativeNormal: { x: 0, y: 0, z: 1 }, thickness: 0.15, minY: 0, maxY: 3 }),
    ];

    const joints = [makeJoint(1, 2, 3.0, 90)];
    // User decides: group 1 yields → shortened by group 2's thickness (0.15).
    const decisions = new Map([[0, 1]]);

    const { adjustments, wallWallJoints } = computeAdjustments(joints, groups, decisions);
    expect(adjustments.length).toBe(1);
    expect(adjustments[0].groupId).toBe(1);
    expect(adjustments[0].delta).toBeCloseTo(-0.15, 3);
    expect(wallWallJoints[0].yieldGroupId).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// clipPanelAtV — physically shorten a wall panel at its base
// ---------------------------------------------------------------------------

describe("clipPanelAtV", () => {
  // A 2m wide × 2.5m tall rectangular wall, base at y = 0.
  const rect = [
    { a: { x: 0, y: 0 }, b: { x: 2, y: 0 } },
    { a: { x: 2, y: 0 }, b: { x: 2, y: 2.5 } },
    { a: { x: 2, y: 2.5 }, b: { x: 0, y: 2.5 } },
    { a: { x: 0, y: 2.5 }, b: { x: 0, y: 0 } },
  ];

  it("removes a 0.10m strip from the base (keepAbove)", () => {
    const clipped = clipPanelAtV(rect, 0.1, true);
    expect(clipped).not.toBeNull();
    expect(clipped!.heightM).toBeCloseTo(2.4, 3);
    expect(clipped!.widthM).toBeCloseTo(2, 3);
    // Still a closed rectangle (4 edges).
    expect(clipped!.edges.length).toBe(4);
  });

  it("removes a strip from the top when base is at high v (keepBelow)", () => {
    const clipped = clipPanelAtV(rect, 2.5 - 0.1, false);
    expect(clipped).not.toBeNull();
    expect(clipped!.heightM).toBeCloseTo(2.4, 3);
  });

  it("re-normalises the clipped panel to origin", () => {
    const clipped = clipPanelAtV(rect, 0.1, true);
    const minY = Math.min(...clipped!.edges.flatMap((e) => [e.a.y, e.b.y]));
    expect(minY).toBeCloseTo(0, 6);
  });
});

// ---------------------------------------------------------------------------
// mirrorEdgesHorizontal — flip each piece so the laser burn ends up inside
// ---------------------------------------------------------------------------

describe("mirrorEdgesHorizontal", () => {
  // An L-shaped asymmetric outline so mirroring is observable.
  const shape = [
    { a: { x: 0, y: 0 }, b: { x: 3, y: 0 } },
    { a: { x: 3, y: 0 }, b: { x: 3, y: 1 } },
    { a: { x: 3, y: 1 }, b: { x: 1, y: 1 } },
    { a: { x: 1, y: 1 }, b: { x: 1, y: 2 } },
    { a: { x: 1, y: 2 }, b: { x: 0, y: 2 } },
    { a: { x: 0, y: 2 }, b: { x: 0, y: 0 } },
  ];
  const widthM = 3;

  it("reflects x about the width and preserves y", () => {
    const m = mirrorEdgesHorizontal(shape, widthM);
    for (let i = 0; i < shape.length; i++) {
      expect(m[i].a.x).toBeCloseTo(widthM - shape[i].a.x, 6);
      expect(m[i].b.x).toBeCloseTo(widthM - shape[i].b.x, 6);
      expect(m[i].a.y).toBeCloseTo(shape[i].a.y, 6);
      expect(m[i].b.y).toBeCloseTo(shape[i].b.y, 6);
    }
  });

  it("is its own inverse (double-mirror == original)", () => {
    const back = mirrorEdgesHorizontal(mirrorEdgesHorizontal(shape, widthM), widthM);
    for (let i = 0; i < shape.length; i++) {
      expect(back[i].a.x).toBeCloseTo(shape[i].a.x, 6);
      expect(back[i].a.y).toBeCloseTo(shape[i].a.y, 6);
      expect(back[i].b.x).toBeCloseTo(shape[i].b.x, 6);
      expect(back[i].b.y).toBeCloseTo(shape[i].b.y, 6);
    }
  });

  it("keeps the bounding box width unchanged", () => {
    const m = mirrorEdgesHorizontal(shape, widthM);
    const xs = m.flatMap((e) => [e.a.x, e.b.x]);
    expect(Math.min(...xs)).toBeCloseTo(0, 6);
    expect(Math.max(...xs)).toBeCloseTo(widthM, 6);
  });
});
