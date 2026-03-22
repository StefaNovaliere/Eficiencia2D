// ============================================================================
// Geometry Classifier
//
// Classifies 3D faces into architectural categories using only geometry
// (no dependency on OBJ group names).
//
// Categories:
//   floor          — floors and ceilings (large horizontal faces)
//   wall_exterior  — walls on the building perimeter
//   wall_interior  — interior partition walls
//   discard        — skirting boards, edge strips, tiny faces
// ============================================================================

import type { ElementFilter, Face3D, Vec3 } from "./types";
import { cross, sub, vlength } from "./types";

export type FaceCategory =
  | "floor"
  | "wall_exterior"
  | "wall_interior"
  | "discard";

export interface ClassifiedFace {
  face: Face3D;
  category: FaceCategory;
  area: number;
  centroid: Vec3;
}

/** Compute the area of a Face3D by fan-triangulation from vertex 0. */
function faceArea(f: Face3D): number {
  const verts = f.vertices;
  let area = 0;
  for (let i = 1; i < verts.length - 1; i++) {
    const e1 = sub(verts[i], verts[0]);
    const e2 = sub(verts[i + 1], verts[0]);
    area += vlength(cross(e1, e2)) * 0.5;
  }
  return area;
}

/** Compute the centroid of a Face3D. */
function faceCentroid(f: Face3D): Vec3 {
  const verts = f.vertices;
  let sx = 0, sy = 0, sz = 0;
  for (const v of verts) {
    sx += v.x;
    sy += v.y;
    sz += v.z;
  }
  const n = verts.length;
  return { x: sx / n, y: sy / n, z: sz / n };
}

export const DEFAULT_ELEMENT_FILTER: ElementFilter = {
  floors: true,
  wallsExterior: true,
  wallsInterior: true,
};

/**
 * Classify all faces in the model and return only those matching the filter.
 *
 * Assumes Y-up space (pipeline transforms Z-up models before calling this).
 *
 * @param faces      All Face3D[] from the model (already in Y-up, metres).
 * @param filter     Which categories to include in the output.
 * @returns          Filtered Face3D[] ready for the cutting sheet pipeline.
 */
export function classifyAndFilter(
  faces: Face3D[],
  filter: ElementFilter,
): Face3D[] {
  if (faces.length === 0) return [];

  // --- Compute area, centroid, and classify orientation for each face ---

  const HORIZONTAL_THRESHOLD = 0.98; // |normal.y| > this → horizontal (rejects ~12° roofs)
  const VERTICAL_THRESHOLD = 0.5;    // |normal.y| < this → vertical
  const HEIGHT_BAND = 0.05;          // 5cm tolerance for grouping by level
  const MIN_AREA = 1e-6;             // skip degenerate faces

  interface FaceInfo {
    face: Face3D;
    area: number;
    centroid: Vec3;
    orientation: "horizontal" | "vertical" | "inclined";
  }

  const infos: FaceInfo[] = [];

  for (const face of faces) {
    const area = faceArea(face);
    if (area < MIN_AREA) continue;

    const absY = Math.abs(face.normal.y);
    let orientation: FaceInfo["orientation"];
    if (absY >= HORIZONTAL_THRESHOLD) orientation = "horizontal";
    else if (absY <= VERTICAL_THRESHOLD) orientation = "vertical";
    else orientation = "inclined";

    infos.push({ face, area, centroid: faceCentroid(face), orientation });
  }

  // --- Check if model is too small for classification (< 1m in any axis) ---

  let minX = Infinity, maxX = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  for (const fi of infos) {
    for (const v of fi.face.vertices) {
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      if (v.z < minZ) minZ = v.z;
      if (v.z > maxZ) maxZ = v.z;
    }
  }

  const rangeX = maxX - minX;
  const rangeZ = maxZ - minZ;

  // If model is very small, skip classification — return all as-is.
  if (rangeX < 1.0 || rangeZ < 1.0) {
    return faces;
  }

  // --- Paso 1: Histograma de área acumulada por banda de altura Y ---

  const horizontals = infos.filter((fi) => fi.orientation === "horizontal");

  // Group by elevation (Y centroid) in bands of ±5cm.
  const levelGroups = new Map<number, FaceInfo[]>();
  for (const fi of horizontals) {
    const h = fi.centroid.y;
    let foundKey: number | undefined;
    for (const key of levelGroups.keys()) {
      if (Math.abs(key - h) < HEIGHT_BAND) {
        foundKey = key;
        break;
      }
    }
    const key = foundKey ?? h;
    if (!levelGroups.has(key)) levelGroups.set(key, []);
    levelGroups.get(key)!.push(fi);
  }

  // Accumulate total area per height band.
  const bandArea = new Map<number, number>();
  for (const [key, group] of levelGroups.entries()) {
    let total = 0;
    for (const fi of group) total += fi.area;
    bandArea.set(key, total);
  }

  // --- Paso 2: Detectar niveles reales como picos del histograma ---

  let maxBandArea = 0;
  for (const area of bandArea.values()) {
    if (area > maxBandArea) maxBandArea = area;
  }

  // A band is a real level if its accumulated area exceeds this threshold.
  const LEVEL_THRESHOLD = Math.max(1.0, 0.03 * maxBandArea);

  const realLevelKeys = new Set<number>();
  for (const [key, area] of bandArea.entries()) {
    if (area >= LEVEL_THRESHOLD) {
      realLevelKeys.add(key);
    }
  }

  // --- Paso 3: Clasificar cada cara horizontal ---

  const floorFaces = new Set<Face3D>();
  const discardFaces = new Set<Face3D>();

  for (const [key, group] of levelGroups.entries()) {
    if (realLevelKeys.has(key)) {
      for (const fi of group) floorFaces.add(fi.face);
    } else {
      for (const fi of group) discardFaces.add(fi.face);
    }
  }

  // If no real levels were detected, don't discard any horizontals.
  if (realLevelKeys.size === 0) {
    for (const fi of horizontals) {
      floorFaces.add(fi.face);
      discardFaces.delete(fi.face);
    }
  }

  // --- Classify vertical faces: exterior vs interior ---

  const PERIMETER_MARGIN = 0.15;

  const wallExterior = new Set<Face3D>();
  const wallInterior = new Set<Face3D>();

  const verticals = infos.filter((fi) => fi.orientation === "vertical");

  for (const fi of verticals) {
    const cx = fi.centroid.x;
    const cz = fi.centroid.z;

    // Normalized distance to nearest bounding box edge.
    const distX = Math.min(
      Math.abs(cx - minX) / rangeX,
      Math.abs(cx - maxX) / rangeX,
    );
    const distZ = Math.min(
      Math.abs(cz - minZ) / rangeZ,
      Math.abs(cz - maxZ) / rangeZ,
    );
    const distToPerimeter = Math.min(distX, distZ);

    if (distToPerimeter <= PERIMETER_MARGIN) {
      wallExterior.add(fi.face);
    } else {
      wallInterior.add(fi.face);
    }
  }

  // --- Inclined faces → discard ---
  for (const fi of infos) {
    if (fi.orientation === "inclined") {
      discardFaces.add(fi.face);
    }
  }

  // --- Apply filter and return ---

  const result: Face3D[] = [];

  for (const fi of infos) {
    if (discardFaces.has(fi.face)) continue;
    if (floorFaces.has(fi.face) && !filter.floors) continue;
    if (wallExterior.has(fi.face) && !filter.wallsExterior) continue;
    if (wallInterior.has(fi.face) && !filter.wallsInterior) continue;
    result.push(fi.face);
  }

  return result;
}
