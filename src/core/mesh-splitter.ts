// ============================================================================
// Mesh Splitter
//
// Clips a set of 3D faces at a horizontal plane, producing two sets of faces:
// one above and one below the plane.  Used to split walls that extend through
// floor/ceiling slabs so the cut pieces can be physically assembled.
// ============================================================================

import type { Face3D, Vec3 } from "./types";

export interface SplitResult {
  above: Face3D[];
  below: Face3D[];
}

function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

function getUpVal(v: Vec3, up: "Y" | "Z"): number {
  return up === "Y" ? v.y : v.z;
}

/**
 * Split a single face's vertices at the given elevation.
 * Uses Sutherland-Hodgman clipping against one plane.
 */
function clipPolygon(
  verts: Vec3[],
  elevation: number,
  up: "Y" | "Z",
  keepAbove: boolean,
  tolerance: number,
): Vec3[] {
  const result: Vec3[] = [];
  const n = verts.length;

  for (let i = 0; i < n; i++) {
    const current = verts[i];
    const next = verts[(i + 1) % n];
    const dCurr = getUpVal(current, up) - elevation;
    const dNext = getUpVal(next, up) - elevation;

    const currInside = keepAbove ? dCurr >= -tolerance : dCurr <= tolerance;
    const nextInside = keepAbove ? dNext >= -tolerance : dNext <= tolerance;

    if (currInside) {
      result.push(current);
    }

    // Edge crosses the plane — add intersection point.
    if ((dCurr > tolerance && dNext < -tolerance) ||
        (dCurr < -tolerance && dNext > tolerance)) {
      const t = dCurr / (dCurr - dNext);
      result.push(lerp3(current, next, t));
    }
  }

  return result;
}

/**
 * Split a set of faces at a horizontal plane.
 */
export function splitFacesAtPlane(
  faces: Face3D[],
  elevation: number,
  up: "Y" | "Z" = "Y",
  tolerance: number = 0.01,
): SplitResult {
  const above: Face3D[] = [];
  const below: Face3D[] = [];

  for (const face of faces) {
    const dists = face.vertices.map((v) => getUpVal(v, up) - elevation);
    const allAbove = dists.every((d) => d >= -tolerance);
    const allBelow = dists.every((d) => d <= tolerance);

    if (allAbove && !allBelow) {
      above.push(face);
    } else if (allBelow && !allAbove) {
      below.push(face);
    } else if (allAbove && allBelow) {
      // Face lies entirely on the plane — include in both.
      above.push(face);
      below.push(face);
    } else {
      // Face straddles the plane — clip it.
      const aboveVerts = clipPolygon(face.vertices, elevation, up, true, tolerance);
      const belowVerts = clipPolygon(face.vertices, elevation, up, false, tolerance);

      if (aboveVerts.length >= 3) {
        const { vertices: _va, innerLoops: _ia, ...rest } = face;
        above.push({ ...rest, vertices: aboveVerts, innerLoops: [] } as Face3D);
      }
      if (belowVerts.length >= 3) {
        const { vertices: _vb, innerLoops: _ib, ...rest } = face;
        below.push({ ...rest, vertices: belowVerts, innerLoops: [] } as Face3D);
      }
    }
  }

  return { above, below };
}

/**
 * Split wall faces at multiple floor elevations.
 * Returns an array of face groups — one per segment between consecutive splits.
 */
export function splitWallAtFloors(
  faces: Face3D[],
  floorElevations: number[],
  up: "Y" | "Z" = "Y",
  tolerance: number = 0.01,
): Face3D[][] {
  if (floorElevations.length === 0) return [faces];

  // Find the wall's vertical extent.
  let wallMin = Infinity, wallMax = -Infinity;
  for (const f of faces) {
    for (const v of f.vertices) {
      const h = getUpVal(v, up);
      if (h < wallMin) wallMin = h;
      if (h > wallMax) wallMax = h;
    }
  }

  // Filter to elevations that actually intersect this wall's extent.
  const relevant = floorElevations.filter(
    (e) => e > wallMin + tolerance && e < wallMax - tolerance,
  );

  if (relevant.length === 0) return [faces];

  // Sort and split sequentially from bottom to top.
  const sorted = [...relevant].sort((a, b) => a - b);
  const segments: Face3D[][] = [];
  let remaining = faces;

  for (const elev of sorted) {
    const { above, below } = splitFacesAtPlane(remaining, elev, up, tolerance);
    if (below.length > 0) segments.push(below);
    remaining = above;
  }

  if (remaining.length > 0) segments.push(remaining);

  return segments;
}

/**
 * Collect horizontal floor/ceiling elevations from classified groups.
 */
export function collectFloorPlanes(
  groups: Array<{
    id: number;
    category: string;
    faceIndices: number[];
    representativeNormal: Vec3;
  }>,
  overrideMap: Map<number, string>,
  faces: Face3D[],
  up: "Y" | "Z" = "Y",
): number[] {
  const elevations: number[] = [];
  const DEDUP_TOL = 0.10; // 10cm — don't split at two floors that are very close

  for (const group of groups) {
    const effectiveCat = overrideMap.get(group.id) ?? group.category;
    if (effectiveCat !== "floor") continue;

    // Only consider truly horizontal groups (not inclined roofs).
    const ny = Math.abs(getUpVal(group.representativeNormal, up));
    if (ny < 0.75) continue;

    // Average elevation of the group's vertices.
    let sum = 0, count = 0;
    for (const fi of group.faceIndices) {
      const face = faces[fi];
      if (!face) continue;
      for (const v of face.vertices) {
        sum += getUpVal(v, up);
        count++;
      }
    }
    if (count === 0) continue;
    const avg = sum / count;

    // Deduplicate: skip if too close to an existing elevation.
    const isDup = elevations.some((e) => Math.abs(e - avg) < DEDUP_TOL);
    if (!isDup) elevations.push(avg);
  }

  return elevations.sort((a, b) => a - b);
}
