// ============================================================================
// Mesh Splitter
//
// Clips a set of 3D faces at a horizontal plane, producing two sets of faces:
// one above and one below the plane.  Used to split walls that extend through
// floor/ceiling slabs so the cut pieces can be physically assembled.
// ============================================================================

import type { Face3D, Vec3 } from "./types";
import type { GeometryGroup } from "./group-classifier";

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

// ---------------------------------------------------------------------------
// Compute metadata for a sub-group created from split faces.
// ---------------------------------------------------------------------------

function subgroupArea(faces: Face3D[]): number {
  let total = 0;
  for (const f of faces) {
    const verts = f.vertices;
    if (verts.length < 3) continue;
    let sx = 0, sy = 0, sz = 0;
    const v0 = verts[0];
    for (let i = 1; i < verts.length - 1; i++) {
      const e1x = verts[i].x - v0.x, e1y = verts[i].y - v0.y, e1z = verts[i].z - v0.z;
      const e2x = verts[i + 1].x - v0.x, e2y = verts[i + 1].y - v0.y, e2z = verts[i + 1].z - v0.z;
      sx += e1y * e2z - e1z * e2y;
      sy += e1z * e2x - e1x * e2z;
      sz += e1x * e2y - e1y * e2x;
    }
    total += 0.5 * Math.sqrt(sx * sx + sy * sy + sz * sz);
  }
  return total;
}

function subgroupBounds(faces: Face3D[], up: "Y" | "Z"): { minY: number; maxY: number; cx: number; cy: number; cz: number; count: number } {
  let minY = Infinity, maxY = -Infinity;
  let cx = 0, cy = 0, cz = 0, count = 0;
  for (const f of faces) {
    for (const v of f.vertices) {
      const h = getUpVal(v, up);
      if (h < minY) minY = h;
      if (h > maxY) maxY = h;
      cx += v.x; cy += v.y; cz += v.z;
      count++;
    }
  }
  return { minY, maxY, cx, cy, cz, count };
}

// ---------------------------------------------------------------------------
// Split wall GeometryGroups that extend through floor slabs.
// ---------------------------------------------------------------------------

const MIN_SPLIT_AREA = 0.01; // m² — discard tiny fragments

export function splitWallGroupsAtFloors(
  faces: Face3D[],
  groups: GeometryGroup[],
  overrideMap: Map<number, string>,
  up: "Y" | "Z" = "Y",
): { faces: Face3D[]; groups: GeometryGroup[] } {
  const floorElevations = collectFloorPlanes(groups, overrideMap, faces, up);
  if (floorElevations.length === 0) return { faces, groups };

  const newFaces = [...faces];
  const newGroups: GeometryGroup[] = [];
  let nextId = 0;
  for (const g of groups) if (g.id >= nextId) nextId = g.id + 1;

  for (const group of groups) {
    const effectiveCat = overrideMap.get(group.id) ?? group.category;
    if (effectiveCat !== "wall") {
      newGroups.push(group);
      continue;
    }

    const groupFaces = group.faceIndices.map((fi) => faces[fi]).filter(Boolean);
    const segments = splitWallAtFloors(groupFaces, floorElevations, up);

    if (segments.length <= 1) {
      newGroups.push(group);
      continue;
    }

    for (let k = 0; k < segments.length; k++) {
      const seg = segments[k];
      if (seg.length === 0) continue;

      const area = subgroupArea(seg);
      if (area < MIN_SPLIT_AREA) continue;

      const faceIndices: number[] = [];
      for (const face of seg) {
        faceIndices.push(newFaces.length);
        newFaces.push(face);
      }

      const b = subgroupBounds(seg, up);
      const centroid = b.count > 0
        ? { x: b.cx / b.count, y: b.cy / b.count, z: b.cz / b.count }
        : group.centroid;

      newGroups.push({
        id: k === 0 ? group.id : nextId++,
        label: `${group.label} (${k + 1}/${segments.length})`,
        category: group.category,
        faceIndices,
        totalArea: area,
        centroid,
        orientation: group.orientation,
        representativeNormal: group.representativeNormal,
        thickness: group.thickness,
        minY: b.minY === Infinity ? undefined : b.minY,
        maxY: b.maxY === -Infinity ? undefined : b.maxY,
      });
    }
  }

  return { faces: newFaces, groups: newGroups };
}
