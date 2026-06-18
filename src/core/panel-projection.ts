// ============================================================================
// Panel projection (PREVIEW ONLY)
//
// Cliente delgado: el backend es dueño de la geometría de salida (DXF/PDF).
// Este módulo conserva SÓLO la proyección panel→2D necesaria para el PREVIEW en
// vivo de la herramienta de cortes en el visor 3D (mapear mouse↔UV del panel y
// dibujar el contorno). No produce geometría autoritativa: la salida real la
// genera el backend aplicando `user_cuts`.
//
// Extraído del antiguo `cutting-sheet.ts` (commit a9ef681): `projectFacesTo2D`
// y sus helpers transitivos, sin el resto del motor de decomposición/DXF.
// ============================================================================

import type { Face3D, Vec2, Vec3 } from "./types";
import { cross, dot, getVertexIndices, normalize, sub, vlength } from "./types";
import { union } from "polyclip-ts";

const NEAR_PARALLEL_EPS = 0.01; // cross product near-zero threshold for degenerate axis

export type UpAxis = "Y" | "Z";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getUpVec(up: UpAxis): Vec3 {
  return up === "Y" ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
}

/** Snap to 2 decimal places (~1cm tolerance) for robust edge matching. */
function snap(v: number): number {
  return Math.round(v * 100) / 100;
}

function vertKey(x: number, y: number): string {
  return `${snap(x)},${snap(y)}`;
}

function edgeKey(ax: number, ay: number, bx: number, by: number): string {
  const a = vertKey(ax, ay);
  const b = vertKey(bx, by);
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Minimum hole area (m²) to keep — discards mesh-noise holes, keeps real
 *  windows/doors (5cm × 5cm = 0.0025 m²). Applied only to inner rings. */
const MIN_HOLE_AREA = 0.0025;

/** Signed shoelace area of a closed 2D ring (first point == last point). */
function ring2DArea(ring: ReadonlyArray<readonly [number, number]>): number {
  let a = 0;
  for (let i = 0; i + 1 < ring.length; i++) {
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return a / 2;
}

// ---------------------------------------------------------------------------
// Panel edge type
// ---------------------------------------------------------------------------

/** A 2D contour edge. `hole` marks edges belonging to an inner ring (a
 *  window/door opening) rather than the outer silhouette. */
export interface PanelEdge {
  a: Vec2;
  b: Vec2;
  hole?: boolean;
}

// ---------------------------------------------------------------------------
// Contour tracing
// ---------------------------------------------------------------------------

type RawEdge = {
  ax: number; ay: number; bx: number; by: number;
  via?: number;
  vib?: number;
  /** Inner-ring (window/door opening) edge — not part of the outer silhouette. */
  hole?: boolean;
};

/**
 * Filter boundary edges to keep only those forming closed contour loops
 * (outer boundary + holes). Removes stray edges from mesh artifacts.
 *
 * Uses half-edge (dart) face traversal of the planar edge graph. Every
 * undirected edge yields two darts; each dart belongs to exactly one traced
 * face, so no legitimate edge is ever lost — even at T-junctions where three
 * or more edges meet.
 *
 * Keep rule: an edge is part of a real contour iff its two darts belong to
 * traced faces of OPPOSITE winding (one CCW interior, one CW exterior/hole
 * boundary). Internal chords are discarded.
 */
export function traceContours(boundaryEdges: RawEdge[]): RawEdge[] {
  if (boundaryEdges.length <= 2) return boundaryEdges;

  function vertId(e: RawEdge, side: "a" | "b"): string {
    if (side === "a") return e.via !== undefined ? `i${e.via}` : vertKey(e.ax, e.ay);
    return e.vib !== undefined ? `i${e.vib}` : vertKey(e.bx, e.by);
  }

  // Build adjacency: vertex → list of edge indices.
  const adj = new Map<string, number[]>();
  function addAdj(vk: string, ei: number) {
    const arr = adj.get(vk);
    if (arr) arr.push(ei);
    else adj.set(vk, [ei]);
  }
  for (let i = 0; i < boundaryEdges.length; i++) {
    const e = boundaryEdges[i];
    addAdj(vertId(e, "a"), i);
    addAdj(vertId(e, "b"), i);
  }

  // Iterative leaf pruning: remove edges connected to degree-1 vertices.
  const removed = new Set<number>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [vk, indices] of adj) {
      const live = indices.filter((i) => !removed.has(i));
      if (live.length === 1) {
        removed.add(live[0]);
        changed = true;
      }
      adj.set(vk, live.length <= 1 ? [] : live);
    }
  }

  // Coordinates of a vertex key (for angle + area computation).
  const vertCoord = new Map<string, { x: number; y: number }>();
  for (const e of boundaryEdges) {
    const ak = vertId(e, "a");
    const bk = vertId(e, "b");
    if (!vertCoord.has(ak)) vertCoord.set(ak, { x: e.ax, y: e.ay });
    if (!vertCoord.has(bk)) vertCoord.set(bk, { x: e.bx, y: e.by });
  }

  // A dart is a directed traversal of an edge. id = edgeIndex*2 + dir.
  //   dir 0: a → b,  dir 1: b → a
  const liveEdges: number[] = [];
  for (let i = 0; i < boundaryEdges.length; i++) {
    if (!removed.has(i)) liveEdges.push(i);
  }
  if (liveEdges.length === 0) return [];

  function dartFrom(dart: number): string {
    const ei = dart >> 1;
    const e = boundaryEdges[ei];
    return (dart & 1) === 0 ? vertId(e, "a") : vertId(e, "b");
  }
  function dartTo(dart: number): string {
    const ei = dart >> 1;
    const e = boundaryEdges[ei];
    return (dart & 1) === 0 ? vertId(e, "b") : vertId(e, "a");
  }
  function dartAngle(dart: number): number {
    const from = vertCoord.get(dartFrom(dart))!;
    const to = vertCoord.get(dartTo(dart))!;
    return Math.atan2(to.y - from.y, to.x - from.x);
  }

  // Outgoing darts per vertex, sorted CCW by angle.
  const outgoing = new Map<string, number[]>();
  for (const ei of liveEdges) {
    for (const dir of [0, 1]) {
      const dart = ei * 2 + dir;
      const from = dartFrom(dart);
      const arr = outgoing.get(from);
      if (arr) arr.push(dart);
      else outgoing.set(from, [dart]);
    }
  }
  for (const arr of outgoing.values()) {
    arr.sort((d1, d2) => dartAngle(d1) - dartAngle(d2));
  }

  // Next dart around a face.
  function nextDart(dart: number): number {
    const w = dartTo(dart);
    const arr = outgoing.get(w)!;
    const twin = (dart & 1) === 0 ? (dart >> 1) * 2 + 1 : (dart >> 1) * 2;
    const idx = arr.indexOf(twin);
    const prev = (idx - 1 + arr.length) % arr.length;
    return arr[prev];
  }

  // Traverse all faces. Each face is a closed dart loop.
  const dartFace = new Map<number, number>();
  const faceSign: number[] = [];
  let faceId = 0;

  for (const ei of liveEdges) {
    for (const dir of [0, 1]) {
      const start = ei * 2 + dir;
      if (dartFace.has(start)) continue;

      const loopDarts: number[] = [];
      let d = start;
      let guard = 0;
      const limit = liveEdges.length * 2 + 4;
      do {
        if (dartFace.has(d)) break;
        dartFace.set(d, faceId);
        loopDarts.push(d);
        d = nextDart(d);
      } while (d !== start && guard++ < limit);

      let area2 = 0;
      for (const dd of loopDarts) {
        const from = vertCoord.get(dartFrom(dd))!;
        const to = vertCoord.get(dartTo(dd))!;
        area2 += from.x * to.y - to.x * from.y;
      }
      faceSign.push(Math.sign(area2));
      faceId++;
    }
  }

  // Keep an edge iff its two darts border faces of opposite winding.
  const kept = new Set<number>();
  for (const ei of liveEdges) {
    const f0 = dartFace.get(ei * 2);
    const f1 = dartFace.get(ei * 2 + 1);
    if (f0 === undefined || f1 === undefined) continue;
    const s0 = faceSign[f0];
    const s1 = faceSign[f1];
    if (s0 !== 0 && s1 !== 0 && s0 !== s1) kept.add(ei);
  }

  return boundaryEdges.filter((_, i) => kept.has(i));
}

// ---------------------------------------------------------------------------
// Project coplanar faces to 2D and extract boundary edges
// ---------------------------------------------------------------------------

/** Round to ~0.1mm so two coincident skins of a thick wall merge exactly. */
const UNION_SNAP = 1e4;
function snapUnion(v: number): number {
  return Math.round(v * UNION_SNAP) / UNION_SNAP;
}

/**
 * Boolean union of all face polygons projected onto (uAxis, vAxis).
 * Returns the outer silhouette + real holes as contour edges, or null if the
 * union is degenerate (caller falls back to the legacy edge-count method).
 */
function unionOutline(faces: Face3D[], uAxis: Vec3, vAxis: Vec3): RawEdge[] | null {
  const polys: Array<Array<[number, number]>[]> = [];
  for (const face of faces) {
    const ring: Array<[number, number]> = face.vertices.map(
      (v) => [snapUnion(dot(v, uAxis)), snapUnion(dot(v, vAxis))],
    );
    if (ring.length < 3) continue;
    if (Math.abs(ring2DArea(ring)) < 1e-7) continue; // edge-on face → ~0 area
    polys.push([ring]);
  }
  if (polys.length === 0) return null;

  let merged;
  try {
    merged = union(polys[0], ...polys.slice(1));
  } catch {
    return null;
  }

  const out: RawEdge[] = [];
  for (const poly of merged) {
    for (let ri = 0; ri < poly.length; ri++) {
      const ring = poly[ri];
      if (ri >= 1 && Math.abs(ring2DArea(ring)) < MIN_HOLE_AREA) continue;
      const isHole = ri >= 1;
      for (let i = 0; i + 1 < ring.length; i++) {
        out.push({
          ax: ring[i][0], ay: ring[i][1],
          bx: ring[i + 1][0], by: ring[i + 1][1],
          hole: isHole,
        });
      }
    }
  }
  return out.length > 0 ? out : null;
}

/**
 * Legacy boundary extraction: keep edges belonging to exactly one face, then
 * trace closed contours. Used as a fallback when the polygon union fails.
 */
function legacyBoundary(faces: Face3D[], uAxis: Vec3, vAxis: Vec3): RawEdge[] {
  const edgeFaceCount = new Map<string, number>();
  const edgeCoords = new Map<string, RawEdge>();

  for (const face of faces) {
    const pts: Vec2[] = face.vertices.map((v) => ({
      x: dot(v, uAxis),
      y: dot(v, vAxis),
    }));
    const vi = getVertexIndices(face);

    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      const key = vi
        ? (vi[i] < vi[j] ? `${vi[i]}|${vi[j]}` : `${vi[j]}|${vi[i]}`)
        : edgeKey(pts[i].x, pts[i].y, pts[j].x, pts[j].y);
      edgeFaceCount.set(key, (edgeFaceCount.get(key) ?? 0) + 1);
      if (!edgeCoords.has(key)) {
        edgeCoords.set(key, {
          ax: pts[i].x, ay: pts[i].y,
          bx: pts[j].x, by: pts[j].y,
          via: vi ? vi[i] : undefined,
          vib: vi ? vi[j] : undefined,
        });
      }
    }
  }

  const boundaryEdges: RawEdge[] = [];
  for (const [key, count] of edgeFaceCount) {
    if (count === 1) boundaryEdges.push(edgeCoords.get(key)!);
  }
  if (boundaryEdges.length === 0) return [];

  return traceContours(boundaryEdges);
}

function buildPanelProjectionAxes(
  groupNormal: Vec3,
  up: UpAxis,
): { uAxis: Vec3; vAxis: Vec3 } {
  const worldUp = getUpVec(up);
  let uAxis: Vec3 = normalize(cross(worldUp, groupNormal));
  let vAxis: Vec3;

  if (vlength(uAxis) < NEAR_PARALLEL_EPS) {
    uAxis = { x: 1, y: 0, z: 0 };
    vAxis = normalize(cross(groupNormal, uAxis));
    if (vlength(vAxis) < NEAR_PARALLEL_EPS) {
      vAxis = up === "Y" ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
    }
  } else {
    vAxis = normalize(cross(groupNormal, uAxis));
  }

  return { uAxis, vAxis };
}

/**
 * Proyecta un grupo de caras coplanares a 2D y extrae su contorno (silueta +
 * huecos). Devuelve ancho/alto, los ejes/origen de proyección (para mapear
 * puntos 3D↔UV del panel) o `null` si el grupo es degenerado.
 *
 * Usado SÓLO para el preview de cortes en el visor; no es geometría de salida.
 */
export function projectFacesTo2D(
  faces: Face3D[],
  groupNormal: Vec3,
  up: UpAxis,
): {
  widthM: number;
  heightM: number;
  edges: PanelEdge[];
  /** dot(vAxis, worldUp): >0 ⇒ 2D +y points up; <0 ⇒ 2D +y points down. */
  vUp: number;
  /** Projection axes and origin offsets — to project 3D points into 2D. */
  uAxis: Vec3;
  vAxis: Vec3;
  originU: number;
  originV: number;
} | null {
  if (faces.length === 0) return null;

  const { uAxis, vAxis } = buildPanelProjectionAxes(groupNormal, up);
  const worldUp = getUpVec(up);

  const contoured = unionOutline(faces, uAxis, vAxis) ?? legacyBoundary(faces, uAxis, vAxis);
  if (!contoured || contoured.length === 0) return null;

  let minU = Infinity, maxU = -Infinity;
  let minV = Infinity, maxV = -Infinity;

  for (const e of contoured) {
    minU = Math.min(minU, e.ax, e.bx);
    maxU = Math.max(maxU, e.ax, e.bx);
    minV = Math.min(minV, e.ay, e.by);
    maxV = Math.max(maxV, e.ay, e.by);
  }

  const w = maxU - minU;
  const h = maxV - minV;
  if (w < 0.01 || h < 0.01) return null;

  const edges: PanelEdge[] = [];
  for (const e of contoured) {
    edges.push({
      a: { x: e.ax - minU, y: e.ay - minV },
      b: { x: e.bx - minU, y: e.by - minV },
      hole: e.hole,
    });
  }

  return { widthM: w, heightM: h, edges, vUp: dot(vAxis, worldUp), uAxis, vAxis, originU: minU, originV: minV };
}
