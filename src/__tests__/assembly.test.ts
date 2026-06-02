import { describe, it, expect } from "vitest";
import { areThinTwins } from "@/core/wall-thickness";
import type { TwinCandidate } from "@/core/wall-thickness";
import { detectJoints } from "@/core/joint-detector";
import { computeAdjustments } from "@/core/assembly-adjuster";
import { clipPanelAtV, clipPanelAtU, mirrorEdgesHorizontal } from "@/core/cutting-sheet";
import type { GeometryGroup, FaceCategory } from "@/core/group-classifier";
import type { Face3D, Vec3 } from "@/core/types";
import { splitWallGroupsAtFloors } from "@/core/mesh-splitter";

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

// ---------------------------------------------------------------------------
// clipPanelAtU — vertical clip for wall-wall assembly compensation
// ---------------------------------------------------------------------------

describe("clipPanelAtU", () => {
  const rect = [
    { a: { x: 0, y: 0 }, b: { x: 4, y: 0 } },
    { a: { x: 4, y: 0 }, b: { x: 4, y: 2.5 } },
    { a: { x: 4, y: 2.5 }, b: { x: 0, y: 2.5 } },
    { a: { x: 0, y: 2.5 }, b: { x: 0, y: 0 } },
  ];

  it("clips from the left (keepRight) and shortens width", () => {
    const clipped = clipPanelAtU(rect, 0.1, true);
    expect(clipped).not.toBeNull();
    expect(clipped!.widthM).toBeCloseTo(3.9, 3);
    expect(clipped!.heightM).toBeCloseTo(2.5, 3);
  });

  it("clips from the right (keepLeft) and shortens width", () => {
    const clipped = clipPanelAtU(rect, 4 - 0.1, false);
    expect(clipped).not.toBeNull();
    expect(clipped!.widthM).toBeCloseTo(3.9, 3);
    expect(clipped!.heightM).toBeCloseTo(2.5, 3);
  });

  it("re-normalises the clipped panel to origin", () => {
    const clipped = clipPanelAtU(rect, 0.5, true);
    const minX = Math.min(...clipped!.edges.flatMap((e) => [e.a.x, e.b.x]));
    expect(minX).toBeCloseTo(0, 6);
  });

  it("preserves height when clipping width", () => {
    const clipped = clipPanelAtU(rect, 1.0, true);
    expect(clipped).not.toBeNull();
    expect(clipped!.widthM).toBeCloseTo(3.0, 3);
    expect(clipped!.heightM).toBeCloseTo(2.5, 3);
  });
});

// ---------------------------------------------------------------------------
// DimensionAdjustment.axis — wall-floor uses "height", wall-wall uses "width"
// ---------------------------------------------------------------------------

describe("computeAdjustments axis field", () => {
  it("wall-floor adjustment has axis 'height'", () => {
    const groups = [
      makeGroup({ id: 1, category: "floor", representativeNormal: { x: 0, y: 1, z: 0 }, thickness: 0.05, minY: 0, maxY: 0.05 }),
      makeGroup({ id: 2, category: "wall", representativeNormal: { x: 1, y: 0, z: 0 }, minY: 0.05, maxY: 3.0 }),
    ];
    const joints = [makeJoint(1, 2, 4.0, 90, 1.0)];
    const { adjustments } = computeAdjustments(joints, groups);
    expect(adjustments.length).toBe(1);
    expect(adjustments[0].axis).toBe("height");
    expect(adjustments[0].groupId).toBe(2);
  });

  it("wall-wall adjustment has axis 'width'", () => {
    const groups = [
      makeGroup({ id: 1, category: "wall", representativeNormal: { x: 1, y: 0, z: 0 }, thickness: 0.10 }),
      makeGroup({ id: 2, category: "wall", representativeNormal: { x: 0, y: 0, z: 1 }, thickness: 0.05 }),
    ];
    const joints = [makeJoint(1, 2, 3.0, 90, 0.0)];
    const decisions = new Map<number, number>();
    decisions.set(0, 2);
    const { adjustments } = computeAdjustments(joints, groups, decisions);
    expect(adjustments.length).toBe(1);
    expect(adjustments[0].axis).toBe("width");
    expect(adjustments[0].groupId).toBe(2);
    expect(adjustments[0].delta).toBeCloseTo(-0.10, 6);
  });
});

// ---------------------------------------------------------------------------
// End-to-end: decomposePanels width clip
// ---------------------------------------------------------------------------
import { decomposePanels, computePanelIdByGroup, suggestCoplanarMerges, applyMerges, areGroupsCoplanar } from "@/core/pipeline";
import type { Phase1Result } from "@/core/pipeline";

describe("decomposePanels wall-wall width clip", () => {
  it("reduces the yielding wall's width by the other wall's thickness", () => {
    // Wall A: 4m wide × 3m tall, normal along +X, thickness 0.1m
    // Two quad faces (front/back) forming a thin slab from x=0..0.1, y=0..3, z=0..4
    const wallAFront = makeFace(
      [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 4 }, { x: 0, y: 3, z: 4 }, { x: 0, y: 3, z: 0 }],
      { x: -1, y: 0, z: 0 },
    );
    const wallABack = makeFace(
      [{ x: 0.1, y: 0, z: 0 }, { x: 0.1, y: 3, z: 0 }, { x: 0.1, y: 3, z: 4 }, { x: 0.1, y: 0, z: 4 }],
      { x: 1, y: 0, z: 0 },
    );

    // Wall B: 5m wide × 3m tall, normal along +Z, thickness 0.1m
    // From x=0..5, y=0..3, z=0..0.1
    const wallBFront = makeFace(
      [{ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, { x: 5, y: 3, z: 0 }, { x: 0, y: 3, z: 0 }],
      { x: 0, y: 0, z: -1 },
    );
    const wallBBack = makeFace(
      [{ x: 0, y: 0, z: 0.1 }, { x: 0, y: 3, z: 0.1 }, { x: 5, y: 3, z: 0.1 }, { x: 5, y: 0, z: 0.1 }],
      { x: 0, y: 0, z: 1 },
    );

    const faces: Face3D[] = [wallAFront, wallABack, wallBFront, wallBBack];

    const groupA = makeGroup({
      id: 1,
      category: "wall",
      representativeNormal: { x: 1, y: 0, z: 0 },
      thickness: 0.1,
      faceIndices: [0, 1],
    });
    const groupB = makeGroup({
      id: 2,
      category: "wall",
      representativeNormal: { x: 0, y: 0, z: 1 },
      thickness: 0.1,
      faceIndices: [2, 3],
    });

    // Shared edge along y-axis at (x=0, z=0): wall A's z=0 edge meets wall B's x=0 edge
    const joints = [
      {
        groupA: 1,
        groupB: 2,
        totalLength: 3.0,
        dihedralAngle: 90,
        edgeMid: { x: 0, y: 1.5, z: 0 },
        edgeDir: { x: 0, y: 1, z: 0 },
        horizontalFrac: 0,
      },
    ];

    const { adjustments, wallWallJoints } = computeAdjustments(joints, [groupA, groupB]);
    expect(wallWallJoints.length).toBe(1);
    expect(wallWallJoints[0].suggestedYieldGroupId).toBeDefined();

    const phase1: Phase1Result = {
      faces,
      rawFaces: faces,
      appliedAxis: "Y",
      groups: [groupA, groupB],
      joints,
      adjustments,
      wallWallJoints,
      stem: "test",
      warnings: [],
      preSplitFaceCount: faces.length,
      suggestedMerges: [],
    };

    // Tell wall B (group 2) to yield — it should be trimmed by 0.1m (wall A's thickness)
    const decisions = new Map<number, number>();
    decisions.set(0, 2); // joint 0: group 2 yields

    const result = decomposePanels(phase1, { scaleDenom: 50, paper: "A4", minAreaM2: 0.01 }, [], decisions);

    // Wall B was 5m wide, after yielding should be ≈4.9m
    const wallB = result.wallPanels.find(p => p.groupName.includes("wall"));
    console.log("Wall panels:", result.wallPanels.map(p => `${p.id} ${p.widthM}x${p.heightM}`));

    // Find the panel that was originally ~5m wide (wall B)
    const widePanel = result.wallPanels.find(p => p.widthM > 4);
    expect(widePanel).toBeDefined();
    // It should be 4.9, not 5.0
    expect(widePanel!.widthM).toBeCloseTo(4.9, 1);
  });
});

describe("computePanelIdByGroup", () => {
  it("matches the DXF A# numbering, skipping groups decomposePanels drops", () => {
    // Three walls in array order: big, TINY (below minArea), big.
    // decomposePanels emits A1 (big), skips the tiny one, A2 (big).
    // The UI label map must agree: {big1:A1, big2:A2}, tiny absent — NOT A1/A2/A3.
    const big1 = makeFace(
      [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 4 }, { x: 0, y: 3, z: 4 }, { x: 0, y: 3, z: 0 }],
      { x: 1, y: 0, z: 0 },
    );
    const tiny = makeFace(
      [{ x: 10, y: 0, z: 0 }, { x: 10, y: 0, z: 0.05 }, { x: 10, y: 0.05, z: 0.05 }, { x: 10, y: 0.05, z: 0 }],
      { x: 1, y: 0, z: 0 },
    );
    const big2 = makeFace(
      [{ x: 20, y: 0, z: 0 }, { x: 20, y: 0, z: 5 }, { x: 20, y: 3, z: 5 }, { x: 20, y: 3, z: 0 }],
      { x: 1, y: 0, z: 0 },
    );
    const faces: Face3D[] = [big1, tiny, big2];

    const groups = [
      makeGroup({ id: 10, category: "wall", representativeNormal: { x: 1, y: 0, z: 0 }, faceIndices: [0] }),
      makeGroup({ id: 20, category: "wall", representativeNormal: { x: 1, y: 0, z: 0 }, faceIndices: [1] }),
      makeGroup({ id: 30, category: "wall", representativeNormal: { x: 1, y: 0, z: 0 }, faceIndices: [2] }),
    ];

    const phase1: Phase1Result = {
      faces, rawFaces: faces, appliedAxis: "Y", groups,
      joints: [], adjustments: [], wallWallJoints: [], stem: "test", warnings: [],
      preSplitFaceCount: faces.length,
      suggestedMerges: [],
    };

    const opts = { scaleDenom: 50, paper: "A4", minAreaM2: 0.01 };
    const result = decomposePanels(phase1, opts);
    const idMap = computePanelIdByGroup(phase1, opts);

    // The tiny wall (0.05×0.05 = 0.0025 m² < 0.01) is dropped from the DXF.
    expect(result.wallPanels.map(p => p.id)).toEqual(["A1", "A2"]);
    expect(idMap.get(10)).toBe("A1");
    expect(idMap.get(30)).toBe("A2");
    expect(idMap.has(20)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Thickness fallback: both yield directions produce adjustments
// ---------------------------------------------------------------------------

describe("thickness fallback for wall-wall adjustments", () => {
  it("produces adjustment when only one wall has thickness", () => {
    // groupA has thickness, groupB does not.
    const groupA = makeGroup({
      id: 1, category: "wall",
      representativeNormal: { x: 0, y: 0, z: 1 },
      thickness: 0.06,
    });
    const groupB = makeGroup({
      id: 2, category: "wall",
      representativeNormal: { x: 1, y: 0, z: 0 },
      thickness: undefined,
    });

    const joint = makeJoint(1, 2, 1.0, 90, 0.9);

    // Direction 1: groupB yields → delta should be -groupA.thickness
    const r1 = computeAdjustments([joint], [groupA, groupB], new Map([[0, 2]]));
    const adj1 = r1.adjustments.filter(a => a.axis === "width");
    expect(adj1).toHaveLength(1);
    expect(adj1[0].groupId).toBe(2);
    expect(adj1[0].delta).toBeCloseTo(-0.06);

    // Direction 2: groupA yields → falls back to groupA.thickness (own)
    const r2 = computeAdjustments([joint], [groupA, groupB], new Map([[0, 1]]));
    const adj2 = r2.adjustments.filter(a => a.axis === "width");
    expect(adj2).toHaveLength(1);
    expect(adj2[0].groupId).toBe(1);
    expect(adj2[0].delta).toBeCloseTo(-0.06);
  });
});

// ---------------------------------------------------------------------------
// Dedup: multiple width adjustments from different joints survive
// ---------------------------------------------------------------------------

describe("width adjustment dedup", () => {
  it("preserves width adjustments from different joints", () => {
    // A wall at a corner: meets wall B on joint 0, wall C on joint 1.
    const groupA = makeGroup({ id: 1, category: "wall", representativeNormal: { x: 0, y: 0, z: 1 }, thickness: 0.06 });
    const groupB = makeGroup({ id: 2, category: "wall", representativeNormal: { x: 1, y: 0, z: 0 }, thickness: 0.08 });
    const groupC = makeGroup({ id: 3, category: "wall", representativeNormal: { x: -1, y: 0, z: 0 }, thickness: 0.10 });

    const joint0 = makeJoint(1, 2, 1.0, 90, 0.9);
    const joint1 = makeJoint(1, 3, 1.0, 90, 0.9);

    // groupA yields at both joints
    const decisions = new Map([[0, 1], [1, 1]]);
    const r = computeAdjustments([joint0, joint1], [groupA, groupB, groupC], decisions);
    const widthAdjs = r.adjustments.filter(a => a.axis === "width" && a.groupId === 1);

    expect(widthAdjs).toHaveLength(2);
    expect(widthAdjs.map(a => a.delta).sort((a, b) => a - b)).toEqual([-0.10, -0.08]);
  });
});

// ---------------------------------------------------------------------------
// splitWallGroupsAtFloors
// ---------------------------------------------------------------------------

describe("splitWallGroupsAtFloors", () => {
  function makeWallFace(y0: number, y1: number): Face3D {
    return makeFace([
      { x: 0, y: y0, z: 0 },
      { x: 1, y: y0, z: 0 },
      { x: 1, y: y1, z: 0 },
      { x: 0, y: y1, z: 0 },
    ], { x: 0, y: 0, z: 1 });
  }

  function makeFloorFace(y: number): Face3D {
    return makeFace([
      { x: 0, y, z: 0 },
      { x: 1, y, z: 0 },
      { x: 1, y, z: 1 },
      { x: 0, y, z: 1 },
    ], { x: 0, y: 1, z: 0 });
  }

  it("splits a wall that spans a floor into two sub-groups", () => {
    const wallFace = makeWallFace(0, 5);
    const floorFace = makeFloorFace(2.5);
    const faces: Face3D[] = [wallFace, floorFace];

    const wallGroup = makeGroup({
      id: 10, category: "wall",
      representativeNormal: { x: 0, y: 0, z: 1 },
      faceIndices: [0],
      minY: 0, maxY: 5,
      thickness: 0.06,
    });
    const floorGroup = makeGroup({
      id: 20, category: "floor",
      representativeNormal: { x: 0, y: 1, z: 0 },
      faceIndices: [1],
      minY: 2.5, maxY: 2.5,
    });

    const result = splitWallGroupsAtFloors(faces, [wallGroup, floorGroup], new Map(), "Y");

    // Floor stays unchanged; wall is split into 2.
    const walls = result.groups.filter(g => g.category === "wall");
    const floors = result.groups.filter(g => g.category === "floor");
    expect(floors).toHaveLength(1);
    expect(walls).toHaveLength(2);

    // First sub-group keeps the parent ID.
    expect(walls[0].id).toBe(10);
    // Second gets a new ID.
    expect(walls[1].id).not.toBe(10);

    // Bounds are split at the floor elevation.
    expect(walls[0].maxY!).toBeLessThanOrEqual(2.6);
    expect(walls[1].minY!).toBeGreaterThanOrEqual(2.4);

    // Both inherit thickness.
    expect(walls[0].thickness).toBe(0.06);
    expect(walls[1].thickness).toBe(0.06);

    // Face indices point to new appended faces.
    expect(walls[0].faceIndices[0]).toBeGreaterThanOrEqual(faces.length);
    expect(walls[1].faceIndices[0]).toBeGreaterThanOrEqual(faces.length);
  });

  it("leaves wall unchanged when no floor intersects it", () => {
    const wallFace = makeWallFace(0, 2);
    const floorFace = makeFloorFace(5);
    const faces: Face3D[] = [wallFace, floorFace];

    const wallGroup = makeGroup({
      id: 10, category: "wall",
      representativeNormal: { x: 0, y: 0, z: 1 },
      faceIndices: [0],
      minY: 0, maxY: 2,
    });
    const floorGroup = makeGroup({
      id: 20, category: "floor",
      representativeNormal: { x: 0, y: 1, z: 0 },
      faceIndices: [1],
    });

    const result = splitWallGroupsAtFloors(faces, [wallGroup, floorGroup], new Map(), "Y");

    const walls = result.groups.filter(g => g.category === "wall");
    expect(walls).toHaveLength(1);
    expect(walls[0].id).toBe(10);
    expect(result.faces.length).toBe(faces.length);
  });

  it("does NOT split a wall at a DISCARDED horizontal slab (only floors split)", () => {
    // A horizontal piece classified as "discard" must NOT cut the wall — only
    // an actual floor (green) component does.
    const wallFace = makeWallFace(0, 5);
    const slabFace = makeFloorFace(2.5);
    const faces: Face3D[] = [wallFace, slabFace];

    const wallGroup = makeGroup({
      id: 10, category: "wall",
      representativeNormal: { x: 0, y: 0, z: 1 },
      faceIndices: [0],
      minY: 0, maxY: 5,
    });
    const slabGroup = makeGroup({
      id: 20, category: "discard",
      representativeNormal: { x: 0, y: 1, z: 0 },
      faceIndices: [1],
      minY: 2.5, maxY: 2.5,
    });

    const result = splitWallGroupsAtFloors(faces, [wallGroup, slabGroup], new Map(), "Y");
    const walls = result.groups.filter(g => g.category === "wall");
    expect(walls).toHaveLength(1);
    expect(walls[0].id).toBe(10);
  });

  it("does NOT split a wall at a slab whose footprint is elsewhere", () => {
    // Slab is at a mid elevation but sits far away in plan (z = 50..51), so it
    // does not cross this wall and must not split it.
    const wallFace = makeWallFace(0, 5);
    const farSlab = makeFace([
      { x: 0, y: 2.5, z: 50 },
      { x: 1, y: 2.5, z: 50 },
      { x: 1, y: 2.5, z: 51 },
      { x: 0, y: 2.5, z: 51 },
    ], { x: 0, y: 1, z: 0 });
    const faces: Face3D[] = [wallFace, farSlab];

    const wallGroup = makeGroup({
      id: 10, category: "wall",
      representativeNormal: { x: 0, y: 0, z: 1 },
      faceIndices: [0],
      minY: 0, maxY: 5,
    });
    const slabGroup = makeGroup({
      id: 20, category: "floor",
      representativeNormal: { x: 0, y: 1, z: 0 },
      faceIndices: [1],
      minY: 2.5, maxY: 2.5,
    });

    const result = splitWallGroupsAtFloors(faces, [wallGroup, slabGroup], new Map(), "Y");
    const walls = result.groups.filter(g => g.category === "wall");
    expect(walls).toHaveLength(1);
    expect(walls[0].id).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// suggestCoplanarMerges
// ---------------------------------------------------------------------------

describe("suggestCoplanarMerges", () => {
  it("suggests merging a tiny coplanar wall into its large neighbor", () => {
    const big = makeGroup({
      id: 1, category: "wall",
      representativeNormal: { x: 1, y: 0, z: 0 },
      totalArea: 10.0,
    });
    const tiny = makeGroup({
      id: 2, category: "wall",
      representativeNormal: { x: 1, y: 0, z: 0 },
      totalArea: 0.5,
    });
    const joints = [makeJoint(1, 2, 1.0, 0)];

    const result = suggestCoplanarMerges([big, tiny], joints);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain(1);
    expect(result[0]).toContain(2);
  });

  it("does NOT merge two same-size walls", () => {
    const a = makeGroup({
      id: 1, category: "wall",
      representativeNormal: { x: 1, y: 0, z: 0 },
      totalArea: 5.0,
    });
    const b = makeGroup({
      id: 2, category: "wall",
      representativeNormal: { x: 1, y: 0, z: 0 },
      totalArea: 5.0,
    });
    const joints = [makeJoint(1, 2, 1.0, 0)];

    const result = suggestCoplanarMerges([a, b], joints);
    expect(result).toHaveLength(0);
  });

  it("does NOT merge walls with large dihedral angle", () => {
    const big = makeGroup({
      id: 1, category: "wall",
      representativeNormal: { x: 1, y: 0, z: 0 },
      totalArea: 10.0,
    });
    const tiny = makeGroup({
      id: 2, category: "wall",
      representativeNormal: { x: 0, y: 0, z: 1 },
      totalArea: 0.5,
    });
    const joints = [makeJoint(1, 2, 1.0, 90)];

    const result = suggestCoplanarMerges([big, tiny], joints);
    expect(result).toHaveLength(0);
  });

  it("does NOT merge coplanar walls separated by a floor slab", () => {
    const upper = makeGroup({
      id: 1, category: "wall",
      representativeNormal: { x: 1, y: 0, z: 0 },
      totalArea: 10.0, minY: 3.0, maxY: 6.0,
    });
    const lower = makeGroup({
      id: 2, category: "wall",
      representativeNormal: { x: 1, y: 0, z: 0 },
      totalArea: 0.5, minY: 0.0, maxY: 3.0,
    });
    const floor = makeGroup({
      id: 3, category: "floor",
      representativeNormal: { x: 0, y: 1, z: 0 },
      totalArea: 20.0, minY: 2.9, maxY: 3.1,
    });
    const joints = [makeJoint(1, 2, 1.0, 0)];

    const result = suggestCoplanarMerges([upper, lower, floor], joints);
    expect(result).toHaveLength(0);
  });

  it("DOES merge coplanar walls at the same height level (no floor between)", () => {
    const big = makeGroup({
      id: 1, category: "wall",
      representativeNormal: { x: 1, y: 0, z: 0 },
      totalArea: 10.0, minY: 0.0, maxY: 3.0,
    });
    const tiny = makeGroup({
      id: 2, category: "wall",
      representativeNormal: { x: 1, y: 0, z: 0 },
      totalArea: 0.5, minY: 0.0, maxY: 3.0,
    });
    const floor = makeGroup({
      id: 3, category: "floor",
      representativeNormal: { x: 0, y: 1, z: 0 },
      totalArea: 20.0, minY: -0.1, maxY: 0.1,
    });
    const joints = [makeJoint(1, 2, 1.0, 0)];

    const result = suggestCoplanarMerges([big, tiny, floor], joints);
    expect(result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// areGroupsCoplanar
// ---------------------------------------------------------------------------

describe("areGroupsCoplanar", () => {
  it("returns true for parallel walls with close plane offsets", () => {
    const a = makeGroup({
      id: 1, category: "wall",
      representativeNormal: { x: 1, y: 0, z: 0 },
      centroid: { x: 5, y: 0, z: 0 },
    });
    const b = makeGroup({
      id: 2, category: "wall",
      representativeNormal: { x: 1, y: 0, z: 0 },
      centroid: { x: 5.05, y: 1, z: 0 },
    });
    expect(areGroupsCoplanar([a, b])).toBe(true);
  });

  it("returns false for perpendicular walls", () => {
    const a = makeGroup({
      id: 1, category: "wall",
      representativeNormal: { x: 1, y: 0, z: 0 },
      centroid: { x: 5, y: 0, z: 0 },
    });
    const b = makeGroup({
      id: 2, category: "wall",
      representativeNormal: { x: 0, y: 0, z: 1 },
      centroid: { x: 5, y: 0, z: 0 },
    });
    expect(areGroupsCoplanar([a, b])).toBe(false);
  });

  it("returns false for parallel walls with distant plane offsets", () => {
    const a = makeGroup({
      id: 1, category: "wall",
      representativeNormal: { x: 1, y: 0, z: 0 },
      centroid: { x: 1, y: 0, z: 0 },
    });
    const b = makeGroup({
      id: 2, category: "wall",
      representativeNormal: { x: 1, y: 0, z: 0 },
      centroid: { x: 3, y: 0, z: 0 },
    });
    expect(areGroupsCoplanar([a, b])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// applyMerges
// ---------------------------------------------------------------------------

describe("applyMerges", () => {
  it("merges three groups into one survivor with combined faceIndices", () => {
    const f1 = makeFace(
      [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }],
      { x: 0, y: 0, z: 1 },
    );
    const f2 = makeFace(
      [{ x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 2, y: 0.1, z: 0 }, { x: 1, y: 0.1, z: 0 }],
      { x: 0, y: 0, z: 1 },
    );
    const f3 = makeFace(
      [{ x: 2, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 4, y: 1, z: 0 }, { x: 2, y: 1, z: 0 }],
      { x: 0, y: 0, z: 1 },
    );
    const faces = [f1, f2, f3];

    const g1 = makeGroup({ id: 10, category: "wall", representativeNormal: { x: 0, y: 0, z: 1 }, faceIndices: [0], totalArea: 1.0 });
    const g2 = makeGroup({ id: 20, category: "wall", representativeNormal: { x: 0, y: 0, z: 1 }, faceIndices: [1], totalArea: 0.1 });
    const g3 = makeGroup({ id: 30, category: "wall", representativeNormal: { x: 0, y: 0, z: 1 }, faceIndices: [2], totalArea: 2.0 });

    const phase1: Phase1Result = {
      faces, rawFaces: faces, appliedAxis: "Y",
      groups: [g1, g2, g3],
      joints: [], adjustments: [], wallWallJoints: [],
      stem: "test", warnings: [],
      preSplitFaceCount: faces.length,
      suggestedMerges: [],
    };

    const merged = applyMerges(phase1, [[10, 20, 30]]);

    // Survivor is group 30 (largest area).
    expect(merged.groups).toHaveLength(1);
    expect(merged.groups[0].id).toBe(30);
    expect(merged.groups[0].faceIndices).toHaveLength(3);
    expect(merged.groups[0].totalArea).toBeCloseTo(3.1);
  });

  it("returns unchanged phase1 when merges is empty", () => {
    const phase1: Phase1Result = {
      faces: [], rawFaces: [], appliedAxis: "Y",
      groups: [], joints: [], adjustments: [], wallWallJoints: [],
      stem: "test", warnings: [],
      preSplitFaceCount: 0,
      suggestedMerges: [],
    };

    const result = applyMerges(phase1, []);
    expect(result).toBe(phase1);
  });
});
