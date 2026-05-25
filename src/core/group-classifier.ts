// ============================================================================
// Group Classifier
//
// Extends the per-face geometry classifier to produce spatially coherent
// groups suitable for user review. Each group bundles co-classified,
// coplanar, connected faces into a single reviewable unit.
//
// Algorithm:
//   1. Classify each face by orientation + perimeter (reuses geometry-classifier logic)
//   2. Within each category, cluster by coplanarity (normal direction + plane offset)
//   3. Within each coplanar cluster, split into connected components (shared vertices)
//   4. Each connected component becomes one GeometryGroup
// ============================================================================

import type { Face3D, Vec3 } from "./types";
import { cross, dot, normalize, sub, vlength } from "./types";
import { areThinTwins, findThinWallFaces } from "./wall-thickness";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FaceCategory =
  | "floor"
  | "wall"
  | "wall_exterior"
  | "wall_interior"
  | "discard";

export interface GeometryGroup {
  id: number;
  label: string;
  category: FaceCategory;
  faceIndices: number[];
  totalArea: number;
  centroid: Vec3;
  orientation: string;
  representativeNormal: Vec3;
}

// ---------------------------------------------------------------------------
// Per-face classification (same logic as geometry-classifier.ts)
// ---------------------------------------------------------------------------

const HORIZONTAL_THRESHOLD = 0.98;
const VERTICAL_THRESHOLD = 0.5;
const MIN_AREA = 1e-6;
const HEIGHT_BAND = 0.05;
const PERIMETER_MARGIN = 0.15;
const THIN_WALL_THRESHOLD = 0.40; // walls thinner than 40cm => single "wall" category

function faceArea(f: Face3D): number {
  const verts = f.vertices;
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

function faceCentroid(f: Face3D): Vec3 {
  const verts = f.vertices;
  let sx = 0, sy = 0, sz = 0;
  for (const v of verts) { sx += v.x; sy += v.y; sz += v.z; }
  const n = verts.length;
  return { x: sx / n, y: sy / n, z: sz / n };
}

interface FaceInfo {
  index: number;
  area: number;
  centroid: Vec3;
  orientation: "horizontal" | "vertical" | "inclined";
  category: FaceCategory;
}

function classifyAllFaces(faces: Face3D[]): FaceInfo[] {
  const infos: FaceInfo[] = [];

  for (let i = 0; i < faces.length; i++) {
    const face = faces[i];
    const area = faceArea(face);
    if (area < MIN_AREA) continue;

    const absY = Math.abs(face.normal.y);
    let orientation: FaceInfo["orientation"];
    if (absY >= HORIZONTAL_THRESHOLD) orientation = "horizontal";
    else if (absY <= VERTICAL_THRESHOLD) orientation = "vertical";
    else orientation = "inclined";

    infos.push({ index: i, area, centroid: faceCentroid(face), orientation, category: "discard" });
  }

  // Bounding box for perimeter analysis.
  let minX = Infinity, maxX = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (const fi of infos) {
    for (const v of faces[fi.index].vertices) {
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      if (v.z < minZ) minZ = v.z;
      if (v.z > maxZ) maxZ = v.z;
    }
  }
  const rangeX = maxX - minX;
  const rangeZ = maxZ - minZ;

  if (rangeX < 1.0 || rangeZ < 1.0) {
    for (const fi of infos) {
      if (fi.orientation === "horizontal") fi.category = "floor";
      else if (fi.orientation === "vertical") fi.category = "wall";
      else fi.category = "discard";
    }
    return infos;
  }

  // Classify horizontals: floor vs discard based on level detection.
  const horizontals = infos.filter((fi) => fi.orientation === "horizontal");
  const levelGroups = new Map<number, FaceInfo[]>();
  for (const fi of horizontals) {
    const h = fi.centroid.y;
    let foundKey: number | undefined;
    for (const key of levelGroups.keys()) {
      if (Math.abs(key - h) < HEIGHT_BAND) { foundKey = key; break; }
    }
    const key = foundKey ?? h;
    if (!levelGroups.has(key)) levelGroups.set(key, []);
    levelGroups.get(key)!.push(fi);
  }

  const bandArea = new Map<number, number>();
  for (const [key, group] of levelGroups.entries()) {
    let total = 0;
    for (const fi of group) total += fi.area;
    bandArea.set(key, total);
  }

  let maxBandArea = 0;
  for (const area of bandArea.values()) {
    if (area > maxBandArea) maxBandArea = area;
  }
  const LEVEL_THRESHOLD = Math.max(1.0, 0.03 * maxBandArea);

  const realLevelKeys = new Set<number>();
  for (const [key, area] of bandArea.entries()) {
    if (area >= LEVEL_THRESHOLD) realLevelKeys.add(key);
  }

  for (const [key, group] of levelGroups.entries()) {
    const isReal = realLevelKeys.has(key) || realLevelKeys.size === 0;
    for (const fi of group) {
      fi.category = isReal ? "floor" : "discard";
    }
  }

  // Classify verticals:
  //   - thin walls (paired thickness < 40cm) → single "wall" category
  //   - thick walls → "wall_exterior" / "wall_interior" based on perimeter distance
  const verticals = infos.filter((fi) => fi.orientation === "vertical");
  const verticalIndices = verticals.map((fi) => fi.index);
  const thinWallSet = findThinWallFaces(faces, verticalIndices, THIN_WALL_THRESHOLD);

  for (const fi of verticals) {
    if (thinWallSet.has(fi.index)) {
      fi.category = "wall";
      continue;
    }
    const cx = fi.centroid.x;
    const cz = fi.centroid.z;
    const distX = Math.min(Math.abs(cx - minX) / rangeX, Math.abs(cx - maxX) / rangeX);
    const distZ = Math.min(Math.abs(cz - minZ) / rangeZ, Math.abs(cz - maxZ) / rangeZ);
    fi.category = Math.min(distX, distZ) <= PERIMETER_MARGIN ? "wall_exterior" : "wall_interior";
  }

  // Inclined → discard.
  for (const fi of infos) {
    if (fi.orientation === "inclined") fi.category = "discard";
  }

  return infos;
}

// ---------------------------------------------------------------------------
// Coplanar clustering within a category
// ---------------------------------------------------------------------------

const NORMAL_CLUSTER_DOT = 0.985;
const D_TOLERANCE = 0.15;

function snap3(v: number): number {
  return Math.round(v * 100) / 100;
}

interface CoplanarCluster {
  normal: Vec3;
  d: number;
  faceInfos: FaceInfo[];
}

function clusterCoplanar(infos: FaceInfo[], faces: Face3D[]): CoplanarCluster[] {
  const clusters: CoplanarCluster[] = [];

  for (const fi of infos) {
    const face = faces[fi.index];
    const n = face.normal;
    if (vlength(n) < 0.01) continue;
    const d = dot(n, face.vertices[0]);

    let placed = false;
    for (const cl of clusters) {
      if (Math.abs(dot(n, cl.normal)) > NORMAL_CLUSTER_DOT && Math.abs(d - cl.d) < D_TOLERANCE) {
        cl.faceInfos.push(fi);
        placed = true;
        break;
      }
    }
    if (!placed) {
      clusters.push({ normal: normalize(n), d, faceInfos: [fi] });
    }
  }

  return clusters;
}

// ---------------------------------------------------------------------------
// Connected components via Union-Find
// ---------------------------------------------------------------------------

function splitConnected(faceInfos: FaceInfo[], faces: Face3D[]): FaceInfo[][] {
  if (faceInfos.length <= 1) return [faceInfos];

  const vertToIdx = new Map<string, number[]>();
  for (let i = 0; i < faceInfos.length; i++) {
    const face = faces[faceInfos[i].index];
    for (const v of face.vertices) {
      const key = `${snap3(v.x)},${snap3(v.y)},${snap3(v.z)}`;
      const arr = vertToIdx.get(key);
      if (arr) arr.push(i);
      else vertToIdx.set(key, [i]);
    }
  }

  const parent = faceInfos.map((_, i) => i);
  function find(x: number): number {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  }
  function union(a: number, b: number) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  for (const indices of vertToIdx.values()) {
    for (let i = 1; i < indices.length; i++) union(indices[0], indices[i]);
  }

  const map = new Map<number, FaceInfo[]>();
  for (let i = 0; i < faceInfos.length; i++) {
    const root = find(i);
    const arr = map.get(root);
    if (arr) arr.push(faceInfos[i]);
    else map.set(root, [faceInfos[i]]);
  }

  return Array.from(map.values());
}

// ---------------------------------------------------------------------------
// Orientation label
// ---------------------------------------------------------------------------

function orientationLabel(normal: Vec3, orientation: string): string {
  if (orientation === "horizontal") return "Horizontal";

  const hx = normal.x;
  const hz = normal.z;
  const angle = Math.atan2(hx, hz);
  const deg = ((angle * 180 / Math.PI) % 360 + 360) % 360;

  if (deg < 45 || deg >= 315) return "Vertical - Norte";
  if (deg < 135) return "Vertical - Este";
  if (deg < 225) return "Vertical - Sur";
  return "Vertical - Oeste";
}

const CATEGORY_LABELS: Record<FaceCategory, string> = {
  floor: "Piso",
  wall: "Pared",
  wall_exterior: "Pared Ext.",
  wall_interior: "Pared Int.",
  discard: "Descartado",
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

interface Subgroup {
  category: FaceCategory;
  faceInfos: FaceInfo[];
  normal: Vec3;
  d: number;
  centroid: Vec3;
  extent: number;
  totalArea: number;
}

function buildSubgroup(
  category: FaceCategory,
  cluster: CoplanarCluster,
  comp: FaceInfo[],
  faces: Face3D[],
): Subgroup | null {
  let totalArea = 0;
  for (const fi of comp) totalArea += fi.area;
  if (totalArea < 0.01) return null;

  let cx = 0, cy = 0, cz = 0;
  for (const fi of comp) {
    cx += fi.centroid.x * fi.area;
    cy += fi.centroid.y * fi.area;
    cz += fi.centroid.z * fi.area;
  }
  cx /= totalArea; cy /= totalArea; cz /= totalArea;

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const fi of comp) {
    for (const v of faces[fi.index].vertices) {
      if (v.x < minX) minX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.z < minZ) minZ = v.z;
      if (v.x > maxX) maxX = v.x;
      if (v.y > maxY) maxY = v.y;
      if (v.z > maxZ) maxZ = v.z;
    }
  }
  const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ);

  return {
    category,
    faceInfos: comp,
    normal: cluster.normal,
    d: cluster.d,
    centroid: { x: cx, y: cy, z: cz },
    extent,
    totalArea,
  };
}

export function classifyIntoGroups(faces: Face3D[]): GeometryGroup[] {
  if (faces.length === 0) return [];

  const allInfos = classifyAllFaces(faces);

  // Partition by category.
  const byCategory = new Map<FaceCategory, FaceInfo[]>();
  for (const fi of allInfos) {
    const arr = byCategory.get(fi.category);
    if (arr) arr.push(fi);
    else byCategory.set(fi.category, [fi]);
  }

  // Build subgroups: one per (category, coplanar cluster, connected component).
  const subgroups: Subgroup[] = [];
  for (const [category, infos] of byCategory.entries()) {
    const clusters = clusterCoplanar(infos, faces);
    for (const cluster of clusters) {
      const components = splitConnected(cluster.faceInfos, faces);
      for (const comp of components) {
        const sg = buildSubgroup(category, cluster, comp, faces);
        if (sg) subgroups.push(sg);
      }
    }
  }

  // Merge thin-twin subgroups (two parallel-opposite skins of the same physical
  // element, e.g. the inner+outer face of a thin wall or the top+bottom of a
  // thin floor slab) into a single component.
  const parent = subgroups.map((_, i) => i);
  function find(x: number): number {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  }
  function union(a: number, b: number) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  for (let i = 0; i < subgroups.length; i++) {
    for (let j = i + 1; j < subgroups.length; j++) {
      if (areThinTwins(subgroups[i], subgroups[j], THIN_WALL_THRESHOLD)) {
        union(i, j);
      }
    }
  }

  const unionMap = new Map<number, Subgroup[]>();
  for (let i = 0; i < subgroups.length; i++) {
    const root = find(i);
    const arr = unionMap.get(root);
    if (arr) arr.push(subgroups[i]);
    else unionMap.set(root, [subgroups[i]]);
  }

  const CATEGORY_PRIORITY: FaceCategory[] = [
    "floor",
    "wall",
    "wall_exterior",
    "wall_interior",
    "discard",
  ];

  const groups: GeometryGroup[] = [];
  let nextId = 1;
  const counters: Record<string, number> = {};

  for (const merged of unionMap.values()) {
    // Dominant category: largest area, with non-discard winning ties over discard.
    const areaByCat = new Map<FaceCategory, number>();
    for (const sg of merged) {
      areaByCat.set(sg.category, (areaByCat.get(sg.category) ?? 0) + sg.totalArea);
    }
    let dominant: FaceCategory = "discard";
    let bestArea = -1;
    for (const cat of CATEGORY_PRIORITY) {
      const a = areaByCat.get(cat);
      if (a === undefined) continue;
      if (cat !== "discard" && a > bestArea) {
        dominant = cat;
        bestArea = a;
      }
    }
    if (bestArea < 0) dominant = "discard";

    // Combine faces, recompute centroid, total area.
    const allFaceIndices: number[] = [];
    let totalArea = 0;
    let cx = 0, cy = 0, cz = 0;
    let biggest = merged[0];
    let biggestOrient = merged[0].faceInfos[0].orientation;
    for (const sg of merged) {
      for (const fi of sg.faceInfos) allFaceIndices.push(fi.index);
      totalArea += sg.totalArea;
      cx += sg.centroid.x * sg.totalArea;
      cy += sg.centroid.y * sg.totalArea;
      cz += sg.centroid.z * sg.totalArea;
      if (sg.totalArea > biggest.totalArea) {
        biggest = sg;
        biggestOrient = sg.faceInfos[0].orientation;
      }
    }
    cx /= totalArea; cy /= totalArea; cz /= totalArea;

    const orient = orientationLabel(biggest.normal, biggestOrient);
    const catLabel = CATEGORY_LABELS[dominant];
    const key = `${catLabel}_${orient}`;
    counters[key] = (counters[key] ?? 0) + 1;

    groups.push({
      id: nextId++,
      label: `${catLabel} ${orient} #${counters[key]}`,
      category: dominant,
      faceIndices: allFaceIndices,
      totalArea,
      centroid: { x: cx, y: cy, z: cz },
      orientation: orient,
      representativeNormal: biggest.normal,
    });
  }

  // Sort: floors, thin walls, exterior walls, interior walls, discarded. Within each, by area desc.
  const ORDER: Record<FaceCategory, number> = { floor: 0, wall: 1, wall_exterior: 2, wall_interior: 3, discard: 4 };
  groups.sort((a, b) => {
    const catDiff = ORDER[a.category] - ORDER[b.category];
    if (catDiff !== 0) return catDiff;
    return b.totalArea - a.totalArea;
  });

  return groups;
}
