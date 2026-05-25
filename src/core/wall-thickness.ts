// ============================================================================
// Wall Thickness Pairing
//
// Identifies pairs of parallel-opposing vertical face clusters that represent
// the two skins of the same physical wall, and measures the perpendicular
// distance between them (the wall thickness).
//
// Used to decide whether a wall is "thin" (single component, no exterior/
// interior distinction) or "thick" (split into wall_exterior / wall_interior).
// ============================================================================

import type { Face3D, Vec3 } from "./types";
import { dot, normalize, vlength } from "./types";

const COPLANAR_NORMAL_DOT = 0.985;
const COPLANAR_D_TOLERANCE = 0.05;     // 5cm in plane offset
const OPPOSITE_NORMAL_DOT = -0.985;    // dot product < this => opposite normals
const MAX_WALL_THICKNESS = 1.0;        // search range for twin (1m)
const LATERAL_OVERLAP_FACTOR = 0.5;    // how much lateral offset is tolerated

/** A parametrised, planar region (used to check thin-twin pairing). */
export interface TwinCandidate {
  normal: Vec3;   // unit normal
  d: number;      // plane offset = dot(normal, point_on_plane)
  centroid: Vec3;
  extent: number; // max dimension of bounding box (lateral overlap budget)
}

/**
 * True if two planar regions are "thin twins": parallel with opposite normals,
 * perpendicular distance below `thicknessThreshold`, and laterally overlapping.
 * A pair of thin twins represents the two skins of the same physical wall or
 * the top/bottom faces of the same physical floor slab.
 */
export function areThinTwins(
  a: TwinCandidate,
  b: TwinCandidate,
  thicknessThreshold: number,
): boolean {
  const ndot =
    a.normal.x * b.normal.x +
    a.normal.y * b.normal.y +
    a.normal.z * b.normal.z;
  if (ndot > OPPOSITE_NORMAL_DOT) return false;

  const distance = Math.abs(
    a.normal.x * b.centroid.x +
      a.normal.y * b.centroid.y +
      a.normal.z * b.centroid.z -
      a.d,
  );
  if (distance < 1e-4 || distance > thicknessThreshold) return false;

  const dx = b.centroid.x - a.centroid.x;
  const dy = b.centroid.y - a.centroid.y;
  const dz = b.centroid.z - a.centroid.z;
  const nc = dx * a.normal.x + dy * a.normal.y + dz * a.normal.z;
  const lx = dx - nc * a.normal.x;
  const ly = dy - nc * a.normal.y;
  const lz = dz - nc * a.normal.z;
  const lateralDist = Math.sqrt(lx * lx + ly * ly + lz * lz);

  const budget = (a.extent + b.extent) * 0.5 * LATERAL_OVERLAP_FACTOR;
  return lateralDist <= budget;
}

interface VerticalCluster {
  normal: Vec3;
  d: number;
  faceIndices: number[];
  centroid: Vec3;
  extent: number;
}

function clusterVerticals(
  faces: Face3D[],
  verticalIndices: number[],
): VerticalCluster[] {
  const clusters: VerticalCluster[] = [];

  for (const i of verticalIndices) {
    const face = faces[i];
    if (vlength(face.normal) < 0.01) continue;
    const n = normalize(face.normal);
    const d = dot(n, face.vertices[0]);

    let placed = false;
    for (const cl of clusters) {
      if (
        dot(cl.normal, n) > COPLANAR_NORMAL_DOT &&
        Math.abs(d - cl.d) < COPLANAR_D_TOLERANCE
      ) {
        cl.faceIndices.push(i);
        placed = true;
        break;
      }
    }
    if (!placed) {
      clusters.push({
        normal: n,
        d,
        faceIndices: [i],
        centroid: { x: 0, y: 0, z: 0 },
        extent: 0,
      });
    }
  }

  for (const cl of clusters) {
    let sx = 0, sy = 0, sz = 0, count = 0;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const fi of cl.faceIndices) {
      for (const v of faces[fi].vertices) {
        sx += v.x; sy += v.y; sz += v.z; count++;
        if (v.x < minX) minX = v.x;
        if (v.y < minY) minY = v.y;
        if (v.z < minZ) minZ = v.z;
        if (v.x > maxX) maxX = v.x;
        if (v.y > maxY) maxY = v.y;
        if (v.z > maxZ) maxZ = v.z;
      }
    }
    cl.centroid = { x: sx / count, y: sy / count, z: sz / count };
    cl.extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  }

  return clusters;
}

function findTwinThickness(
  cluster: VerticalCluster,
  all: VerticalCluster[],
): number | null {
  let best: number | null = null;
  for (const other of all) {
    if (other === cluster) continue;
    if (dot(cluster.normal, other.normal) > OPPOSITE_NORMAL_DOT) continue;

    // Perpendicular distance from other's centroid to cluster's plane.
    const distance = Math.abs(dot(cluster.normal, other.centroid) - cluster.d);
    if (distance < 1e-4 || distance > MAX_WALL_THICKNESS) continue;

    // Lateral overlap: project the centroid delta onto cluster's plane.
    const dx = other.centroid.x - cluster.centroid.x;
    const dy = other.centroid.y - cluster.centroid.y;
    const dz = other.centroid.z - cluster.centroid.z;
    const normalComp =
      dx * cluster.normal.x + dy * cluster.normal.y + dz * cluster.normal.z;
    const lx = dx - normalComp * cluster.normal.x;
    const ly = dy - normalComp * cluster.normal.y;
    const lz = dz - normalComp * cluster.normal.z;
    const lateralDist = Math.sqrt(lx * lx + ly * ly + lz * lz);

    const budget =
      (cluster.extent + other.extent) * 0.5 * LATERAL_OVERLAP_FACTOR;
    if (lateralDist > budget) continue;

    if (best === null || distance < best) best = distance;
  }
  return best;
}

/**
 * Returns the set of vertical face indices whose paired wall thickness
 * is below the given threshold (i.e. "thin walls").
 *
 * @param faces             All faces in the model (Y-up).
 * @param verticalIndices   Indices of faces already classified as vertical.
 * @param thicknessThreshold Walls thinner than this (in metres) count as thin.
 */
export function findThinWallFaces(
  faces: Face3D[],
  verticalIndices: number[],
  thicknessThreshold: number,
): Set<number> {
  const clusters = clusterVerticals(faces, verticalIndices);
  const thin = new Set<number>();
  for (const cluster of clusters) {
    const thickness = findTwinThickness(cluster, clusters);
    if (thickness !== null && thickness < thicknessThreshold) {
      for (const fi of cluster.faceIndices) thin.add(fi);
    }
  }
  return thin;
}
