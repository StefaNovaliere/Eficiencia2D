import type { Face3D, Vec3 } from "@/core/types";
import type { GeometryGroup } from "@/core/group-classifier";
import { projectFacesTo2D } from "@/core/cutting-sheet";
import type { UserCut } from "@/core/user-cuts";
import { resolveCutDrag, type CutDragState } from "@/core/user-cuts";

type UpAxis = "Y" | "Z";

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

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

export interface CutPreviewSegment {
  groupId: number;
  normal: Vec3;
  a: Vec3;
  b: Vec3;
}

function cutToPanelRing(
  cut: Pick<UserCut, "kind" | "u0" | "v0" | "u1" | "v1">,
): { x: number; y: number }[] {
  const resolved = resolveCutDrag({
    groupId: 0,
    kind: cut.kind,
    u0: cut.u0,
    v0: cut.v0,
    u1: cut.u1,
    v1: cut.v1,
    shiftKey: false,
  });

  if (cut.kind === "circle") {
    const minU = Math.min(resolved.u0, resolved.u1);
    const maxU = Math.max(resolved.u0, resolved.u1);
    const minV = Math.min(resolved.v0, resolved.v1);
    const maxV = Math.max(resolved.v0, resolved.v1);
    const cx = (minU + maxU) / 2;
    const cy = (minV + maxV) / 2;
    const rx = (maxU - minU) / 2;
    const ry = (maxV - minV) / 2;
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i <= 32; i++) {
      const t = (i / 32) * Math.PI * 2;
      pts.push({ x: cx + Math.cos(t) * rx, y: cy + Math.sin(t) * ry });
    }
    return pts;
  }

  if (cut.kind === "line") {
    return [
      { x: resolved.u0, y: resolved.v0 },
      { x: resolved.u1, y: resolved.v1 },
    ];
  }

  let minU = Math.min(resolved.u0, resolved.u1);
  let maxU = Math.max(resolved.u0, resolved.u1);
  let minV = Math.min(resolved.v0, resolved.v1);
  let maxV = Math.max(resolved.v0, resolved.v1);

  if (cut.kind === "square") {
    const side = Math.max(maxU - minU, maxV - minV);
    maxU = minU + side;
    maxV = minV + side;
  }

  return [
    { x: minU, y: minV },
    { x: maxU, y: minV },
    { x: maxU, y: maxV },
    { x: minU, y: maxV },
    { x: minU, y: minV },
  ];
}

export function getGroupPanelSize(
  faces: Face3D[],
  group: GeometryGroup,
  up: UpAxis,
): { widthM: number; heightM: number } | null {
  const groupFaces = group.faceIndices
    .map((fi) => faces[fi])
    .filter((f): f is Face3D => !!f && f.vertices.length >= 3);
  if (groupFaces.length === 0) return null;

  const proj = projectFacesTo2D(groupFaces, group.representativeNormal, up);
  if (!proj) return null;
  return { widthM: proj.widthM, heightM: proj.heightM };
}

interface CachedGroupProj {
  proj: ReturnType<typeof projectFacesTo2D>;
  anchor: Vec3;
  normal: Vec3;
  bias: number;
}

/** Build and cache per-group projection so cuts on the same panel share it. */
function buildGroupProjCache(
  faces: Face3D[],
  groups: GeometryGroup[],
  up: UpAxis,
  neededGroupIds: Set<number>,
): Map<number, CachedGroupProj> {
  const cache = new Map<number, CachedGroupProj>();
  for (const group of groups) {
    if (!neededGroupIds.has(group.id)) continue;
    const groupFaces = group.faceIndices
      .map((fi) => faces[fi])
      .filter((f): f is Face3D => !!f && f.vertices.length >= 3);
    if (groupFaces.length === 0) continue;

    const proj = projectFacesTo2D(groupFaces, group.representativeNormal, up);
    if (!proj) continue;

    const nlen = Math.hypot(
      group.representativeNormal.x,
      group.representativeNormal.y,
      group.representativeNormal.z,
    );
    const bias = nlen > 1e-6 ? 0.006 : 0;
    const normal: Vec3 =
      nlen > 1e-6
        ? {
            x: group.representativeNormal.x / nlen,
            y: group.representativeNormal.y / nlen,
            z: group.representativeNormal.z / nlen,
          }
        : { ...group.representativeNormal };

    cache.set(group.id, { proj, anchor: groupFaces[0].vertices[0], normal, bias });
  }
  return cache;
}

export function computeCutPreviewSegments(
  faces: Face3D[],
  groups: GeometryGroup[],
  cuts: UserCut[],
  draft: CutDragState | null,
  up: UpAxis,
  /** Cut being moved — hide its original position so only the draft shows. */
  movingCutId?: string | null,
): CutPreviewSegment[] {
  const visible = movingCutId ? cuts.filter((c) => c.id !== movingCutId) : cuts;
  const all: UserCut[] = [...visible];
  if (draft) {
    const r = resolveCutDrag(draft);
    all.push({ id: "__draft__", groupId: draft.groupId, kind: draft.kind, ...r });
  }

  if (all.length === 0) return [];

  // Build projection cache once per unique groupId — O(groups), not O(cuts)
  const neededIds = new Set(all.map((c) => c.groupId));
  const projCache = buildGroupProjCache(faces, groups, up, neededIds);

  const segments: CutPreviewSegment[] = [];

  for (const cut of all) {
    const cached = projCache.get(cut.groupId);
    if (!cached) continue;
    const { proj, anchor, normal, bias } = cached;
    if (!proj) continue;

    const { uAxis, vAxis, originU, originV } = proj;
    const ring = cutToPanelRing(cut);

    // Emit cut segments on BOTH sides of the panel surface so they are always
    // visible regardless of which way the group's representativeNormal points.
    const to3 = (p: { x: number; y: number }, sign: 1 | -1): Vec3 => {
      const w = panel2DTo3D(p.x + originU, p.y + originV, uAxis, vAxis, anchor);
      return {
        x: w.x + normal.x * bias * sign,
        y: w.y + normal.y * bias * sign,
        z: w.z + normal.z * bias * sign,
      };
    };

    if (cut.kind === "line") {
      for (const sign of [1, -1] as const) {
        segments.push({ groupId: cut.groupId, normal, a: to3(ring[0], sign), b: to3(ring[1], sign) });
      }
      continue;
    }

    for (let i = 0; i + 1 < ring.length; i++) {
      for (const sign of [1, -1] as const) {
        segments.push({ groupId: cut.groupId, normal, a: to3(ring[i], sign), b: to3(ring[i + 1], sign) });
      }
    }
  }

  return segments;
}

/**
 * Static projection of a panel group: UV axes, origin offsets, and normal.
 * Cache this on pointer-down so subsequent pointer-move events can do cheap
 * ray-plane intersections instead of full scene raycasts.
 */
export interface PanelProjection {
  uAxis: Vec3;
  vAxis: Vec3;
  /** Panel outward normal (unit vector). */
  normal: Vec3;
  originU: number;
  originV: number;
}

export function getGroupProjection(
  faces: Face3D[],
  group: GeometryGroup,
  up: UpAxis,
): PanelProjection | null {
  const groupFaces = group.faceIndices
    .map((fi) => faces[fi])
    .filter((f): f is Face3D => !!f && f.vertices.length >= 3);
  if (groupFaces.length === 0) return null;

  const proj = projectFacesTo2D(groupFaces, group.representativeNormal, up);
  if (!proj) return null;

  const nlen = Math.hypot(
    group.representativeNormal.x,
    group.representativeNormal.y,
    group.representativeNormal.z,
  );
  const normal: Vec3 =
    nlen > 1e-6
      ? {
          x: group.representativeNormal.x / nlen,
          y: group.representativeNormal.y / nlen,
          z: group.representativeNormal.z / nlen,
        }
      : { ...group.representativeNormal };

  return {
    uAxis: proj.uAxis,
    vAxis: proj.vAxis,
    normal,
    originU: proj.originU,
    originV: proj.originV,
  };
}

/** World-space UV on a hit group's panel (normalised panel metres). */
export function worldPointToPanelUV(
  point: Vec3,
  faces: Face3D[],
  group: GeometryGroup,
  up: UpAxis,
): { u: number; v: number } | null {
  const groupFaces = group.faceIndices
    .map((fi) => faces[fi])
    .filter((f): f is Face3D => !!f && f.vertices.length >= 3);
  if (groupFaces.length === 0) return null;

  const proj = projectFacesTo2D(groupFaces, group.representativeNormal, up);
  if (!proj) return null;

  const absU = dot(point, proj.uAxis);
  const absV = dot(point, proj.vAxis);
  return { u: absU - proj.originU, v: absV - proj.originV };
}

export function panelUVToWorldPoint(
  u: number,
  v: number,
  faces: Face3D[],
  group: GeometryGroup,
  up: UpAxis,
): Vec3 | null {
  const groupFaces = group.faceIndices
    .map((fi) => faces[fi])
    .filter((f): f is Face3D => !!f && f.vertices.length >= 3);
  if (groupFaces.length === 0) return null;

  const proj = projectFacesTo2D(groupFaces, group.representativeNormal, up);
  if (!proj) return null;

  const anchor = groupFaces[0].vertices[0];
  return panel2DTo3D(u + proj.originU, v + proj.originV, proj.uAxis, proj.vAxis, anchor);
}
