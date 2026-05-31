// ============================================================================
// Joint Detector
//
// Identifies shared edges between geometry groups in 3D space. A shared edge
// means two components physically meet at that boundary — a "joint" where
// assembly decisions need to be made (butt joint, overlap, etc.)
// ============================================================================

import type { Face3D, Vec3 } from "./types";
import { dot, getVertexIndices } from "./types";
import type { GeometryGroup } from "./group-classifier";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Joint {
  groupA: number;
  groupB: number;
  totalLength: number;
  dihedralAngle: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function snap3(v: number): number {
  return Math.round(v * 100) / 100;
}

function edgeKey3D(ax: number, ay: number, az: number, bx: number, by: number, bz: number): string {
  const sax = snap3(ax), say = snap3(ay), saz = snap3(az);
  const sbx = snap3(bx), sby = snap3(by), sbz = snap3(bz);
  if (sax < sbx || (sax === sbx && (say < sby || (say === sby && saz < sbz)))) {
    return `${sax},${say},${saz}|${sbx},${sby},${sbz}`;
  }
  return `${sbx},${sby},${sbz}|${sax},${say},${saz}`;
}

function edgeLength(a: Vec3, b: Vec3): number {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function pairKey(a: number, b: number): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect joints (shared 3D edges) between geometry groups.
 * Returns one Joint per pair of groups that share at least one edge.
 */
export function detectJoints(
  faces: Face3D[],
  groups: GeometryGroup[],
): Joint[] {
  // Map: edge key → list of group IDs that contain faces with this edge.
  const edgeToGroups = new Map<string, Set<number>>();
  const edgeLengths = new Map<string, number>();

  for (const group of groups) {
    if (group.category === "discard") continue;

    for (const fi of group.faceIndices) {
      const face = faces[fi];
      if (!face) continue;
      const verts = face.vertices;
      const vi = getVertexIndices(face);
      for (let i = 0; i < verts.length; i++) {
        const j = (i + 1) % verts.length;
        const key = vi
          ? (vi[i] < vi[j] ? `${vi[i]}|${vi[j]}` : `${vi[j]}|${vi[i]}`)
          : edgeKey3D(
              verts[i].x, verts[i].y, verts[i].z,
              verts[j].x, verts[j].y, verts[j].z,
            );
        const groups4edge = edgeToGroups.get(key);
        if (groups4edge) {
          groups4edge.add(group.id);
        } else {
          edgeToGroups.set(key, new Set([group.id]));
          edgeLengths.set(key, edgeLength(verts[i], verts[j]));
        }
      }
    }
  }

  // Collect joint lengths per group pair.
  const pairLengths = new Map<string, number>();
  const pairGroups = new Map<string, [number, number]>();

  for (const [key, groupIds] of edgeToGroups) {
    if (groupIds.size < 2) continue;
    const ids = Array.from(groupIds);
    const len = edgeLengths.get(key) ?? 0;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const pk = pairKey(ids[i], ids[j]);
        pairLengths.set(pk, (pairLengths.get(pk) ?? 0) + len);
        if (!pairGroups.has(pk)) pairGroups.set(pk, [ids[i], ids[j]]);
      }
    }
  }

  // Build group ID → representative normal lookup.
  const groupNormals = new Map<number, Vec3>();
  for (const g of groups) {
    groupNormals.set(g.id, g.representativeNormal);
  }

  const joints: Joint[] = [];
  for (const [pk, totalLength] of pairLengths) {
    if (totalLength < 0.01) continue;
    const [gA, gB] = pairGroups.get(pk)!;
    const nA = groupNormals.get(gA);
    const nB = groupNormals.get(gB);
    let dihedralAngle = 90;
    if (nA && nB) {
      const absDot = Math.abs(dot(nA, nB));
      dihedralAngle = (Math.acos(Math.min(1, absDot)) * 180) / Math.PI;
    }

    joints.push({ groupA: gA, groupB: gB, totalLength, dihedralAngle });
  }

  joints.sort((a, b) => b.totalLength - a.totalLength);
  return joints;
}
