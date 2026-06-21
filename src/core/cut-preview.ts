import type { Face3D, Vec3 } from "@/core/types";
import type { GeometryGroup } from "@/core/group-classifier";
import { projectFacesTo2D } from "@/core/panel-projection";
import type { UserCut } from "@/core/user-cuts";
import { cutShapePolygon, resolveCutDrag, type CutDragState } from "@/core/user-cuts";
import { cutDerivedParentId, type DerivedPanelPoly } from "@/core/cut-derived-groups";

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

function ringPanelPointsToSegments(
  ring: { x: number; y: number }[],
  groupId: number,
  normal: Vec3,
  to3: (p: { x: number; y: number }) => Vec3,
): CutPreviewSegment[] {
  const segments: CutPreviewSegment[] = [];
  if (ring.length < 2) return segments;

  for (let i = 0; i + 1 < ring.length; i++) {
    segments.push({
      groupId,
      normal,
      a: to3(ring[i]),
      b: to3(ring[i + 1]),
    });
  }
  return segments;
}

function cutToPanelRing(
  cut: Pick<UserCut, "kind" | "u0" | "v0" | "u1" | "v1">,
  panelWidthM: number,
  panelHeightM: number,
): { x: number; y: number }[] {
  if (cut.kind === "line") {
    const resolved = resolveCutDrag({
      groupId: 0,
      kind: cut.kind,
      u0: cut.u0,
      v0: cut.v0,
      u1: cut.u1,
      v1: cut.v1,
      shiftKey: false,
    });
    return [
      { x: resolved.u0, y: resolved.v0 },
      { x: resolved.u1, y: resolved.v1 },
    ];
  }

  const ring = cutShapePolygon(
    {
      id: "",
      groupId: 0,
      kind: cut.kind,
      u0: cut.u0,
      v0: cut.v0,
      u1: cut.u1,
      v1: cut.v1,
    },
    panelWidthM,
    panelHeightM,
  );
  if (!ring) return [];
  return ring.map(([x, y]) => ({ x, y }));
}

export function getGroupPanelSize(
  faces: Face3D[],
  group: GeometryGroup,
  up: UpAxis,
  surfaceNormal?: Vec3,
): { widthM: number; heightM: number } | null {
  const groupFaces = filterFacesBySurfaceNormal(collectGroupFaces(faces, group), surfaceNormal);
  if (groupFaces.length === 0) return null;

  const proj = projectFacesTo2D(groupFaces, projectionNormal(group, surfaceNormal), up);
  if (!proj) return null;
  return { widthM: proj.widthM, heightM: proj.heightM };
}

interface CachedGroupProj {
  proj: ReturnType<typeof projectFacesTo2D>;
  anchor: Vec3;
  normal: Vec3;
  bias: number;
}

function collectGroupFaces(faces: Face3D[], group: GeometryGroup): Face3D[] {
  return group.faceIndices
    .map((fi) => faces[fi])
    .filter((f): f is Face3D => !!f && f.vertices.length >= 3);
}

function normalizeVec3(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z);
  if (len < 1e-6) return { x: 0, y: 0, z: 1 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

// IN-PLANE projection convention MUST be identical across creation, preview
// rendering and derived geometry (buildDisplayGroupsFromCuts). That single
// authoritative convention is representativeNormal + ALL group faces. Mixing in
// surfaceNormal here shifts originU/originV and mirrors uAxis, which desyncs the
// UV mapping and makes cuts float far from the wall. surfaceNormal is used ONLY
// for the perpendicular depth offset (surfacePlacementForCut), never in-plane.
function projectionNormal(group: GeometryGroup, _surfaceNormal?: Vec3): Vec3 {
  return normalizeVec3(group.representativeNormal);
}

function filterFacesBySurfaceNormal(groupFaces: Face3D[], _surfaceNormal?: Vec3): Face3D[] {
  return groupFaces;
}

function buildCachedGroupProjForGroup(
  faces: Face3D[],
  group: GeometryGroup,
  up: UpAxis,
  surfaceNormal?: Vec3,
): CachedGroupProj | undefined {
  const groupFaces = filterFacesBySurfaceNormal(collectGroupFaces(faces, group), surfaceNormal);
  if (groupFaces.length === 0) return undefined;

  const normal = projectionNormal(group, surfaceNormal);
  const proj = projectFacesTo2D(groupFaces, normal, up);
  if (!proj) return undefined;

  return { proj, anchor: groupFaces[0].vertices[0], normal, bias: 0.006 };
}

function surfacePlacementForCut(
  cut: Pick<UserCut, "surfaceNormal" | "surfaceOffset">,
  cached: CachedGroupProj,
): { normal: Vec3; offset: number } {
  if (cut.surfaceNormal) {
    return {
      normal: normalizeVec3(cut.surfaceNormal),
      offset: (cut.surfaceOffset ?? 0) + cached.bias,
    };
  }
  // Legacy cuts without surfaceNormal: place on the projection plane with no
  // directional offset.  Using representativeNormal as direction is unsafe
  // because it can point inward (into the building), pushing the preview
  // through the wall and making it appear on the opposite face.
  return { normal: cached.normal, offset: 0 };
}

function worldOnSurface(
  u: number,
  v: number,
  cached: CachedGroupProj,
  normal: Vec3,
  offset: number,
): Vec3 {
  const proj = cached.proj!;
  const w = panel2DTo3D(
    u + proj.originU,
    v + proj.originV,
    proj.uAxis,
    proj.vAxis,
    cached.anchor,
  );
  return {
    x: w.x + normal.x * offset,
    y: w.y + normal.y * offset,
    z: w.z + normal.z * offset,
  };
}

/** Map panel UV to 3D on the clicked face (not the abstract mid-plane). */
export function panelUVToWorldOnSurface(
  u: number,
  v: number,
  faces: Face3D[],
  group: GeometryGroup,
  up: UpAxis,
  surfaceNormal?: Vec3,
  surfaceOffset?: number,
): Vec3 | null {
  const base = panelUVToWorldPoint(u, v, faces, group, up, surfaceNormal);
  if (!base) return null;
  if (!surfaceNormal) return base;
  const n = normalizeVec3(surfaceNormal);
  const off = (surfaceOffset ?? 0) + 0.006;
  return {
    x: base.x + n.x * off,
    y: base.y + n.y * off,
    z: base.z + n.z * off,
  };
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
    const cached = buildCachedGroupProjForGroup(faces, group, up);
    if (!cached) continue;
    cache.set(group.id, cached);
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
    all.push({
      id: "__draft__",
      groupId: draft.groupId,
      kind: draft.kind,
      ...r,
      surfaceNormal: draft.surfaceNormal,
      surfaceOffset: draft.surfaceOffset,
    });
  }

  if (all.length === 0) return [];

  const groupsById = new Map(groups.map((g) => [g.id, g]));
  const projCache = new Map<string, CachedGroupProj>();

  const segments: CutPreviewSegment[] = [];

  for (const cut of all) {
    const group = groupsById.get(cut.groupId);
    if (!group) continue;
    const sn = cut.surfaceNormal;
    const key = sn
      ? `${cut.groupId}:${sn.x.toFixed(3)}:${sn.y.toFixed(3)}:${sn.z.toFixed(3)}`
      : `${cut.groupId}:default`;
    let cached = projCache.get(key);
    if (!cached) {
      cached = buildCachedGroupProjForGroup(faces, group, up, sn);
      if (!cached) continue;
      projCache.set(key, cached);
    }

    const ring = cutToPanelRing(cut, cached.proj!.widthM, cached.proj!.heightM);
    if (ring.length === 0) continue;

    const { normal, offset } = surfacePlacementForCut(cut, cached);
    const to3 = (p: { x: number; y: number }): Vec3 =>
      worldOnSurface(p.x, p.y, cached, normal, offset);

    if (cut.kind === "line") {
      segments.push({ groupId: cut.groupId, normal, a: to3(ring[0]), b: to3(ring[1]) });
      continue;
    }

    segments.push(
      ...ringPanelPointsToSegments(
        ring,
        cut.groupId,
        normal,
        (p) => to3(p),
      ),
    );
  }

  return segments;
}

/** Outline of each cut-derived piece (split/ extract polygons). */
export function computeDerivedPanelOutlineSegments(
  faces: Face3D[],
  parentGroups: GeometryGroup[],
  derivedPanelPolys: Map<number, DerivedPanelPoly>,
  up: UpAxis,
  userCuts: UserCut[] = [],
): CutPreviewSegment[] {
  if (derivedPanelPolys.size === 0) return [];

  const parentIds = new Set<number>();
  for (const derivedId of derivedPanelPolys.keys()) {
    const parentId = cutDerivedParentId(derivedId);
    if (parentId != null) parentIds.add(parentId);
  }

  const projCache = buildGroupProjCache(faces, parentGroups, up, parentIds);
  const segments: CutPreviewSegment[] = [];

  for (const [derivedId, poly] of derivedPanelPolys) {
    const parentId = cutDerivedParentId(derivedId);
    if (parentId == null) continue;
    const cached = projCache.get(parentId);
    if (!cached?.proj) continue;

    const parentCut = userCuts.find((c) => c.groupId === parentId);
    const { normal, offset } = parentCut
      ? surfacePlacementForCut(parentCut, cached)
      : { normal: cached.normal, offset: cached.bias };
    const to3 = (p: { x: number; y: number }): Vec3 =>
      worldOnSurface(p.x, p.y, cached, normal, offset);

    const rings = [poly.outer, ...poly.holes];
    for (const ring of rings) {
      if (ring.length < 2) continue;
      const pts = ring.map(([x, y]) => ({ x, y }));
      segments.push(
        ...ringPanelPointsToSegments(pts, parentId, normal, to3),
      );
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
  surfaceNormal?: Vec3,
): PanelProjection | null {
  const groupFaces = filterFacesBySurfaceNormal(collectGroupFaces(faces, group), surfaceNormal);
  if (groupFaces.length === 0) return null;

  const normal = projectionNormal(group, surfaceNormal);
  const proj = projectFacesTo2D(groupFaces, normal, up);
  if (!proj) return null;

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
  surfaceNormal?: Vec3,
): { u: number; v: number } | null {
  const groupFaces = filterFacesBySurfaceNormal(collectGroupFaces(faces, group), surfaceNormal);
  if (groupFaces.length === 0) return null;

  const proj = projectFacesTo2D(groupFaces, projectionNormal(group, surfaceNormal), up);
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
  surfaceNormal?: Vec3,
): Vec3 | null {
  const groupFaces = filterFacesBySurfaceNormal(collectGroupFaces(faces, group), surfaceNormal);
  if (groupFaces.length === 0) return null;

  const proj = projectFacesTo2D(groupFaces, projectionNormal(group, surfaceNormal), up);
  if (!proj) return null;

  const anchor = groupFaces[0].vertices[0];
  return panel2DTo3D(u + proj.originU, v + proj.originV, proj.uAxis, proj.vAxis, anchor);
}
