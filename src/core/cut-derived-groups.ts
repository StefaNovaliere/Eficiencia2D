/**
 * Split geometry groups in the review viewer when user cuts produce new pieces.
 * Each remaining fragment and each extracted cut-out becomes its own selectable
 * `GeometryGroup` (negative ids). The original parent is hidden while splits exist.
 */
import type { Face3D, Vec3 } from "@/core/types";
import { dot } from "@/core/types";
import type { FaceCategory, GeometryGroup } from "@/core/group-classifier";
import { projectFacesTo2D, type UpAxis } from "@/core/panel-projection";
import {
  applyUserCutsToPanel,
  cutPanelAreaM2,
  cutShapePolygon,
  MIN_EXTRACT_PIECE_AREA_M2,
  panelPiecePolygons,
  type UserCut,
} from "@/core/user-cuts";

const SPLIT_SLOT = 0;
const EXTRACT_SLOT = 500;

export interface DerivedTriangleRef {
  faceIndex: number;
  i0: number;
  i1: number;
  i2: number;
}

export function isCutDerivedGroupId(id: number): boolean {
  return id < 0;
}

export function cutDerivedParentId(derivedId: number): number | null {
  if (derivedId >= 0) return null;
  return Math.floor((-derivedId - 1) / 1000);
}

export function toSplitPieceGroupId(parentId: number, pieceIndex: number): number {
  return -(parentId * 1000 + SPLIT_SLOT + pieceIndex + 1);
}

export function toExtractedCutGroupId(parentId: number, cutIndex: number): number {
  return -(parentId * 1000 + EXTRACT_SLOT + cutIndex + 1);
}

export function cutDerivedExtractIndex(derivedId: number): number | null {
  if (derivedId >= 0) return null;
  const slot = (-derivedId - 1) % 1000;
  if (slot < EXTRACT_SLOT) return null;
  return slot - EXTRACT_SLOT - 1;
}

/** Map derived or parent id → parent id used in `user_cuts`. */
export function cutGroupOwnerId(groupId: number): number {
  return cutDerivedParentId(groupId) ?? groupId;
}

interface PanelFrame {
  uAxis: Vec3;
  vAxis: Vec3;
  originU: number;
  originV: number;
}

function piecePolyFromPanelPiece(piece: {
  widthM: number;
  heightM: number;
  minU: number;
  minV: number;
  edges: import("@/core/panel-projection").PanelEdge[];
}): PiecePoly | null {
  const parentEdges = piece.edges.map((e) => ({
    a: { x: e.a.x + piece.minU, y: e.a.y + piece.minV },
    b: { x: e.b.x + piece.minU, y: e.b.y + piece.minV },
    hole: e.hole,
  }));
  const poly = panelPiecePolygons(parentEdges);
  if (poly) return poly;

  const w = piece.widthM;
  const h = piece.heightM;
  if (w < 0.01 || h < 0.01) return null;
  const { minU, minV } = piece;
  return {
    outer: [
      [minU, minV],
      [minU + w, minV],
      [minU + w, minV + h],
      [minU, minV + h],
      [minU, minV],
    ],
    holes: [],
  };
}

interface PiecePoly {
  outer: [number, number][];
  holes: [number, number][][];
}

/** 2D panel polygon for a cut-derived component (world lift happens in the viewer). */
export type DerivedPanelPoly = PiecePoly;

function pointInRing(u: number, v: number, ring: [number, number][]): boolean {
  let inside = false;
  const n = ring.length;
  if (n < 3) return false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if ((yi > v) !== (yj > v) && u < ((xj - xi) * (v - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInPiece(u: number, v: number, piece: PiecePoly): boolean {
  if (!pointInRing(u, v, piece.outer)) return false;
  for (const hole of piece.holes) {
    if (pointInRing(u, v, hole)) return false;
  }
  return true;
}

function pieceCentroid(piece: PiecePoly): { u: number; v: number } {
  const ring = piece.outer;
  let u = 0;
  let v = 0;
  const n = Math.max(1, ring.length - 1);
  for (let i = 0; i < n; i++) {
    u += ring[i][0];
    v += ring[i][1];
  }
  return { u: u / n, v: v / n };
}

function vertexToUV(v: Vec3, frame: PanelFrame): { u: number; v: number } {
  return {
    u: dot(v, frame.uAxis) - frame.originU,
    v: dot(v, frame.vAxis) - frame.originV,
  };
}

function fanTriangles(vertexCount: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 1; i + 1 < vertexCount; i++) out.push([0, i, i + 1]);
  return out;
}

function piecePolyArea(poly: PiecePoly): number {
  let area = Math.abs(ringArea2D(poly.outer));
  for (const hole of poly.holes) {
    area -= Math.abs(ringArea2D(hole));
  }
  return Math.max(0, area);
}

function ringArea2D(ring: [number, number][]): number {
  let a = 0;
  for (let i = 0; i + 1 < ring.length; i++) {
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return a / 2;
}

function buildGroupFromPanelPoly(
  id: number,
  label: string,
  parent: GeometryGroup,
  poly: PiecePoly,
  category?: FaceCategory,
): GeometryGroup | null {
  const area = piecePolyArea(poly);
  if (area < 1e-6) return null;
  return {
    id,
    label,
    category: category ?? parent.category,
    faceIndices: [...parent.faceIndices],
    totalArea: area,
    centroid: { ...parent.centroid },
    orientation: parent.orientation,
    representativeNormal: parent.representativeNormal,
    thickness: parent.thickness,
    minY: parent.minY,
    maxY: parent.maxY,
    originalCategory: parent.originalCategory,
  };
}

function buildGroupFromTriangles(
  id: number,
  label: string,
  parent: GeometryGroup,
  tris: DerivedTriangleRef[],
  faces: Face3D[],
): GeometryGroup | null {
  if (tris.length === 0) return null;

  let totalArea = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  const faceSet = new Set<number>();

  for (const { faceIndex, i0, i1, i2 } of tris) {
    faceSet.add(faceIndex);
    const face = faces[faceIndex];
    if (!face) continue;
    const va = face.vertices[i0];
    const vb = face.vertices[i1];
    const vc = face.vertices[i2];
    const ab = { x: vb.x - va.x, y: vb.y - va.y, z: vb.z - va.z };
    const ac = { x: vc.x - va.x, y: vc.y - va.y, z: vc.z - va.z };
    const cross = {
      x: ab.y * ac.z - ab.z * ac.y,
      y: ab.z * ac.x - ab.x * ac.z,
      z: ab.x * ac.y - ab.y * ac.x,
    };
    const area = Math.hypot(cross.x, cross.y, cross.z) / 2;
    if (area < 1e-12) continue;
    totalArea += area;
    const triCx = (va.x + vb.x + vc.x) / 3;
    const triCy = (va.y + vb.y + vc.y) / 3;
    const triCz = (va.z + vb.z + vc.z) / 3;
    cx += triCx * area;
    cy += triCy * area;
    cz += triCz * area;
  }

  if (totalArea < 1e-6) return null;
  const inv = 1 / totalArea;

  return {
    id,
    label,
    category: parent.category,
    faceIndices: [...faceSet],
    totalArea,
    centroid: { x: cx * inv, y: cy * inv, z: cz * inv },
    orientation: parent.orientation,
    representativeNormal: parent.representativeNormal,
    thickness: parent.thickness,
    minY: parent.minY,
    maxY: parent.maxY,
    originalCategory: parent.originalCategory,
  };
}

type UV = { u: number; v: number };

function pointInTriangle(u: number, v: number, a: UV, b: UV, c: UV): boolean {
  const sign = (p1: UV, p2: UV, p3: UV) =>
    (p1.u - p3.u) * (p2.v - p3.v) - (p2.u - p3.u) * (p1.v - p3.v);
  const p = { u, v };
  const d1 = sign(p, a, b);
  const d2 = sign(p, b, c);
  const d3 = sign(p, c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function triangleSamplePoints(a: UV, b: UV, c: UV): UV[] {
  const out: UV[] = [
    { u: (a.u + b.u + c.u) / 3, v: (a.v + b.v + c.v) / 3 },
    a,
    b,
    c,
    { u: (a.u + b.u) / 2, v: (a.v + b.v) / 2 },
    { u: (b.u + c.u) / 2, v: (b.v + c.v) / 2 },
    { u: (c.u + a.u) / 2, v: (c.v + a.v) / 2 },
  ];

  for (let i = 1; i <= 4; i++) {
    for (let j = 1; j <= 4 - i; j++) {
      const k = 4 - i - j;
      out.push({
        u: (i * a.u + j * b.u + k * c.u) / 4,
        v: (i * a.v + j * b.v + k * c.v) / 4,
      });
    }
  }

  return out;
}

function countSamplesInRing(samples: UV[], ring: [number, number][]): number {
  return samples.filter((s) => pointInRing(s.u, s.v, ring)).length;
}

function countSamplesInPiece(samples: UV[], piece: PiecePoly): number {
  return samples.filter((s) => pointInPiece(s.u, s.v, piece)).length;
}

function ringHasPointInsideTriangle(
  ring: [number, number][],
  a: UV,
  b: UV,
  c: UV,
): boolean {
  for (const [ru, rv] of ring) {
    if (pointInTriangle(ru, rv, a, b, c)) return true;
  }
  return false;
}

function assignTriangleOwner(
  a: UV,
  b: UV,
  c: UV,
  remainPieces: PiecePoly[],
  extractPieces: { ring: [number, number][]; cutIndex: number }[],
  pieceCentroids: { u: number; v: number }[],
): { kind: "split"; index: number } | { kind: "extract"; index: number } | null {
  const samples = triangleSamplePoints(a, b, c);

  let bestExtractIndex = -1;
  let bestExtractCount = 0;
  for (const ex of extractPieces) {
    const count = countSamplesInRing(samples, ex.ring);
    if (count > bestExtractCount) {
      bestExtractCount = count;
      bestExtractIndex = ex.cutIndex;
    }
  }

  let bestSplitIndex = 0;
  let bestSplitCount = 0;
  for (let pi = 0; pi < remainPieces.length; pi++) {
    const count = countSamplesInPiece(samples, remainPieces[pi]);
    if (count > bestSplitCount) {
      bestSplitCount = count;
      bestSplitIndex = pi;
    }
  }

  if (bestExtractCount > bestSplitCount && bestExtractIndex >= 0) {
    return { kind: "extract", index: bestExtractIndex };
  }
  if (bestSplitCount > 0) {
    return { kind: "split", index: bestSplitIndex };
  }

  for (const ex of extractPieces) {
    if (ringHasPointInsideTriangle(ex.ring, a, b, c)) {
      return { kind: "extract", index: ex.cutIndex };
    }
  }

  if (remainPieces.length === 0) return null;

  const centroid = samples[0];
  let best = 0;
  let bestD = Infinity;
  for (let pi = 0; pi < pieceCentroids.length; pi++) {
    const pc = pieceCentroids[pi];
    const d = (centroid.u - pc.u) ** 2 + (centroid.v - pc.v) ** 2;
    if (d < bestD) {
      bestD = d;
      best = pi;
    }
  }
  return { kind: "split", index: best };
}

function triangleMatchesSurface(
  face: Face3D,
  surfaceNormal?: Vec3,
): boolean {
  if (!surfaceNormal) return true;
  const d = dot(face.normal, surfaceNormal);
  return d > 0.25;
}

function assignTrianglesToPieces(
  parent: GeometryGroup,
  faces: Face3D[],
  frame: PanelFrame,
  remainPieces: PiecePoly[],
  extractPieces: { ring: [number, number][]; cutIndex: number }[],
  surfaceNormal?: Vec3,
): {
  splitAssignments: DerivedTriangleRef[][];
  extractAssignments: Map<number, DerivedTriangleRef[]>;
} {
  const splitAssignments = remainPieces.map(() => [] as DerivedTriangleRef[]);
  const extractAssignments = new Map<number, DerivedTriangleRef[]>();
  for (const e of extractPieces) extractAssignments.set(e.cutIndex, []);

  const pieceCentroids = remainPieces.map(pieceCentroid);
  const extractOverlapByTri = new Map<string, Map<number, number>>();

  const triKey = (ref: DerivedTriangleRef) =>
    `${ref.faceIndex}:${ref.i0}:${ref.i1}:${ref.i2}`;

  for (const fi of parent.faceIndices) {
    const face = faces[fi];
    if (!face || face.vertices.length < 3) continue;
    if (!triangleMatchesSurface(face, surfaceNormal)) continue;

    for (const [i0, i1, i2] of fanTriangles(face.vertices.length)) {
      const uv0 = vertexToUV(face.vertices[i0], frame);
      const uv1 = vertexToUV(face.vertices[i1], frame);
      const uv2 = vertexToUV(face.vertices[i2], frame);
      const ref: DerivedTriangleRef = { faceIndex: fi, i0, i1, i2 };
      const samples = triangleSamplePoints(uv0, uv1, uv2);

      const overlap = new Map<number, number>();
      for (const ex of extractPieces) {
        const count = countSamplesInRing(samples, ex.ring);
        if (count > 0) overlap.set(ex.cutIndex, count);
      }
      if (overlap.size > 0) extractOverlapByTri.set(triKey(ref), overlap);

      const owner = assignTriangleOwner(
        uv0,
        uv1,
        uv2,
        remainPieces,
        extractPieces,
        pieceCentroids,
      );
      if (!owner) continue;

      if (owner.kind === "split") {
        splitAssignments[owner.index].push(ref);
      } else {
        extractAssignments.get(owner.index)!.push(ref);
      }
    }
  }

  for (const ex of extractPieces) {
    if ((extractAssignments.get(ex.cutIndex)?.length ?? 0) > 0) continue;

    let bestRef: DerivedTriangleRef | null = null;
    let bestCount = 0;
    for (const [key, overlap] of extractOverlapByTri.entries()) {
      const count = overlap.get(ex.cutIndex) ?? 0;
      if (count <= bestCount) continue;
      bestCount = count;
      const [faceIndex, i0, i1, i2] = key.split(":").map(Number);
      bestRef = { faceIndex, i0, i1, i2 };
    }
    if (!bestRef) continue;

    for (const bucket of splitAssignments) {
      const idx = bucket.findIndex(
        (t) =>
          t.faceIndex === bestRef!.faceIndex &&
          t.i0 === bestRef!.i0 &&
          t.i1 === bestRef!.i1 &&
          t.i2 === bestRef!.i2,
      );
      if (idx >= 0) bucket.splice(idx, 1);
    }
    extractAssignments.get(ex.cutIndex)!.push(bestRef);
  }

  return { splitAssignments, extractAssignments };
}

export interface CutDerivedGroupsResult {
  displayGroups: GeometryGroup[];
  splitParentIds: Set<number>;
  /** Explicit triangle subsets for derived groups (mesh + highlight). */
  derivedTriangles: Map<number, DerivedTriangleRef[]>;
  /** Exact 2D panel shape per derived group (circle, rect, split piece). */
  derivedPanelPolys: Map<number, DerivedPanelPoly>;
}

const CUT_KIND_LABEL: Record<string, string> = {
  rect: "recorte",
  square: "recorte",
  circle: "círculo",
};

const EMPTY_TRIANGLES = new Map<number, DerivedTriangleRef[]>();
const EMPTY_PANEL_POLYS = new Map<number, DerivedPanelPoly>();

export function buildDisplayGroupsFromCuts(
  groups: GeometryGroup[],
  faces: Face3D[],
  userCuts: UserCut[],
  up: UpAxis,
): CutDerivedGroupsResult {
  if (userCuts.length === 0) {
    return {
      displayGroups: groups,
      splitParentIds: new Set(),
      derivedTriangles: EMPTY_TRIANGLES,
      derivedPanelPolys: EMPTY_PANEL_POLYS,
    };
  }

  const allCutsByParent = new Map<number, UserCut[]>();
  for (const cut of userCuts) {
    const list = allCutsByParent.get(cut.groupId) ?? [];
    list.push(cut);
    allCutsByParent.set(cut.groupId, list);
  }

  const derivedByParent = new Map<number, GeometryGroup[]>();
  const derivedTriangles = new Map<number, DerivedTriangleRef[]>();
  const derivedPanelPolys = new Map<number, DerivedPanelPoly>();
  const splitParentIds = new Set<number>();

  for (const parent of groups) {
    const cuts = allCutsByParent.get(parent.id);
    if (!cuts || cuts.length === 0) continue;

    const groupFaces = parent.faceIndices
      .map((fi) => faces[fi])
      .filter((f): f is Face3D => !!f && f.vertices.length >= 3);
    if (groupFaces.length === 0) continue;

    const proj = projectFacesTo2D(groupFaces, parent.representativeNormal, up);
    if (!proj) continue;

    const frame: PanelFrame = {
      uAxis: proj.uAxis,
      vAxis: proj.vAxis,
      originU: proj.originU,
      originV: proj.originV,
    };

    const pieces = applyUserCutsToPanel(proj.widthM, proj.heightM, proj.edges, cuts);
    const remainPolys: PiecePoly[] = [];
    for (const piece of pieces) {
      const poly = piecePolyFromPanelPiece(piece);
      if (poly) remainPolys.push(poly);
    }

    const subtractiveCuts = cuts.filter((c) => c.kind !== "line");
    const dominantSurface = cuts.find((c) => c.surfaceNormal)?.surfaceNormal;

    // Large cut-outs become separate selectable pieces; tiny ones stay as holes only.
    const significantExtracts: { cut: UserCut; cutIndex: number; ring: [number, number][] }[] = [];
    const extractPiecesForAssignment: { ring: [number, number][]; cutIndex: number }[] = [];
    subtractiveCuts.forEach((cut, cutIndex) => {
      const ring = cutShapePolygon(cut, proj.widthM, proj.heightM);
      if (!ring) return;
      extractPiecesForAssignment.push({ ring, cutIndex });
      const area = cutPanelAreaM2(cut, proj.widthM, proj.heightM);
      if (area >= MIN_EXTRACT_PIECE_AREA_M2) {
        significantExtracts.push({ cut, cutIndex, ring });
      }
    });

    const extractPieces = extractPiecesForAssignment;

    const hasSubtractiveCuts = subtractiveCuts.length > 0;
    const shouldDerive =
      remainPolys.length > 1 ||
      (remainPolys.length >= 1 && (hasSubtractiveCuts || extractPieces.length > 0));

    // Never hide the parent if boolean ops consumed the whole panel — that would
    // erase the wall entirely and leave only floating cut-out shards.
    if (!shouldDerive || remainPolys.length === 0) continue;

    const hasOppositeFaces = groupFaces.some(
      (f) => dot(f.normal, parent.representativeNormal) < -0.5,
    );
    const surfaceFilter = hasOppositeFaces ? dominantSurface : undefined;

    const { splitAssignments, extractAssignments } = assignTrianglesToPieces(
      parent,
      faces,
      frame,
      remainPolys,
      extractPieces,
      surfaceFilter,
    );

    const derived: GeometryGroup[] = [];

    const addSplitPiece = (
      poly: PiecePoly,
      pi: number,
      label: string,
      tris: DerivedTriangleRef[],
    ) => {
      const id = toSplitPieceGroupId(parent.id, pi);
      // Build a group. We need it for category/centroid/id even when we render
      // via the panel poly, so fall back to buildGroupFromPanelPoly if no tris.
      const g =
        buildGroupFromTriangles(id, label, parent, tris, faces) ??
        buildGroupFromPanelPoly(id, label, parent, poly, parent.category);
      if (!g) return;
      derived.push(g);
      derivedTriangles.set(id, tris);
      // Always set the panel poly so the viewer can triangulate it with proper
      // holes (the triangle subset alone cannot carve clean holes from a wall).
      derivedPanelPolys.set(id, { outer: poly.outer, holes: poly.holes });
    };

    if (remainPolys.length > 1) {
      remainPolys.forEach((poly, pi) => {
        addSplitPiece(
          poly,
          pi,
          `${parent.label} · ${pi + 1}/${remainPolys.length}`,
          splitAssignments[pi] ?? [],
        );
      });
    } else if (remainPolys.length === 1) {
      addSplitPiece(
        remainPolys[0],
        0,
        `${parent.label} · resto`,
        splitAssignments[0] ?? [],
      );
    }

    significantExtracts.forEach(({ cut, cutIndex, ring }) => {
      const tris = extractAssignments.get(cutIndex) ?? [];
      const id = toExtractedCutGroupId(parent.id, cutIndex);
      const kindLabel = CUT_KIND_LABEL[cut.kind] ?? "recorte";
      const area = cutPanelAreaM2(cut, proj.widthM, proj.heightM);
      const category: FaceCategory =
        area < MIN_EXTRACT_PIECE_AREA_M2 ? "discard" : parent.category;
      const g =
        buildGroupFromTriangles(
          id,
          `${parent.label} · ${kindLabel}`,
          parent,
          tris,
          faces,
        ) ??
        buildGroupFromPanelPoly(
          id,
          `${parent.label} · ${kindLabel}`,
          parent,
          { outer: ring, holes: [] },
          category,
        );
      if (!g) return;
      if (category === "discard") g.category = "discard";
      derived.push(g);
      derivedTriangles.set(id, tris);
      derivedPanelPolys.set(id, { outer: ring, holes: [] });
    });

    if (derived.length < 1) continue;

    // Never hide the parent unless the resto piece has a renderable panel poly.
    // (Triangle subsets alone can't carve clean holes, so we gate on the poly.)
    const restoPieces = derived.filter((g) => cutDerivedExtractIndex(g.id) === null);
    const restoHasPoly = restoPieces.some((g) => {
      const poly = derivedPanelPolys.get(g.id);
      return poly != null && piecePolyArea(poly) > 1e-6;
    });
    if (!restoHasPoly) continue;

    splitParentIds.add(parent.id);
    derivedByParent.set(parent.id, derived);
  }

  if (splitParentIds.size === 0) {
    return {
      displayGroups: groups,
      splitParentIds,
      derivedTriangles: EMPTY_TRIANGLES,
      derivedPanelPolys: EMPTY_PANEL_POLYS,
    };
  }

  const displayGroups: GeometryGroup[] = [];
  for (const g of groups) {
    if (splitParentIds.has(g.id)) {
      displayGroups.push(...(derivedByParent.get(g.id) ?? []));
    } else {
      displayGroups.push(g);
    }
  }

  return { displayGroups, splitParentIds, derivedTriangles, derivedPanelPolys };
}
