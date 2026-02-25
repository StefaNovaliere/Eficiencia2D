// ============================================================================
// Wall Extractor
//
// TypeScript port of the C++ WallExtractor logic.
// Takes Face3D[] from either parser and produces Wall[] ready for export.
//
// Algorithm:
//   1. Filter faces whose normal is perpendicular to world Z (vertical).
//   2. Filter by area > MIN_AREA_M2 (rejects trim, baseboards, noise).
//   3. Compute a local 2D coordinate system on the wall plane.
//   4. Project outer vertices (and inner loops / openings) to 2D.
//   5. Compute bounding-box dimensions for annotation.
// ============================================================================

import {
  type Face3D,
  type Loop2D,
  type Vec2,
  type Vec3,
  type Wall,
  cross,
  dot,
  normalize,
  scale as scaleVec,
  sub,
} from "./types";

/** Minimum face area in m² to qualify as a wall. */
const MIN_AREA_M2 = 1.5;

/** Maximum |normal.z| to consider a face "vertical". */
const VERTICAL_EPSILON = 0.08;

// ---------------------------------------------------------------------------
// Polygon area (3D) via the cross-product shoelace method.
// ---------------------------------------------------------------------------

function polygonArea3D(verts: Vec3[]): number {
  if (verts.length < 3) return 0;
  // Sum cross products of edges from vertex 0.
  let sx = 0, sy = 0, sz = 0;
  for (let i = 1; i < verts.length - 1; i++) {
    const e1 = sub(verts[i], verts[0]);
    const e2 = sub(verts[i + 1], verts[0]);
    const c = cross(e1, e2);
    sx += c.x; sy += c.y; sz += c.z;
  }
  return 0.5 * Math.sqrt(sx * sx + sy * sy + sz * sz);
}

// ---------------------------------------------------------------------------
// Projection helpers.
// ---------------------------------------------------------------------------

/**
 * Compute the wall's local 2D axes from its normal.
 * uAxis = horizontal along the wall, vAxis = vertical (world Z projected).
 */
function computeWallAxes(normal: Vec3): { uAxis: Vec3; vAxis: Vec3 } {
  const worldZ: Vec3 = { x: 0, y: 0, z: 1 };
  // Project world Z onto the wall plane to get the "up" direction.
  const d = dot(worldZ, normal);
  const vAxis = normalize(sub(worldZ, scaleVec(normal, d)));
  // uAxis is perpendicular to both normal and vAxis.
  const uAxis = normalize(cross(vAxis, normal));
  return { uAxis, vAxis };
}

function projectLoop(pts: Vec3[], origin: Vec3, uAxis: Vec3, vAxis: Vec3): Loop2D {
  const vertices: Vec2[] = pts.map((p) => {
    const rel = sub(p, origin);
    return { x: dot(rel, uAxis), y: dot(rel, vAxis) };
  });
  return { vertices };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function extractWalls(faces: Face3D[]): Wall[] {
  const walls: Wall[] = [];
  let counter = 0;

  for (const face of faces) {
    // 1. Verticality check.
    if (Math.abs(face.normal.z) > VERTICAL_EPSILON) continue;

    // 2. Area check.
    const area = polygonArea3D(face.vertices);
    if (area < MIN_AREA_M2) continue;

    // 3. Compute local coordinate system.
    const { uAxis, vAxis } = computeWallAxes(face.normal);
    const origin = face.vertices[0];

    // 4. Project outer loop.
    const outer = projectLoop(face.vertices, origin, uAxis, vAxis);

    // 5. Project inner loops (openings).
    const openings = face.innerLoops.map((loop) =>
      projectLoop(loop, origin, uAxis, vAxis)
    );

    // 6. Bounding box.
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    for (const v of outer.vertices) {
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
    }

    counter++;
    walls.push({
      label: `Muro_${String(counter).padStart(3, "0")}`,
      normal: face.normal,
      vertices3d: face.vertices,
      outer,
      openings,
      width: maxX - minX,
      height: maxY - minY,
    });
  }

  return walls;
}
