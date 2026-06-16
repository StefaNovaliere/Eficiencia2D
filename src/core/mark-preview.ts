import type { Face3D, Vec3 } from "@/core/types";
import type { GeometryGroup } from "@/core/group-classifier";
import { projectFacesTo2D } from "@/core/cutting-sheet";

type UpAxis = "Y" | "Z";

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** Map panel (u,v) back onto the group's tangent plane. */
function panel2DTo3D(
  u: number,
  v: number,
  uAxis: Vec3,
  vAxis: Vec3,
  anchor: Vec3,
): Vec3 {
  const au = dot(anchor, uAxis);
  const av = dot(anchor, vAxis);
  return {
    x: anchor.x + (u - au) * uAxis.x + (v - av) * vAxis.x,
    y: anchor.y + (u - au) * uAxis.y + (v - av) * vAxis.y,
    z: anchor.z + (u - au) * uAxis.z + (v - av) * vAxis.z,
  };
}

export interface MarkOpeningSegment {
  groupId: number;
  a: Vec3;
  b: Vec3;
}

export interface MarkOpeningGroupLines {
  groupId: number;
  /** Outward-facing normal of the panel — used to hide lines on the back side. */
  normal: Vec3;
  segments: MarkOpeningSegment[];
}

/**
 * Hole edges (inner rings) for groups marked for red engraving — same
 * geometry as the PDF/DXF MARK_VECTOR layer.
 */
export function computeMarkedOpeningGroups3D(
  faces: Face3D[],
  groups: GeometryGroup[],
  markGroupIds: Set<number>,
  up: UpAxis,
  hiddenGroupIds: Set<number> = new Set(),
): MarkOpeningGroupLines[] {
  if (markGroupIds.size === 0) return [];

  const result: MarkOpeningGroupLines[] = [];

  for (const group of groups) {
    if (!markGroupIds.has(group.id) || hiddenGroupIds.has(group.id)) continue;

    const groupFaces = group.faceIndices
      .map((fi) => faces[fi])
      .filter((f): f is Face3D => !!f && f.vertices.length >= 3);
    if (groupFaces.length === 0) continue;

    const projected = projectFacesTo2D(groupFaces, group.representativeNormal, up);
    if (!projected) continue;

    const holeEdges = projected.edges.filter((e) => e.hole === true);
    if (holeEdges.length === 0) continue;

    const anchor = groupFaces[0].vertices[0];
    const { uAxis, vAxis, originU, originV } = projected;

    const nlen = Math.hypot(
      group.representativeNormal.x,
      group.representativeNormal.y,
      group.representativeNormal.z,
    );
    const bias = nlen > 1e-6 ? 0.002 : 0;
    const nx = nlen > 1e-6 ? (group.representativeNormal.x / nlen) * bias : 0;
    const ny = nlen > 1e-6 ? (group.representativeNormal.y / nlen) * bias : 0;
    const nz = nlen > 1e-6 ? (group.representativeNormal.z / nlen) * bias : 0;

    const normal =
      nlen > 1e-6
        ? {
            x: group.representativeNormal.x / nlen,
            y: group.representativeNormal.y / nlen,
            z: group.representativeNormal.z / nlen,
          }
        : group.representativeNormal;

    const segments: MarkOpeningSegment[] = [];
    for (const e of holeEdges) {
      const a = panel2DTo3D(e.a.x + originU, e.a.y + originV, uAxis, vAxis, anchor);
      const b = panel2DTo3D(e.b.x + originU, e.b.y + originV, uAxis, vAxis, anchor);
      segments.push({
        groupId: group.id,
        a: { x: a.x + nx, y: a.y + ny, z: a.z + nz },
        b: { x: b.x + nx, y: b.y + ny, z: b.z + nz },
      });
    }

    result.push({ groupId: group.id, normal, segments });
  }

  return result;
}

/** @deprecated Use computeMarkedOpeningGroups3D */
export function computeMarkedOpeningSegments3D(
  faces: Face3D[],
  groups: GeometryGroup[],
  markGroupIds: Set<number>,
  up: UpAxis,
  hiddenGroupIds: Set<number> = new Set(),
): MarkOpeningSegment[] {
  return computeMarkedOpeningGroups3D(faces, groups, markGroupIds, up, hiddenGroupIds).flatMap(
    (g) => g.segments,
  );
}
