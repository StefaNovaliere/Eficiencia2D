// ============================================================================
// Floor Plan Extractor — Horizontal section cuts.
//
// For each detected floor level, cuts the building with a horizontal plane
// at ~1 m above the slab, producing a 2D plan view showing interior and
// exterior wall layout.
//
// Door components (OBJ groups whose name contains "puerta", "door", or
// "porta") are detected automatically:
//   - Their faces are excluded from the wall-segment section cut.
//   - Instead they produce Door2D entries (hinge, arc, leaf).
//
// All wall segments are drawn uniformly in black (CORTE layer).
// Door symbols go on the ABERTURAS layer.
// ============================================================================

import type { Face3D, FloorPlan, FloorPlanSegment, Vec2, Vec3 } from "./types";
import { cross, sub } from "./types";
import { isDoorGroup, extractDoorsForLevel } from "./door-extractor";

const CUT_HEIGHT = 1.0;
const HORIZONTAL_EPSILON = 0.25;
const VERTICAL_EPSILON = 0.20;
const BIN_SIZE = 0.3;          // m — histogram bin width for floor detection
const MIN_FLOOR_GAP = 2.0;    // m — merge peaks closer than this
const PEAK_AREA_RATIO = 0.08; // peaks must have ≥ 8% of the tallest bin's area

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

export function detectFloorLevels(faces: Face3D[], up: "Y" | "Z"): number[] {
  const elevations: Array<{ elev: number; area: number }> = [];

  for (const face of faces) {
    const upComp = Math.abs(getUp(face.normal, up));
    if (upComp < 1.0 - HORIZONTAL_EPSILON) continue;
    const area = faceArea(face);
    if (area < 0.01) continue;
    const elev =
      face.vertices.reduce((s, v) => s + getUp(v, up), 0) / face.vertices.length;
    elevations.push({ elev, area });
  }

  if (elevations.length === 0) return [];

  const minElev = Math.min(...elevations.map((e) => e.elev));
  const maxElev = Math.max(...elevations.map((e) => e.elev));
  const numBins = Math.max(1, Math.ceil((maxElev - minElev) / BIN_SIZE) + 1);
  const bins = new Float64Array(numBins);

  for (const { elev, area } of elevations) {
    const idx = Math.min(Math.floor((elev - minElev) / BIN_SIZE), numBins - 1);
    bins[idx] += area;
  }

  const maxBinArea = Math.max(...bins);
  const threshold = maxBinArea * PEAK_AREA_RATIO;

  const peakElevations: Array<{ elev: number; area: number }> = [];
  for (let i = 0; i < numBins; i++) {
    if (bins[i] < threshold) continue;
    const isLocalMax =
      (i === 0 || bins[i] >= bins[i - 1]) &&
      (i === numBins - 1 || bins[i] >= bins[i + 1]);
    if (!isLocalMax) continue;
    const binLow = minElev + i * BIN_SIZE;
    const binHigh = binLow + BIN_SIZE;
    let sumArea = 0, sumWeighted = 0;
    for (const { elev, area } of elevations) {
      if (elev >= binLow && elev < binHigh) {
        sumArea += area;
        sumWeighted += elev * area;
      }
    }
    peakElevations.push({ elev: sumWeighted / sumArea, area: sumArea });
  }

  peakElevations.sort((a, b) => a.elev - b.elev);
  const levels: number[] = [];
  for (const peak of peakElevations) {
    if (levels.length > 0 && peak.elev - levels[levels.length - 1] < MIN_FLOOR_GAP) {
      const prevIdx = levels.length - 1;
      const prevPeak = peakElevations.find((p) => Math.abs(p.elev - levels[prevIdx]) < 1e-9);
      if (prevPeak && peak.area > prevPeak.area) {
        levels[prevIdx] = peak.elev;
      }
    } else {
      levels.push(peak.elev);
    }
  }

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

/** Convert raw segments to FloorPlanSegments (all drawn uniformly). */
function toFloorPlanSegments(
  segments: Array<{ a: Vec2; b: Vec2 }>,
): FloorPlanSegment[] {
  return segments.map((s) => ({
    a: s.a,
    b: s.b,
    isInterior: false,
  }));
}

function extractWithAxis(faces: Face3D[], up: UpAxis): FloorPlan[] {
  const levels = detectFloorLevels(faces, up);
  if (levels.length === 0) return [];

  // --- Identify door groups ---
  const doorGroupNames = new Set<string>();
  for (const face of faces) {
    if (face.panelId && isDoorGroup(face.panelId)) {
      doorGroupNames.add(face.panelId);
    }
  }

  // Group ALL door-group faces by name (for geometry analysis).
  const doorFacesByGroup = new Map<string, Face3D[]>();
  for (const face of faces) {
    if (face.panelId && doorGroupNames.has(face.panelId)) {
      const arr = doorFacesByGroup.get(face.panelId);
      if (arr) arr.push(face);
      else doorFacesByGroup.set(face.panelId, [face]);
    }
  }

  // Vertical faces EXCLUDING doors (for wall section-cut only).
  const verticalFaces = faces.filter(
    (f) =>
      Math.abs(getUp(f.normal, up)) <= VERTICAL_EPSILON &&
      (!f.panelId || !doorGroupNames.has(f.panelId)),
  );

  if (verticalFaces.length === 0 && doorFacesByGroup.size === 0) return [];

  const plans: FloorPlan[] = [];

  for (let idx = 0; idx < levels.length; idx++) {
    const floorElev = levels[idx];
    const cutElev = floorElev + CUT_HEIGHT;

    // --- Wall section-cut (doors excluded) ---
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

    // --- Doors for this floor level ---
    const rawDoors = extractDoorsForLevel(doorFacesByGroup, cutElev, up);

    if (rawSegments.length === 0 && rawDoors.length === 0) continue;

    // --- Bounding box (include door points for safety) ---
    const allPts = rawSegments.flatMap((s) => [s.a, s.b]);
    for (const d of rawDoors) {
      allPts.push(d.hinge, d.leafEnd);
    }
    if (allPts.length === 0) continue;

    const minX = Math.min(...allPts.map((p) => p.x));
    const minY = Math.min(...allPts.map((p) => p.y));
    const maxX = Math.max(...allPts.map((p) => p.x));
    const maxY = Math.max(...allPts.map((p) => p.y));

    const shifted = rawSegments.map((s) => ({
      a: { x: s.a.x - minX, y: s.a.y - minY },
      b: { x: s.b.x - minX, y: s.b.y - minY },
    }));

    const shiftedDoors = rawDoors.map((d) => ({
      ...d,
      hinge: { x: d.hinge.x - minX, y: d.hinge.y - minY },
      leafEnd: { x: d.leafEnd.x - minX, y: d.leafEnd.y - minY },
    }));

    const classified = toFloorPlanSegments(shifted);

    plans.push({
      label: `Piso ${idx + 1}`,
      segments: classified,
      width: maxX - minX,
      height: maxY - minY,
      elevation: floorElev,
      doors: shiftedDoors.length > 0 ? shiftedDoors : undefined,
    });
  }

  return plans;
}

export function extractFloorPlans(faces: Face3D[], upAxis?: "Y" | "Z"): FloorPlan[] {
  if (faces.length === 0) return [];

  if (upAxis) return extractWithAxis(faces, upAxis);

  // Fallback: try both and pick the one with more segments.
  const plansZ = extractWithAxis(faces, "Z");
  const plansY = extractWithAxis(faces, "Y");

  const totalZ = plansZ.reduce((s, p) => s + p.segments.length, 0);
  const totalY = plansY.reduce((s, p) => s + p.segments.length, 0);

  return totalY > totalZ ? plansY : plansZ;
}
