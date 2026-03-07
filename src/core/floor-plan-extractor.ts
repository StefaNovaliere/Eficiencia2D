// ============================================================================
// Floor Plan Extractor — Horizontal section cuts.
//
// For each detected floor level, cuts the building with a horizontal plane
// at ~1 m above the slab, producing a 2D plan view showing interior and
// exterior wall layout.
//
// Interior walls (red): segments with a parallel partner nearby.
// Exterior walls (black): segments without a parallel partner.
// ============================================================================

import type { Face3D, FloorPlan, FloorPlanSegment, Vec2, Vec3 } from "./types";
import { cross, vlength, sub } from "./types";

const MIN_SLAB_AREA = 2.0;
const MIN_FLOOR_GAP = 2.0;
const CUT_HEIGHT = 1.0;
const HORIZONTAL_EPSILON = 0.15;
const VERTICAL_EPSILON = 0.20;
const WALL_THICKNESS_MAX = 0.40; // m — max distance between parallel segments to count as same wall

type UpAxis = "Y" | "Z";

function getUp(v: Vec3, up: UpAxis): number {
  return up === "Y" ? v.y : v.z;
}

function projectTopDown(v: Vec3, up: UpAxis): Vec2 {
  return up === "Y" ? { x: v.x, y: v.z } : { x: v.x, y: v.y };
}

function faceArea(face: Face3D): number {
  const verts = face.vertices;
  if (verts.length < 3) return 0;
  let sx = 0, sy = 0, sz = 0;
  for (let i = 1; i < verts.length - 1; i++) {
    const e1 = sub(verts[i], verts[0]);
    const e2 = sub(verts[i + 1], verts[0]);
    const c = cross(e1, e2);
    sx += c.x; sy += c.y; sz += c.z;
  }
  return 0.5 * Math.sqrt(sx * sx + sy * sy + sz * sz);
}

function detectFloorLevels(faces: Face3D[], up: UpAxis): number[] {
  const elevations: Array<{ elev: number; area: number }> = [];

  for (const face of faces) {
    const upComp = Math.abs(getUp(face.normal, up));
    if (upComp < 1.0 - HORIZONTAL_EPSILON) continue;
    const area = faceArea(face);
    if (area < MIN_SLAB_AREA) continue;
    const elev =
      face.vertices.reduce((s, v) => s + getUp(v, up), 0) / face.vertices.length;
    elevations.push({ elev, area });
  }

  if (elevations.length === 0) return [];

  elevations.sort((a, b) => a.elev - b.elev);

  // Gap-based grouping.
  const groups: Array<Array<{ elev: number; area: number }>> = [[elevations[0]]];
  for (let i = 1; i < elevations.length; i++) {
    if (elevations[i].elev - elevations[i - 1].elev >= MIN_FLOOR_GAP) {
      groups.push([]);
    }
    groups[groups.length - 1].push(elevations[i]);
  }

  const levels: number[] = groups.map((g) => {
    const totalArea = g.reduce((s, e) => s + e.area, 0);
    return g.reduce((s, e) => s + e.elev * e.area, 0) / totalArea;
  });

  levels.sort((a, b) => a - b);
  return levels;
}

function intersectFaceWithPlane(
  face: Face3D,
  cutElev: number,
  up: UpAxis,
): Array<[Vec3, Vec3]> {
  const verts = face.vertices;
  const n = verts.length;
  if (n < 3) return [];

  const dists = verts.map((v) => getUp(v, up) - cutElev);
  const intersections: Vec3[] = [];

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const di = dists[i], dj = dists[j];

    if (Math.abs(di) < 1e-9) {
      intersections.push(verts[i]);
    } else if ((di > 0) !== (dj > 0)) {
      const t = di / (di - dj);
      const vi = verts[i], vj = verts[j];
      intersections.push({
        x: vi.x + t * (vj.x - vi.x),
        y: vi.y + t * (vj.y - vi.y),
        z: vi.z + t * (vj.z - vi.z),
      });
    }
  }

  // Deduplicate.
  const unique: Vec3[] = [];
  for (const pt of intersections) {
    let dup = false;
    for (const u of unique) {
      if (
        Math.abs(pt.x - u.x) < 1e-6 &&
        Math.abs(pt.y - u.y) < 1e-6 &&
        Math.abs(pt.z - u.z) < 1e-6
      ) {
        dup = true;
        break;
      }
    }
    if (!dup) unique.push(pt);
  }

  if (unique.length >= 2) return [[unique[0], unique[1]]];
  return [];
}

/** Classify segments as interior or exterior based on parallel pairs. */
function classifySegments(
  segments: Array<{ a: Vec2; b: Vec2 }>,
): FloorPlanSegment[] {
  const result: FloorPlanSegment[] = [];

  // For each segment, check if there's a nearby parallel segment.
  // Parallel = similar direction vector, and midpoints are close.
  const hasParallelPartner = new Array(segments.length).fill(false);

  for (let i = 0; i < segments.length; i++) {
    if (hasParallelPartner[i]) continue;

    const ai = segments[i].a, bi = segments[i].b;
    const dxi = bi.x - ai.x, dyi = bi.y - ai.y;
    const lenI = Math.sqrt(dxi * dxi + dyi * dyi);
    if (lenI < 1e-6) continue;
    const nxi = dxi / lenI, nyi = dyi / lenI;
    const midIx = (ai.x + bi.x) / 2, midIy = (ai.y + bi.y) / 2;

    for (let j = i + 1; j < segments.length; j++) {
      if (hasParallelPartner[j]) continue;

      const aj = segments[j].a, bj = segments[j].b;
      const dxj = bj.x - aj.x, dyj = bj.y - aj.y;
      const lenJ = Math.sqrt(dxj * dxj + dyj * dyj);
      if (lenJ < 1e-6) continue;
      const nxj = dxj / lenJ, nyj = dyj / lenJ;

      // Check parallelism (same or opposite direction).
      const dp = Math.abs(nxi * nxj + nyi * nyj);
      if (dp < 0.95) continue;

      // Check perpendicular distance between midpoints.
      const midJx = (aj.x + bj.x) / 2, midJy = (aj.y + bj.y) / 2;
      const dmx = midJx - midIx, dmy = midJy - midIy;
      // Perpendicular distance = |cross product with direction|
      const perpDist = Math.abs(dmx * nyi - dmy * nxi);
      // Along-direction distance
      const alongDist = Math.abs(dmx * nxi + dmy * nyi);

      // Segments must be close perpendicular (wall thickness) and overlap along their length.
      if (perpDist < WALL_THICKNESS_MAX && alongDist < Math.max(lenI, lenJ) * 0.8) {
        hasParallelPartner[i] = true;
        hasParallelPartner[j] = true;
        break;
      }
    }
  }

  for (let i = 0; i < segments.length; i++) {
    result.push({
      a: segments[i].a,
      b: segments[i].b,
      isInterior: hasParallelPartner[i],
    });
  }

  return result;
}

function extractWithAxis(faces: Face3D[], up: UpAxis): FloorPlan[] {
  const levels = detectFloorLevels(faces, up);
  if (levels.length === 0) return [];

  const verticalFaces = faces.filter(
    (f) => Math.abs(getUp(f.normal, up)) <= VERTICAL_EPSILON,
  );
  if (verticalFaces.length === 0) return [];

  const plans: FloorPlan[] = [];

  for (let idx = 0; idx < levels.length; idx++) {
    const floorElev = levels[idx];
    const cutElev = floorElev + CUT_HEIGHT;

    const rawSegments: Array<{ a: Vec2; b: Vec2 }> = [];

    for (const face of verticalFaces) {
      const ups = face.vertices.map((v) => getUp(v, up));
      if (Math.min(...ups) > cutElev || Math.max(...ups) < cutElev) continue;

      const segs = intersectFaceWithPlane(face, cutElev, up);
      for (const [p1, p2] of segs) {
        const a = projectTopDown(p1, up);
        const b = projectTopDown(p2, up);
        if (Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6) continue;
        rawSegments.push({ a, b });
      }
    }

    if (rawSegments.length === 0) continue;

    // Compute bounding box and shift to origin.
    const allPts = rawSegments.flatMap((s) => [s.a, s.b]);
    const minX = Math.min(...allPts.map((p) => p.x));
    const minY = Math.min(...allPts.map((p) => p.y));
    const maxX = Math.max(...allPts.map((p) => p.x));
    const maxY = Math.max(...allPts.map((p) => p.y));

    const shifted = rawSegments.map((s) => ({
      a: { x: s.a.x - minX, y: s.a.y - minY },
      b: { x: s.b.x - minX, y: s.b.y - minY },
    }));

    const classified = classifySegments(shifted);

    plans.push({
      label: `Piso ${idx + 1}`,
      segments: classified,
      width: maxX - minX,
      height: maxY - minY,
      elevation: floorElev,
    });
  }

  return plans;
}

export function extractFloorPlans(faces: Face3D[]): FloorPlan[] {
  if (faces.length === 0) return [];

  const plansZ = extractWithAxis(faces, "Z");
  const plansY = extractWithAxis(faces, "Y");

  const totalZ = plansZ.reduce((s, p) => s + p.segments.length, 0);
  const totalY = plansY.reduce((s, p) => s + p.segments.length, 0);

  return totalY > totalZ ? plansY : plansZ;
}
