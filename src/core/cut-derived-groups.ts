/**
 * Split geometry groups in the review viewer when user cuts produce new pieces.
 * Each remaining fragment and each extracted cut-out becomes its own selectable
 * `GeometryGroup` (negative ids). The original parent is hidden while splits exist.
 */
import type { Face3D, Vec3 } from "@/core/types";
import { dot } from "@/core/types";
import type { GeometryGroup } from "@/core/group-classifier";
import { projectFacesTo2D, type UpAxis } from "@/core/panel-projection";
import {
  applyUserCutsToPanel,
  cutShapePolygon,
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

function triangleCentroidUV(
  face: Face3D,
  i0: number,
  i1: number,
  i2: number,
  frame: PanelFrame,
): { u: number; v: number } {
  const a = face.vertices[i0];
  const b = face.vertices[i1];
  const c = face.vertices[i2];
  const cx = (a.x + b.x + c.x) / 3;
  const cy = (a.y + b.y + c.y) / 3;
  const cz = (a.z + b.z + c.z) / 3;
  return vertexToUV({ x: cx, y: cy, z: cz }, frame);
}

function fanTriangles(vertexCount: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 1; i + 1 < vertexCount; i++) out.push([0, i, i + 1]);
  return out;
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

function assignTriangleOwner(
  u: number,
  v: number,
  remainPieces: PiecePoly[],
  extractPieces: { ring: [number, number][]; cutIndex: number }[],
  pieceCentroids: { u: number; v: number }[],
): { kind: "split"; index: number } | { kind: "extract"; index: number } | null {
  for (let pi = 0; pi < remainPieces.length; pi++) {
    if (pointInPiece(u, v, remainPieces[pi])) {
      return { kind: "split", index: pi };
    }
  }

  for (const ex of extractPieces) {
    if (pointInRing(u, v, ex.ring)) {
      return { kind: "extract", index: ex.cutIndex };
    }
  }

  if (remainPieces.length === 0) return null;

  let best = 0;
  let bestD = Infinity;
  for (let pi = 0; pi < pieceCentroids.length; pi++) {
    const c = pieceCentroids[pi];
    const d = (u - c.u) ** 2 + (v - c.v) ** 2;
    if (d < bestD) {
      bestD = d;
      best = pi;
    }
  }
  return { kind: "split", index: best };
}

function assignTrianglesToPieces(
  parent: GeometryGroup,
  faces: Face3D[],
  frame: PanelFrame,
  remainPieces: PiecePoly[],
  extractPieces: { ring: [number, number][]; cutIndex: number }[],
): {
  splitAssignments: DerivedTriangleRef[][];
  extractAssignments: Map<number, DerivedTriangleRef[]>;
} {
  const splitAssignments = remainPieces.map(() => [] as DerivedTriangleRef[]);
  const extractAssignments = new Map<number, DerivedTriangleRef[]>();
  for (const e of extractPieces) extractAssignments.set(e.cutIndex, []);

  const pieceCentroids = remainPieces.map(pieceCentroid);

  for (const fi of parent.faceIndices) {
    const face = faces[fi];
    if (!face || face.vertices.length < 3) continue;

    for (const [i0, i1, i2] of fanTriangles(face.vertices.length)) {
      const { u, v } = triangleCentroidUV(face, i0, i1, i2, frame);
      const owner = assignTriangleOwner(u, v, remainPieces, extractPieces, pieceCentroids);
      if (!owner) continue;

      const ref: DerivedTriangleRef = { faceIndex: fi, i0, i1, i2 };
      if (owner.kind === "split") {
        splitAssignments[owner.index].push(ref);
      } else {
        extractAssignments.get(owner.index)!.push(ref);
      }
    }
  }

  return { splitAssignments, extractAssignments };
}

export interface CutDerivedGroupsResult {
  displayGroups: GeometryGroup[];
  splitParentIds: Set<number>;
  /** Explicit triangle subsets for derived groups (mesh + highlight). */
  derivedTriangles: Map<number, DerivedTriangleRef[]>;
}

const CUT_KIND_LABEL: Record<string, string> = {
  rect: "recorte",
  square: "recorte",
  circle: "círculo",
};

const EMPTY_TRIANGLES = new Map<number, DerivedTriangleRef[]>();

export function buildDisplayGroupsFromCuts(
  groups: GeometryGroup[],
  faces: Face3D[],
  userCuts: UserCut[],
  up: UpAxis,
): CutDerivedGroupsResult {
  if (userCuts.length === 0) {
    return { displayGroups: groups, splitParentIds: new Set(), derivedTriangles: EMPTY_TRIANGLES };
  }

  const allCutsByParent = new Map<number, UserCut[]>();
  for (const cut of userCuts) {
    const list = allCutsByParent.get(cut.groupId) ?? [];
    list.push(cut);
    allCutsByParent.set(cut.groupId, list);
  }

  const derivedByParent = new Map<number, GeometryGroup[]>();
  const derivedTriangles = new Map<number, DerivedTriangleRef[]>();
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
    const extractPieces: { ring: [number, number][]; cutIndex: number }[] = [];
    subtractiveCuts.forEach((cut, cutIndex) => {
      const ring = cutShapePolygon(cut, proj.widthM, proj.heightM);
      if (ring) extractPieces.push({ ring, cutIndex });
    });

    const multiPiece = remainPolys.length > 1 || extractPieces.length > 0;
    if (!multiPiece) continue;

    const { splitAssignments, extractAssignments } = assignTrianglesToPieces(
      parent,
      faces,
      frame,
      remainPolys,
      extractPieces,
    );

    const derived: GeometryGroup[] = [];

    if (remainPolys.length > 1) {
      remainPolys.forEach((_, pi) => {
        const tris = splitAssignments[pi];
        const id = toSplitPieceGroupId(parent.id, pi);
        const g = buildGroupFromTriangles(
          id,
          `${parent.label} · ${pi + 1}/${remainPolys.length}`,
          parent,
          tris,
          faces,
        );
        if (g) {
          derived.push(g);
          derivedTriangles.set(id, tris);
        }
      });
    } else if (remainPolys.length === 1) {
      const tris = splitAssignments[0];
      const id = toSplitPieceGroupId(parent.id, 0);
      const g = buildGroupFromTriangles(
        id,
        `${parent.label} · resto`,
        parent,
        tris,
        faces,
      );
      if (g) {
        derived.push(g);
        derivedTriangles.set(id, tris);
      }
    }

    subtractiveCuts.forEach((cut, cutIndex) => {
      const tris = extractAssignments.get(cutIndex) ?? [];
      if (tris.length === 0) return;
      const id = toExtractedCutGroupId(parent.id, cutIndex);
      const kindLabel = CUT_KIND_LABEL[cut.kind] ?? "recorte";
      const g = buildGroupFromTriangles(
        id,
        `${parent.label} · ${kindLabel}`,
        parent,
        tris,
        faces,
      );
      if (g) {
        derived.push(g);
        derivedTriangles.set(id, tris);
      }
    });

    if (derived.length < 2) continue;

    splitParentIds.add(parent.id);
    derivedByParent.set(parent.id, derived);
  }

  if (splitParentIds.size === 0) {
    return { displayGroups: groups, splitParentIds, derivedTriangles: EMPTY_TRIANGLES };
  }

  const displayGroups: GeometryGroup[] = [];
  for (const g of groups) {
    if (splitParentIds.has(g.id)) {
      displayGroups.push(...(derivedByParent.get(g.id) ?? []));
    } else {
      displayGroups.push(g);
    }
  }

  return { displayGroups, splitParentIds, derivedTriangles };
}
