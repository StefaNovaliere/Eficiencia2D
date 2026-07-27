import type { Face3D, Vec3 } from "@/core/types";
import type { GeometryGroup } from "@/core/group-classifier";
import { projectFacesTo2D } from "@/core/panel-projection";
import type { MarkLine } from "@/core/mark-lines";
import { cutGroupOwnerId } from "@/core/cut-derived-groups";

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

/**
 * Líneas de marca ROJAS dibujadas por el usuario (polilíneas en UV del panel) →
 * segmentos 3D sobre la cara del grupo, para grabar. Mismo mapeo/bias que las
 * aberturas marcadas; se rinde con el mismo material rojo en el visor.
 */
export function computeMarkLines3D(
  faces: Face3D[],
  groups: GeometryGroup[],
  markLines: MarkLine[],
  up: UpAxis,
  hiddenGroupIds: Set<number> = new Set(),
  projectionGroups: GeometryGroup[] = groups,
): MarkOpeningGroupLines[] {
  if (markLines.length === 0) return [];

  const linesByGroup = new Map<number, MarkLine[]>();
  for (const l of markLines) {
    const ownerId = cutGroupOwnerId(l.groupId);
    const arr = linesByGroup.get(ownerId);
    if (arr) arr.push(l);
    else linesByGroup.set(ownerId, [l]);
  }

  const projById = new Map(projectionGroups.map((g) => [g.id, g]));

  const result: MarkOpeningGroupLines[] = [];
  for (const group of groups) {
    if (hiddenGroupIds.has(group.id)) continue;

    const ownerId = cutGroupOwnerId(group.id);
    const groupLines = linesByGroup.get(ownerId);
    if (!groupLines) continue;

    const projGroup = projById.get(ownerId) ?? group;
    const groupFaces = projGroup.faceIndices
      .map((fi) => faces[fi])
      .filter((f): f is Face3D => !!f && f.vertices.length >= 3);
    if (groupFaces.length === 0) continue;

    const projected = projectFacesTo2D(groupFaces, projGroup.representativeNormal, up);
    if (!projected) continue;

    const anchor = groupFaces[0].vertices[0];
    const { uAxis, vAxis, originU, originV } = projected;

    const nlen = Math.hypot(
      projGroup.representativeNormal.x,
      projGroup.representativeNormal.y,
      projGroup.representativeNormal.z,
    );
    if (nlen <= 1e-6) continue;

    const repNormal = {
      x: projGroup.representativeNormal.x / nlen,
      y: projGroup.representativeNormal.y / nlen,
      z: projGroup.representativeNormal.z / nlen,
    };
    const BIAS = 0.002;

    /**
     * Cada línea se dibuja sobre la CARA que el usuario clickeó (`surfaceNormal`),
     * no sobre una cara arbitraria del grupo: antes todas caían del mismo lado y
     * una marca hecha en la cara interior aparecía en la exterior.
     * Se agrupan por lado (frente/dorso) porque el visor usa `normal` para
     * ocultar las líneas de la cara que no se ve.
     */
    const bySide = new Map<1 | -1, MarkOpeningSegment[]>();

    for (const line of groupLines) {
      const sn = line.surfaceNormal;
      const side: 1 | -1 =
        sn && dot(sn, repNormal) < 0 ? -1 : 1;
      const nx = repNormal.x * BIAS * side;
      const ny = repNormal.y * BIAS * side;
      const nz = repNormal.z * BIAS * side;

      let bucket = bySide.get(side);
      if (!bucket) {
        bucket = [];
        bySide.set(side, bucket);
      }

      for (let i = 1; i < line.points.length; i++) {
        const p0 = line.points[i - 1];
        const p1 = line.points[i];
        const a = panel2DTo3D(p0.u + originU, p0.v + originV, uAxis, vAxis, anchor);
        const b = panel2DTo3D(p1.u + originU, p1.v + originV, uAxis, vAxis, anchor);
        bucket.push({
          groupId: group.id,
          a: { x: a.x + nx, y: a.y + ny, z: a.z + nz },
          b: { x: b.x + nx, y: b.y + ny, z: b.z + nz },
        });
      }
    }

    for (const [side, segments] of bySide) {
      if (segments.length === 0) continue;
      result.push({
        groupId: group.id,
        normal: {
          x: repNormal.x * side,
          y: repNormal.y * side,
          z: repNormal.z * side,
        },
        segments,
      });
    }
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
