// ============================================================================
// Facade Extractor
//
// Takes Face3D[] and produces Facade[] — one elevation view per building side.
//
// Algorithm:
//   1. Auto-detect vertical axis (Y-up vs Z-up).
//   2. Filter vertical faces.
//   3. Cluster faces by horizontal direction → N/S/E/W groups.
//   4. For each group, collect unique outline edges (removing shared internal
//      edges from triangulated meshes) to produce clean silhouettes.
//   5. Normalize coordinates so (0,0) is bottom-left.
// ============================================================================

import type { Face3D, Facade, Loop2D, Vec2, Vec3 } from "./types";
import { cross, dot, normalize, vlength } from "./types";

const VERTICAL_EPSILON = 0.20;
const DIRECTION_CLUSTER_THRESHOLD = 0.70;

type UpAxis = "Y" | "Z";

function getUpComponent(normal: Vec3, up: UpAxis): number {
  return up === "Y" ? normal.y : normal.z;
}

function getUpVec(up: UpAxis): Vec3 {
  return up === "Y" ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
}

function horizontalDir(normal: Vec3, up: UpAxis): Vec3 {
  const h: Vec3 =
    up === "Y"
      ? { x: normal.x, y: 0, z: normal.z }
      : { x: normal.x, y: normal.y, z: 0 };
  return normalize(h);
}

function computeFacadeAxes(
  direction: Vec3,
  up: UpAxis,
): { uAxis: Vec3; vAxis: Vec3 } {
  const worldUp = getUpVec(up);
  const uAxis = normalize(cross(worldUp, direction));
  const vAxis = worldUp;
  return { uAxis, vAxis };
}

function clusterByDirection(
  faces: Face3D[],
  up: UpAxis,
): Array<{ dir: Vec3; faces: Face3D[] }> {
  const clusters: Array<{ dir: Vec3; faces: Face3D[] }> = [];

  for (const face of faces) {
    const hDir = horizontalDir(face.normal, up);
    if (vlength(hDir) < 0.01) continue;

    let placed = false;
    for (const cluster of clusters) {
      if (dot(hDir, cluster.dir) > DIRECTION_CLUSTER_THRESHOLD) {
        cluster.faces.push(face);
        placed = true;
        break;
      }
    }

    if (!placed) {
      clusters.push({ dir: hDir, faces: [face] });
    }
  }

  return clusters;
}

function directionLabel(direction: Vec3, up: UpAxis): string {
  const angle =
    up === "Y"
      ? Math.atan2(direction.x, direction.z)
      : Math.atan2(direction.x, direction.y);
  const deg = ((Math.atan2(Math.sin(angle), Math.cos(angle)) * 180) / Math.PI + 360) % 360;

  if (deg < 45 || deg >= 315) return "Fachada Norte";
  if (deg < 135) return "Fachada Este";
  if (deg < 225) return "Fachada Sur";
  return "Fachada Oeste";
}

/** Round a coordinate to a fixed precision for use as an edge key. */
function roundCoord(v: number): number {
  return Math.round(v * 10000) / 10000;
}

function edgeKey(ax: number, ay: number, bx: number, by: number): string {
  const a = `${roundCoord(ax)},${roundCoord(ay)}`;
  const b = `${roundCoord(bx)},${roundCoord(by)}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function extractWithAxis(faces: Face3D[], up: UpAxis): Facade[] {
  // 1. Filter vertical faces.
  const verticalFaces: Face3D[] = [];
  for (const face of faces) {
    if (Math.abs(getUpComponent(face.normal, up)) <= VERTICAL_EPSILON) {
      verticalFaces.push(face);
    }
  }
  if (verticalFaces.length === 0) return [];

  // 2. Cluster by horizontal direction.
  const clusters = clusterByDirection(verticalFaces, up);

  // 3. Build one Facade per cluster.
  const facades: Facade[] = [];

  for (const { dir, faces: clusterFaces } of clusters) {
    const { uAxis, vAxis } = computeFacadeAxes(dir, up);

    // Project all faces, collecting unique edges to remove internal
    // triangulation lines (edges shared between two faces cancel out).
    const edgeCounts = new Map<string, { ax: number; ay: number; bx: number; by: number }>();

    for (const face of clusterFaces) {
      const pts: Vec2[] = face.vertices.map((v) => ({
        x: dot(v, uAxis),
        y: dot(v, vAxis),
      }));

      // Walk edges of this polygon.
      for (let i = 0; i < pts.length; i++) {
        const j = (i + 1) % pts.length;
        const key = edgeKey(pts[i].x, pts[i].y, pts[j].x, pts[j].y);
        if (edgeCounts.has(key)) {
          edgeCounts.delete(key); // shared edge → remove
        } else {
          edgeCounts.set(key, {
            ax: pts[i].x,
            ay: pts[i].y,
            bx: pts[j].x,
            by: pts[j].y,
          });
        }
      }
    }

    if (edgeCounts.size === 0) continue;

    // Collect all points for bounding box.
    let minU = Infinity, maxU = -Infinity;
    let minV = Infinity, maxV = -Infinity;
    const edges: Array<{ ax: number; ay: number; bx: number; by: number }> = [];

    for (const edge of edgeCounts.values()) {
      edges.push(edge);
      minU = Math.min(minU, edge.ax, edge.bx);
      maxU = Math.max(maxU, edge.ax, edge.bx);
      minV = Math.min(minV, edge.ay, edge.by);
      maxV = Math.max(maxV, edge.ay, edge.by);
    }

    const width = maxU - minU;
    const height = maxV - minV;
    if (width < 0.01 || height < 0.01) continue;

    // Normalize to (0,0) origin and build Loop2D segments as 2-vertex lines.
    const polygons: Loop2D[] = edges.map((e) => ({
      vertices: [
        { x: e.ax - minU, y: e.ay - minV },
        { x: e.bx - minU, y: e.by - minV },
      ],
    }));

    let label = directionLabel(dir, up);
    const existing = new Set(facades.map((f) => f.label));
    if (existing.has(label)) {
      let n = 2;
      while (existing.has(`${label} ${n}`)) n++;
      label = `${label} ${n}`;
    }

    facades.push({ label, direction: dir, polygons, width, height });
  }

  const order: Record<string, number> = { Norte: 0, Este: 1, Sur: 2, Oeste: 3 };
  facades.sort(
    (a, b) =>
      (order[a.label.split(" ").pop()!] ?? 99) -
      (order[b.label.split(" ").pop()!] ?? 99),
  );

  return facades;
}

/** Detect the model's up axis by comparing facade extraction results for Y vs Z. */
export function detectUpAxis(faces: Face3D[]): "Y" | "Z" {
  if (faces.length === 0) return "Z";

  const facadesZ = extractWithAxis(faces, "Z");
  const facadesY = extractWithAxis(faces, "Y");

  const countZ = facadesZ.reduce((s, f) => s + f.polygons.length, 0);
  const countY = facadesY.reduce((s, f) => s + f.polygons.length, 0);

  return countY > countZ ? "Y" : "Z";
}

export function extractFacades(faces: Face3D[], upAxis?: "Y" | "Z"): Facade[] {
  if (faces.length === 0) return [];

  const up = upAxis ?? detectUpAxis(faces);
  return extractWithAxis(faces, up);
}
