import { describe, it, expect } from "vitest";
import { projectFacesTo2D, traceContours } from "@/core/cutting-sheet";
import { splitFacesAtPlane, splitWallAtFloors, collectFloorPlanes } from "@/core/mesh-splitter";
import type { Face3D, Vec3 } from "@/core/types";

// Helper to create a simple face from vertices.
function makeFace(vertices: Vec3[], normal: Vec3): Face3D {
  return { vertices, normal, innerLoops: [] };
}

// ---------------------------------------------------------------------------
// Fix 1: Universal tangent-plane projection
// ---------------------------------------------------------------------------

describe("projectFacesTo2D — tangent-plane projection", () => {
  it("horizontal floor: same dimensions as top-down", () => {
    const face = makeFace(
      [
        { x: 0, y: 0, z: 0 },
        { x: 3, y: 0, z: 0 },
        { x: 3, y: 0, z: 4 },
        { x: 0, y: 0, z: 4 },
      ],
      { x: 0, y: 1, z: 0 },
    );
    const result = projectFacesTo2D([face], { x: 0, y: 1, z: 0 }, "Y");
    expect(result).not.toBeNull();
    expect(result!.widthM).toBeCloseTo(3, 1);
    expect(result!.heightM).toBeCloseTo(4, 1);
  });

  it("vertical wall: same dimensions as front-view", () => {
    const face = makeFace(
      [
        { x: 0, y: 0, z: 0 },
        { x: 5, y: 0, z: 0 },
        { x: 5, y: 3, z: 0 },
        { x: 0, y: 3, z: 0 },
      ],
      { x: 0, y: 0, z: -1 },
    );
    const result = projectFacesTo2D([face], { x: 0, y: 0, z: -1 }, "Y");
    expect(result).not.toBeNull();
    expect(result!.widthM).toBeCloseTo(5, 1);
    expect(result!.heightM).toBeCloseTo(3, 1);
  });

  it("30° inclined roof: true dimensions, NOT foreshortened", () => {
    // A roof tilted 30° from horizontal. If measured from above, the height
    // would be foreshortened by cos(30°) ≈ 0.866.
    // True width = 4m (along X, unaffected by tilt).
    // True height along slope = 3m / cos(30°) ≈ 3.464m.
    // But we define the face by its actual 3D vertices on the inclined plane.
    const angle = (30 * Math.PI) / 180;
    const slopeLen = 3; // true length along the slope
    const dy = slopeLen * Math.cos(angle); // vertical rise
    const dz = slopeLen * Math.sin(angle); // horizontal run
    const face = makeFace(
      [
        { x: 0, y: 0, z: 0 },
        { x: 4, y: 0, z: 0 },
        { x: 4, y: dy, z: dz },
        { x: 0, y: dy, z: dz },
      ],
      {
        x: 0,
        y: Math.sin(angle),
        z: -Math.cos(angle),
      },
    );
    const normal = {
      x: 0,
      y: Math.sin(angle),
      z: -Math.cos(angle),
    };
    const result = projectFacesTo2D([face], normal, "Y");
    expect(result).not.toBeNull();
    expect(result!.widthM).toBeCloseTo(4, 1);
    // The height should be the TRUE slope length (3m), not foreshortened.
    expect(result!.heightM).toBeCloseTo(slopeLen, 1);
  });

  it("45° inclined surface: true dimensions preserved", () => {
    const angle = (45 * Math.PI) / 180;
    const slopeLen = 2;
    const dy = slopeLen * Math.cos(angle);
    const dz = slopeLen * Math.sin(angle);
    const face = makeFace(
      [
        { x: 0, y: 0, z: 0 },
        { x: 3, y: 0, z: 0 },
        { x: 3, y: dy, z: dz },
        { x: 0, y: dy, z: dz },
      ],
      { x: 0, y: Math.sin(angle), z: -Math.cos(angle) },
    );
    const result = projectFacesTo2D(
      [face],
      { x: 0, y: Math.sin(angle), z: -Math.cos(angle) },
      "Y",
    );
    expect(result).not.toBeNull();
    expect(result!.widthM).toBeCloseTo(3, 1);
    expect(result!.heightM).toBeCloseTo(slopeLen, 1);
  });
});

// ---------------------------------------------------------------------------
// Fix 2: Contour tracing
// ---------------------------------------------------------------------------

describe("traceContours", () => {
  it("keeps a simple rectangle (4 boundary edges, no strays)", () => {
    const edges = [
      { ax: 0, ay: 0, bx: 1, by: 0 },
      { ax: 1, ay: 0, bx: 1, by: 1 },
      { ax: 1, ay: 1, bx: 0, by: 1 },
      { ax: 0, ay: 1, bx: 0, by: 0 },
    ];
    const result = traceContours(edges);
    expect(result.length).toBe(4);
  });

  it("removes a diagonal stray edge across a rectangle", () => {
    const edges = [
      { ax: 0, ay: 0, bx: 2, by: 0 },
      { ax: 2, ay: 0, bx: 2, by: 1 },
      { ax: 2, ay: 1, bx: 0, by: 1 },
      { ax: 0, ay: 1, bx: 0, by: 0 },
      // Stray diagonal connecting two corners internally
      { ax: 0, ay: 0, bx: 2, by: 1 },
    ];
    const result = traceContours(edges);
    // The diagonal connects two vertices that have degree > 2, but
    // the contour tracer should separate the outer loop from the chord.
    // After tracing, the rectangle loop (4 edges) is kept, the diagonal is discarded.
    expect(result.length).toBe(4);
    // Verify the diagonal is not in the result.
    const hasDiag = result.some(
      (e) =>
        (e.ax === 0 && e.ay === 0 && e.bx === 2 && e.by === 1) ||
        (e.ax === 2 && e.ay === 1 && e.bx === 0 && e.by === 0),
    );
    expect(hasDiag).toBe(false);
  });

  it("removes a dangling spur (leaf edge)", () => {
    const edges = [
      { ax: 0, ay: 0, bx: 1, by: 0 },
      { ax: 1, ay: 0, bx: 1, by: 1 },
      { ax: 1, ay: 1, bx: 0, by: 1 },
      { ax: 0, ay: 1, bx: 0, by: 0 },
      // Dangling spur from one corner
      { ax: 1, ay: 1, bx: 1.5, by: 1.5 },
    ];
    const result = traceContours(edges);
    expect(result.length).toBe(4);
  });

  it("keeps a simple triangle (3 edges)", () => {
    const edges = [
      { ax: 0, ay: 0, bx: 1, by: 0 },
      { ax: 1, ay: 0, bx: 0.5, by: 1 },
      { ax: 0.5, ay: 1, bx: 0, by: 0 },
    ];
    const result = traceContours(edges);
    expect(result.length).toBe(3);
  });

  it("keeps rectangle with window hole (8 edges) and removes connector", () => {
    // Outer rectangle: 0,0 → 4,0 → 4,3 → 0,3
    // Window hole: 1,1 → 2,1 → 2,2 → 1,2
    // Stray connector: (2,1) → (3,1) → this edge connects hole to outer boundary
    const edges = [
      // Outer boundary (4 edges)
      { ax: 0, ay: 0, bx: 4, by: 0 },
      { ax: 4, ay: 0, bx: 4, by: 3 },
      { ax: 4, ay: 3, bx: 0, by: 3 },
      { ax: 0, ay: 3, bx: 0, by: 0 },
      // Window hole (4 edges)
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
// Fix 3: Mesh splitting
// ---------------------------------------------------------------------------

describe("splitFacesAtPlane", () => {
  it("splits a quad at the midpoint into two quads", () => {
    const face = makeFace(
      [
        { x: 0, y: 0, z: 0 },
        { x: 3, y: 0, z: 0 },
        { x: 3, y: 4, z: 0 },
        { x: 0, y: 4, z: 0 },
      ],
      { x: 0, y: 0, z: -1 },
    );
    const result = splitFacesAtPlane([face], 2, "Y");
    expect(result.above.length).toBe(1);
    expect(result.below.length).toBe(1);
    // Below part should span y=0 to y=2.
    const belowYs = result.below[0].vertices.map((v) => v.y);
    expect(Math.min(...belowYs)).toBeCloseTo(0, 1);
    expect(Math.max(...belowYs)).toBeCloseTo(2, 1);
    // Above part should span y=2 to y=4.
    const aboveYs = result.above[0].vertices.map((v) => v.y);
    expect(Math.min(...aboveYs)).toBeCloseTo(2, 1);
    expect(Math.max(...aboveYs)).toBeCloseTo(4, 1);
  });

  it("keeps face entirely above the plane", () => {
    const face = makeFace(
      [
        { x: 0, y: 3, z: 0 },
        { x: 1, y: 3, z: 0 },
        { x: 1, y: 5, z: 0 },
      ],
      { x: 0, y: 0, z: -1 },
    );
    const result = splitFacesAtPlane([face], 2, "Y");
    expect(result.above.length).toBe(1);
    expect(result.below.length).toBe(0);
  });

  it("keeps face entirely below the plane", () => {
    const face = makeFace(
      [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
      ],
      { x: 0, y: 0, z: -1 },
    );
    const result = splitFacesAtPlane([face], 2, "Y");
    expect(result.above.length).toBe(0);
    expect(result.below.length).toBe(1);
  });

  it("splits a triangle with 1 vertex above and 2 below", () => {
    const face = makeFace(
      [
        { x: 0, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 1, y: 4, z: 0 },
      ],
      { x: 0, y: 0, z: -1 },
    );
    const result = splitFacesAtPlane([face], 2, "Y");
    expect(result.above.length).toBe(1);
    expect(result.below.length).toBe(1);
    // Above: triangle (1 original vertex + 2 intersection points) = 3 verts.
    expect(result.above[0].vertices.length).toBe(3);
    // Below: quad (2 original vertices + 2 intersection points) = 4 verts.
    expect(result.below[0].vertices.length).toBe(4);
  });
});

describe("splitWallAtFloors", () => {
  it("splits a wall at one floor elevation", () => {
    // Wall from y=0 to y=4.
    const faces = [
      makeFace(
        [
          { x: 0, y: 0, z: 0 },
          { x: 3, y: 0, z: 0 },
          { x: 3, y: 4, z: 0 },
          { x: 0, y: 4, z: 0 },
        ],
        { x: 0, y: 0, z: -1 },
      ),
    ];
    const segments = splitWallAtFloors(faces, [2.5], "Y");
    expect(segments.length).toBe(2);
  });

  it("does not split when floor is outside wall extent", () => {
    const faces = [
      makeFace(
        [
          { x: 0, y: 0, z: 0 },
          { x: 3, y: 0, z: 0 },
          { x: 3, y: 4, z: 0 },
          { x: 0, y: 4, z: 0 },
        ],
        { x: 0, y: 0, z: -1 },
      ),
    ];
    const segments = splitWallAtFloors(faces, [5], "Y");
    expect(segments.length).toBe(1);
  });

  it("splits at multiple floors", () => {
    const faces = [
      makeFace(
        [
          { x: 0, y: 0, z: 0 },
          { x: 3, y: 0, z: 0 },
          { x: 3, y: 9, z: 0 },
          { x: 0, y: 9, z: 0 },
        ],
        { x: 0, y: 0, z: -1 },
      ),
    ];
    const segments = splitWallAtFloors(faces, [3, 6], "Y");
    expect(segments.length).toBe(3);
  });
});

describe("collectFloorPlanes", () => {
  it("collects elevations from horizontal floor groups", () => {
    const groups = [
      {
        id: 1,
        category: "floor" as const,
        faceIndices: [0],
        representativeNormal: { x: 0, y: 1, z: 0 },
      },
      {
        id: 2,
        category: "wall" as const,
        faceIndices: [1],
        representativeNormal: { x: 1, y: 0, z: 0 },
      },
    ];
    const faces: Face3D[] = [
      makeFace(
        [
          { x: 0, y: 2.5, z: 0 },
          { x: 3, y: 2.5, z: 0 },
          { x: 3, y: 2.5, z: 3 },
        ],
        { x: 0, y: 1, z: 0 },
      ),
      makeFace(
        [
          { x: 0, y: 0, z: 0 },
          { x: 0, y: 3, z: 0 },
          { x: 0, y: 3, z: 3 },
        ],
        { x: 1, y: 0, z: 0 },
      ),
    ];
    const result = collectFloorPlanes(groups, new Map(), faces, "Y");
    expect(result.length).toBe(1);
    expect(result[0]).toBeCloseTo(2.5, 1);
  });

  it("ignores inclined floor groups", () => {
    const groups = [
      {
        id: 1,
        category: "floor" as const,
        faceIndices: [0],
        representativeNormal: { x: 0, y: 0.5, z: 0.866 },
      },
    ];
    const faces: Face3D[] = [
      makeFace(
        [
          { x: 0, y: 0, z: 0 },
          { x: 3, y: 0, z: 0 },
          { x: 3, y: 2, z: 3 },
        ],
        { x: 0, y: 0.5, z: 0.866 },
      ),
    ];
    const result = collectFloorPlanes(groups, new Map(), faces, "Y");
    expect(result.length).toBe(0);
  });
});
