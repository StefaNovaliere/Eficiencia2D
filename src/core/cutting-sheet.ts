// ============================================================================
// Cutting Sheet — Plancha de Corte
//
// Decomposes the 3D model into individual structural components using
// geometric coplanarity clustering (same normal + same plane offset).
//
// Algorithm:
//   1. Cluster ALL faces by coplanarity (normal direction + plane distance d)
//   2. Within each cluster, find connected components via shared vertices
//   3. Classify each component as wall (vertical) or floor (horizontal)
//   4. Project to 2D, extract boundary edges (edges in exactly 1 face)
//   5. Assign ID: A1, A2… for walls; B1, B2… for floors
//
// Boundary edge rule: an edge shared by 2 faces is internal (triangulation)
// and is discarded. Only edges belonging to exactly 1 face are exported.
//
// Layout: simple row-based grid with gap between panels.
// DXF output: 1:1 scale (real dimensions for laser/CNC cutting).
// ============================================================================

import type { DecompositionMode, Face3D, Vec2, Vec3 } from "./types";
import { cross, dot, getVertexIndices, normalize, sub, vlength } from "./types";
import { detectFloorLevels } from "./floor-plan-extractor";
import { areThinTwins } from "./wall-thickness";

const GAP_M = 0.003;             // gap between panels in metres (3mm for laser cutting)
const SHEET_SPACING_M = 0.10;    // visual gap between sheets in multi-sheet DXF
const NORMAL_CLUSTER_DOT = 0.85; // faces with dot > this are "same direction"
const NEAR_PARALLEL_EPS = 0.01;    // cross product near-zero threshold for degenerate axis
const THIN_TWIN_THRESHOLD = 0.40;  // merge twin coplanar groups closer than this

type UpAxis = "Y" | "Z";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getUp(v: Vec3, up: UpAxis): number {
  return up === "Y" ? v.y : v.z;
}

function getUpVec(up: UpAxis): Vec3 {
  return up === "Y" ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
}

function faceArea(face: Face3D): number {
  const verts = face.vertices;
  if (verts.length < 3) return 0;
  let sx = 0, sy = 0, sz = 0;
  for (let i = 1; i < verts.length - 1; i++) {
    const e1 = sub(verts[i], verts[0]);
    const e2 = sub(verts[i + 1], verts[0]);
    const c = cross(e1, e2);
    sx += c.x; sy += c.y; sz += c.z;
  }
  return 0.5 * Math.sqrt(sx * sx + sy * sy + sz * sz);
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

/** Snap a 3D coordinate for coplanarity grouping. */
function snap3(v: number): number {
  return Math.round(v * 100) / 100;
}

function r(n: number): string {
  return Number(n.toFixed(4)).toString();
}


// ---------------------------------------------------------------------------
// Panel types
// ---------------------------------------------------------------------------

export type PanelCategory = "wall" | "floor";

export interface Panel {
  id: string;
  groupName: string;
  category: PanelCategory;
  floorIndex: number;
  widthM: number;
  heightM: number;
  edges: Array<{ a: Vec2; b: Vec2 }>;
}

interface PlacedPanel {
  panel: Panel;
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// Coplanarity clustering: group faces by (normal direction + plane offset d)
// ---------------------------------------------------------------------------

interface CoplanarGroup {
  normal: Vec3;
  d: number;               // plane offset: dot(normal, pointOnPlane)
  faces: Face3D[];
  totalArea: number;
  category: PanelCategory;
}

/**
 * Cluster all faces into coplanar groups.
 * Two faces are coplanar if:
 *   1. Their normals point in the same direction (dot > threshold)
 *   2. Their plane offsets (d = dot(n, v)) are within tolerance
 */
function clusterByCoplanarity(
  faces: Face3D[],
  up: UpAxis,
): CoplanarGroup[] {
  const groups: CoplanarGroup[] = [];
  const D_TOLERANCE = 0.15; // ~15cm tolerance for "same plane"

  for (const face of faces) {
    const n = face.normal;
    if (vlength(n) < 0.01) continue;

    const area = faceArea(face);
    if (area < 1e-6) continue;

    // Plane offset from first vertex.
    const d = dot(n, face.vertices[0]);

    // Classify: horizontal (floor/ceiling) or vertical/inclined (wall).
    const upComp = Math.abs(getUp(n, up));
    const category: PanelCategory = upComp > 0.75 ? "floor" : "wall";

    // Try to merge into an existing group.
    let placed = false;
    for (const group of groups) {
      if (
        group.category === category &&
        Math.abs(dot(n, group.normal)) > NORMAL_CLUSTER_DOT &&
        Math.abs(d - group.d) < D_TOLERANCE
      ) {
        group.faces.push(face);
        group.totalArea += area;
        placed = true;
        break;
      }
    }

    if (!placed) {
      groups.push({
        normal: normalize(n),
        d,
        faces: [face],
        totalArea: area,
        category,
      });
    }
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Connected components: split a coplanar group into spatially connected pieces
// ---------------------------------------------------------------------------

/**
 * Within a coplanar group, faces may belong to different walls/slabs that
 * happen to be on the same plane. Split them into connected components
 * by shared vertices (exact indices when available, snapped fallback).
 */
function splitConnectedComponents(faces: Face3D[]): Face3D[][] {
  if (faces.length <= 1) return [faces];

  const vertToFaces = new Map<string | number, number[]>();
  for (let fi = 0; fi < faces.length; fi++) {
    const indices = getVertexIndices(faces[fi]);
    if (indices) {
      for (const vi of indices) {
        const arr = vertToFaces.get(vi);
        if (arr) arr.push(fi);
        else vertToFaces.set(vi, [fi]);
      }
    } else {
      for (const v of faces[fi].vertices) {
        const key = `${snap3(v.x)},${snap3(v.y)},${snap3(v.z)}`;
        const arr = vertToFaces.get(key);
        if (arr) arr.push(fi);
        else vertToFaces.set(key, [fi]);
      }
    }
  }

  // Union-Find.
  const parent = faces.map((_, i) => i);
  function find(x: number): number {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  }
  function union(a: number, b: number) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  for (const faceIndices of vertToFaces.values()) {
    for (let i = 1; i < faceIndices.length; i++) {
      union(faceIndices[0], faceIndices[i]);
    }
  }

  // Group by root.
  const componentMap = new Map<number, Face3D[]>();
  for (let fi = 0; fi < faces.length; fi++) {
    const root = find(fi);
    const arr = componentMap.get(root);
    if (arr) arr.push(faces[fi]);
    else componentMap.set(root, [faces[fi]]);
  }

  return Array.from(componentMap.values());
}

// ---------------------------------------------------------------------------
// Contour tracing: remove stray internal edges from boundary edge set
// ---------------------------------------------------------------------------

type RawEdge = {
  ax: number; ay: number; bx: number; by: number;
  via?: number;
  vib?: number;
};

/**
 * Filter boundary edges to keep only those forming closed contour loops
 * (outer boundary + holes). Removes stray edges from mesh artifacts.
 *
 * Uses half-edge (dart) face traversal of the planar edge graph. Every
 * undirected edge yields two darts; each dart belongs to exactly one traced
 * face, so no legitimate edge is ever lost — even at T-junctions where three
 * or more edges meet (which broke the previous greedy single-loop tracer).
 *
 * Keep rule: an edge is part of a real contour iff its two darts belong to
 * traced faces of OPPOSITE winding (one CCW interior, one CW exterior/hole
 * boundary). Internal chords — bordered by two interior faces of the same
 * winding — are discarded.
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

  // Next dart around a face: arrive at vertex w via `dart`; the next dart is
  // the outgoing dart immediately clockwise from the reverse direction. This
  // keeps the face consistently on one side and visits every dart once.
  function nextDart(dart: number): number {
    const w = dartTo(dart);
    const arr = outgoing.get(w)!;
    // Reverse dart is the twin (w → from). Find its position, step clockwise.
    const twin = (dart & 1) === 0 ? (dart >> 1) * 2 + 1 : (dart >> 1) * 2;
    const idx = arr.indexOf(twin);
    const prev = (idx - 1 + arr.length) % arr.length;
    return arr[prev];
  }

  // Traverse all faces. Each face is a closed dart loop; record which loop
  // each dart belongs to and the loop's signed area (winding).
  const dartFace = new Map<number, number>();
  const faceSign: number[] = [];
  let faceId = 0;

  for (const ei of liveEdges) {
    for (const dir of [0, 1]) {
      const start = ei * 2 + dir;
      if (dartFace.has(start)) continue;

      // Walk the face loop.
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

      // Shoelace signed area of the loop polygon.
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
    // Opposite, non-zero winding → real contour edge (boundary or hole).
    if (s0 !== 0 && s1 !== 0 && s0 !== s1) kept.add(ei);
  }

  return boundaryEdges.filter((_, i) => kept.has(i));
}

// ---------------------------------------------------------------------------
// Project coplanar faces to 2D and extract boundary edges
// ---------------------------------------------------------------------------

export function projectFacesTo2D(
  faces: Face3D[],
  groupNormal: Vec3,
  up: UpAxis,
): {
  widthM: number;
  heightM: number;
  edges: Array<{ a: Vec2; b: Vec2 }>;
  /** dot(vAxis, worldUp): >0 ⇒ 2D +y points up; <0 ⇒ 2D +y points down. */
  vUp: number;
} | null {
  if (faces.length === 0) return null;

  // Universal tangent-plane projection: always project onto the surface's own
  // plane so the true cutting shape is preserved for any orientation —
  // horizontal floors, vertical walls, and inclined roofs alike.
  const worldUp = getUpVec(up);
  let uAxis: Vec3 = normalize(cross(worldUp, groupNormal));
  let vAxis: Vec3;

  if (vlength(uAxis) < NEAR_PARALLEL_EPS) {
    // Normal is nearly parallel to worldUp (pure floor/ceiling) — pick
    // an arbitrary horizontal axis as u.
    uAxis = { x: 1, y: 0, z: 0 };
    vAxis = normalize(cross(groupNormal, uAxis));
    if (vlength(vAxis) < NEAR_PARALLEL_EPS) {
      vAxis = up === "Y" ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
    }
  } else {
    vAxis = normalize(cross(groupNormal, uAxis));
  }

  // Project all faces to 2D; count how many faces each edge belongs to.
  // Boundary edge = appears in exactly 1 face.
  // Internal edge (triangulation) = shared by 2 faces → discard.
  //
  // Use vertex indices for exact edge deduplication when available;
  // fall back to snapped 2D coordinates for generated faces.
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

  // Keep only boundary edges (count === 1).
  const boundaryEdges: Array<{ ax: number; ay: number; bx: number; by: number }> = [];
  for (const [key, count] of edgeFaceCount) {
    if (count === 1) {
      const coords = edgeCoords.get(key)!;
      boundaryEdges.push(coords);
    }
  }

  if (boundaryEdges.length === 0) return null;

  // Remove stray internal edges — keep only edges forming closed contours.
  const contoured = traceContours(boundaryEdges);
  if (contoured.length === 0) return null;

  // Bounding box and normalize to (0,0).
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

  const edges: Array<{ a: Vec2; b: Vec2 }> = [];
  for (const e of contoured) {
    edges.push({
      a: { x: e.ax - minU, y: e.ay - minV },
      b: { x: e.bx - minU, y: e.by - minV },
    });
  }

  return { widthM: w, heightM: h, edges, vUp: dot(vAxis, worldUp) };
}

// ---------------------------------------------------------------------------
// Half-plane clip for a contour edge set (used for assembly compensation:
// shorten a wall by removing a strip on the side where it meets a floor).
// ---------------------------------------------------------------------------

/**
 * Clip a set of 2D contour edges by the horizontal line y = cut, keeping the
 * side indicated by `keepAbove`, then re-cap the cut and re-normalise to (0,0).
 * Returns the new edges plus recomputed width/height, or `null` if nothing
 * meaningful survives.
 */
export function clipPanelAtV(
  edges: Array<{ a: Vec2; b: Vec2 }>,
  cut: number,
  keepAbove: boolean,
): { widthM: number; heightM: number; edges: Array<{ a: Vec2; b: Vec2 }> } | null {
  const inSide = (y: number) => (keepAbove ? y >= cut - 1e-9 : y <= cut + 1e-9);
  const out: Array<{ a: Vec2; b: Vec2 }> = [];
  const crossings: number[] = [];

  for (const e of edges) {
    const aIn = inSide(e.a.y);
    const bIn = inSide(e.b.y);
    if (aIn && bIn) {
      out.push(e);
    } else if (!aIn && !bIn) {
      continue;
    } else {
      const t = (cut - e.a.y) / (e.b.y - e.a.y);
      const ix = e.a.x + t * (e.b.x - e.a.x);
      const cutPt = { x: ix, y: cut };
      const keep = aIn ? e.a : e.b;
      out.push(aIn ? { a: keep, b: cutPt } : { a: cutPt, b: keep });
      crossings.push(ix);
    }
  }

  // Cap the cut: pair crossings left-to-right.
  crossings.sort((p, q) => p - q);
  for (let i = 0; i + 1 < crossings.length; i += 2) {
    out.push({ a: { x: crossings[i], y: cut }, b: { x: crossings[i + 1], y: cut } });
  }

  if (out.length < 3) return null;

  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const e of out) {
    minU = Math.min(minU, e.a.x, e.b.x);
    maxU = Math.max(maxU, e.a.x, e.b.x);
    minV = Math.min(minV, e.a.y, e.b.y);
    maxV = Math.max(maxV, e.a.y, e.b.y);
  }
  const w = maxU - minU;
  const h = maxV - minV;
  if (w < 0.01 || h < 0.01) return null;

  const normalized = out.map((e) => ({
    a: { x: e.a.x - minU, y: e.a.y - minV },
    b: { x: e.b.x - minU, y: e.b.y - minV },
  }));

  return { widthM: w, heightM: h, edges: normalized };
}

// ---------------------------------------------------------------------------
// Thin-twin merge: collapse parallel-opposite coplanar groups that represent
// the two skins of the same physical element (thin walls and thin slabs).
// Keeps the larger of each pair, drops the other — the 2D outline is the same.
// ---------------------------------------------------------------------------

function computeGroupGeom(group: CoplanarGroup): { centroid: Vec3; extent: number } {
  let sx = 0, sy = 0, sz = 0, count = 0;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const face of group.faces) {
    for (const v of face.vertices) {
      sx += v.x; sy += v.y; sz += v.z; count++;
      if (v.x < minX) minX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.z < minZ) minZ = v.z;
      if (v.x > maxX) maxX = v.x;
      if (v.y > maxY) maxY = v.y;
      if (v.z > maxZ) maxZ = v.z;
    }
  }
  return {
    centroid: { x: sx / count, y: sy / count, z: sz / count },
    extent: Math.max(maxX - minX, maxY - minY, maxZ - minZ),
  };
}

function mergeThinTwinGroups(groups: CoplanarGroup[]): CoplanarGroup[] {
  const geom = groups.map(computeGroupGeom);
  const drop = new Set<number>();

  for (let i = 0; i < groups.length; i++) {
    if (drop.has(i)) continue;
    for (let j = i + 1; j < groups.length; j++) {
      if (drop.has(j)) continue;
      if (groups[i].category !== groups[j].category) continue;

      const a = { normal: groups[i].normal, d: groups[i].d, ...geom[i] };
      const b = { normal: groups[j].normal, d: groups[j].d, ...geom[j] };
      if (!areThinTwins(a, b, THIN_TWIN_THRESHOLD)) continue;

      if (groups[i].totalArea >= groups[j].totalArea) {
        drop.add(j);
      } else {
        drop.add(i);
        break;
      }
    }
  }

  return groups.filter((_, i) => !drop.has(i));
}

// ---------------------------------------------------------------------------
// Simple-mode filter: keep only the largest face per wall orientation
// ---------------------------------------------------------------------------

/**
 * For "simple" mode, reduce coplanar groups to one per wall orientation:
 *   1. Pair up groups with opposite normals (interior + exterior of same wall)
 *      that are close together (within wall thickness ≈ 0.5m).
 *   2. From each pair, keep only the group with the larger total area (exterior).
 *   3. Discard any remaining group whose area is < 10% of the largest (cantos).
 *
 * Floor groups pass through unchanged.
 */
function filterGroupsForSimpleMode(groups: CoplanarGroup[]): CoplanarGroup[] {
  const walls = groups.filter((g) => g.category === "wall");
  const floors = groups.filter((g) => g.category === "floor");

  // Pair interior/exterior faces of the same wall.
  const used = new Set<number>();
  const kept: CoplanarGroup[] = [];

  for (let i = 0; i < walls.length; i++) {
    if (used.has(i)) continue;
    used.add(i);

    let best = walls[i];

    for (let j = i + 1; j < walls.length; j++) {
      if (used.has(j)) continue;

      // Opposite normals → same wall, interior vs exterior.
      const d = dot(walls[i].normal, walls[j].normal);
      if (d > -0.85) continue;

      // Close in space → wall thickness (|d_i + d_j| ≈ thickness).
      if (Math.abs(walls[i].d + walls[j].d) > 0.5) continue;

      used.add(j);
      if (walls[j].totalArea > best.totalArea) {
        best = walls[j];
      }
    }

    kept.push(best);
  }

  // Discard cantos: groups with area < 10% of the largest.
  const maxArea = Math.max(...kept.map((g) => g.totalArea), 0);
  const filtered = kept.filter((g) => g.totalArea >= maxArea * 0.10);

  return [...filtered, ...floors];
}

// ---------------------------------------------------------------------------
// Decompose model into classified panels using geometric coplanarity
// ---------------------------------------------------------------------------

export function decomposeIntoPanels(
  faces: Face3D[],
  up: UpAxis,
  simpleMode: boolean,
  minAreaM2: number = 0.01,
): Panel[] {
  // 1. Cluster ALL faces by coplanarity (normal + plane offset).
  let coplanarGroups = clusterByCoplanarity(faces, up);

  // 1a. Collapse thin twins (parallel-opposite skins of the same physical
  //     element — thin walls and thin floor slabs) into a single panel.
  coplanarGroups = mergeThinTwinGroups(coplanarGroups);

  // 1b. In simple mode, keep only the largest face per wall orientation.
  if (simpleMode) {
    coplanarGroups = filterGroupsForSimpleMode(coplanarGroups);
  }

  // 2. Detect floor levels for assigning floor indices.
  const levels = detectFloorLevels(faces, up);

  // 3. For each coplanar group, split into connected components, then project.
  const rawPanels: Array<{
    category: PanelCategory;
    floorIndex: number;
    widthM: number;
    heightM: number;
    edges: Array<{ a: Vec2; b: Vec2 }>;
  }> = [];

  for (const group of coplanarGroups) {
    // Split into spatially connected components (separate walls on same plane).
    const components = splitConnectedComponents(group.faces);

    for (const compFaces of components) {
      // Project and extract boundary edges.
      const result = projectFacesTo2D(compFaces, group.normal, up);
      if (!result) continue;

      if (result.widthM * result.heightM < minAreaM2) continue;

      // Determine floor index from vertical midpoint.
      const allElevs = compFaces.flatMap((f) =>
        f.vertices.map((v) => getUp(v, up)),
      );
      const mid = (Math.min(...allElevs) + Math.max(...allElevs)) / 2;

      let floorIdx = 0;
      for (let i = levels.length - 1; i >= 0; i--) {
        if (mid >= levels[i] - 0.5) {
          floorIdx = i;
          break;
        }
      }

      rawPanels.push({
        category: group.category,
        floorIndex: floorIdx,
        widthM: result.widthM,
        heightM: result.heightM,
        edges: result.edges,
      });
    }
  }

  // 4. Assign IDs separately for walls (A-prefix) and floors (B-prefix).
  const walls = rawPanels
    .filter((p) => p.category === "wall")
    .sort((a, b) => {
      if (a.floorIndex !== b.floorIndex) return a.floorIndex - b.floorIndex;
      return b.widthM * b.heightM - a.widthM * a.heightM;
    });

  const floors = rawPanels
    .filter((p) => p.category === "floor")
    .sort((a, b) => {
      if (a.floorIndex !== b.floorIndex) return a.floorIndex - b.floorIndex;
      return b.widthM * b.heightM - a.widthM * a.heightM;
    });

  const panels: Panel[] = [];

  let wallCount = 0;
  for (const rp of walls) {
    wallCount++;
    panels.push({
      id: `A${wallCount}`,
      groupName: `wall_${wallCount}`,
      category: "wall",
      floorIndex: rp.floorIndex,
      widthM: rp.widthM,
      heightM: rp.heightM,
      edges: rp.edges,
    });
  }

  let floorCount = 0;
  for (const rp of floors) {
    floorCount++;
    panels.push({
      id: `B${floorCount}`,
      groupName: `floor_${floorCount}`,
      category: "floor",
      floorIndex: rp.floorIndex,
      widthM: rp.widthM,
      heightM: rp.heightM,
      edges: rp.edges,
    });
  }

  return panels;
}

// ---------------------------------------------------------------------------
// Row-based grid layout — panels flow left-to-right, then down.
// Sorted by height descending so rows are uniform.
// ---------------------------------------------------------------------------

function layoutPanels(panels: Panel[]): PlacedPanel[] {
  if (panels.length === 0) return [];

  // Sort by height descending for efficient row packing.
  const sorted = [...panels].sort((a, b) => b.heightM - a.heightM);

  // Determine a reasonable max row width (4× the widest panel).
  const maxRowW = Math.max(
    ...sorted.map((p) => p.widthM),
    2, // at least 2m
  ) * 4;

  const placed: PlacedPanel[] = [];
  let rowX = 0;
  let rowY = 0;     // current row's baseline Y
  let rowMaxH = 0;  // tallest panel in current row

  for (const panel of sorted) {
    const pw = panel.widthM;
    const ph = panel.heightM;

    // Start a new row if this panel would exceed max width.
    if (rowX > 0 && rowX + pw > maxRowW) {
      rowY += rowMaxH + GAP_M;
      rowX = 0;
      rowMaxH = 0;
    }

    placed.push({ panel, x: rowX, y: rowY });
    rowX += pw + GAP_M;
    rowMaxH = Math.max(rowMaxH, ph);
  }

  return placed;
}

// ---------------------------------------------------------------------------
// DXF generation — AC1009 (R12) for maximum compatibility with Autodesk
// Viewer, QCAD, LibreCAD, and laser-cutting software.
// Cutting sheets are always at 1:1 scale (real dimensions in metres).
// ---------------------------------------------------------------------------

/** Layer definitions for the 4-layer laser cutting protocol. */
const CS_LAYERS = [
  { name: "CUT_EXTERIOR",   aci: "7" }, // black (white in CAD = black on light bg)
  { name: "ENGRAVE_VECTOR", aci: "5" }, // blue
  { name: "ENGRAVE_RASTER", aci: "8" }, // dark gray
  { name: "CUT_INTERIOR",   aci: "3" }, // green
];


function emitDxfHeader(lines: string[], layerCount: number): void {
  lines.push(
    "0", "SECTION",
    "2", "HEADER",
    "9", "$ACADVER",
    "1", "AC1009",
    "9", "$INSUNITS",
    "70", "6",
    "0", "ENDSEC",
  );

  lines.push(
    "0", "SECTION",
    "2", "TABLES",
    "0", "TABLE",
    "2", "LTYPE",
    "70", "1",
    "0", "LTYPE",
    "2", "CONTINUOUS",
    "70", "0",
    "3", "Solid line",
    "72", "65",
    "73", "0",
    "40", "0.0",
    "0", "ENDTAB",
    "0", "TABLE",
    "2", "LAYER",
    "70", String(layerCount),
  );

  for (const l of CS_LAYERS) {
    lines.push(
      "0", "LAYER",
      "2", l.name,
      "70", "0",
      "62", l.aci,
      "6", "CONTINUOUS",
    );
  }

  lines.push("0", "ENDTAB", "0", "ENDSEC");
}

/** Approximate ratio of character width to text height (monospace-ish). */
const CHAR_W_RATIO = 0.62;

/** Fixed reference text heights in sheet metres (independent of panel size). */
const LABEL_H_M = 0.008;  // 8mm for panel ID
const DIM_H_M = 0.005;    // 5mm for dimensions

/** Largest height that fits both the panel bounds and a width budget. */
function fitTextHeight(text: string, maxW: number, maxH: number, targetH: number): number {
  if (text.length === 0) return 0;
  const byWidth = (maxW * 0.88) / (text.length * CHAR_W_RATIO);
  return Math.min(targetH, byWidth, maxH);
}

function emitPanelEntities(
  lines: string[],
  edges: Array<{ a: Vec2; b: Vec2 }>,
  pw: number,
  ph: number,
  panelId: string,
  ox: number,
  oy: number,
  scaleDenom: number = 1,
  includeText: boolean = true,
): void {
  for (const edge of edges) {
    lines.push(
      "0", "LINE",
      "8", "CUT_EXTERIOR",
      "62", "7",
      "10", r(ox + edge.a.x),
      "20", r(oy + edge.a.y),
      "11", r(ox + edge.b.x),
      "21", r(oy + edge.b.y),
    );
  }

  if (!includeText) return;

  const realW = pw * scaleDenom;
  const realH = ph * scaleDenom;
  const dimText = `${realW.toFixed(2)} x ${realH.toFixed(2)} m`;

  const labelH = fitTextHeight(panelId, pw, ph * 0.45, LABEL_H_M);
  const dimH = fitTextHeight(dimText, pw, ph * 0.30, DIM_H_M);

  const MIN_H = 0.002;

  if (labelH >= MIN_H) {
    const labelX = r(ox + pw / 2);
    const labelY = r(oy + ph - labelH * 1.5);
    lines.push(
      "0", "TEXT",
      "8", "ENGRAVE_VECTOR",
      "62", "5",
      "10", labelX,
      "20", labelY,
      "40", r(labelH),
      "1", panelId,
      "72", "1",
      "11", labelX,
      "21", labelY,
    );
  }

  if (dimH >= MIN_H && labelH + dimH * 3 < ph) {
    const dimX = r(ox + pw / 2);
    const dimY = r(oy + dimH * 0.6);
    lines.push(
      "0", "TEXT",
      "8", "ENGRAVE_RASTER",
      "62", "8",
      "10", dimX,
      "20", dimY,
      "40", r(dimH),
      "1", dimText,
      "72", "1",
      "11", dimX,
      "21", dimY,
    );
  }
}

function panelsToDxf(placed: PlacedPanel[]): string {
  const lines: string[] = [];
  emitDxfHeader(lines, CS_LAYERS.length);
  lines.push("0", "SECTION", "2", "ENTITIES");

  for (const { panel, x, y } of placed) {
    emitPanelEntities(lines, panel.edges, panel.widthM, panel.heightM, panel.id, x, y);
  }

  lines.push("0", "ENDSEC", "0", "EOF");
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function generateCuttingSheets(
  faces: Face3D[],
  upAxis: "Y" | "Z",
  _scaleDenom: number,
  mode?: DecompositionMode,
): Array<{ name: string; content: string }> {
  const simpleMode = (mode ?? "simple") === "simple";
  const panels = decomposeIntoPanels(faces, upAxis, simpleMode);
  if (panels.length === 0) return [];

  const results: Array<{ name: string; content: string }> = [];

  // Separate walls and floors.
  const wallPanels = panels.filter((p) => p.category === "wall");
  const floorPanels = panels.filter((p) => p.category === "floor");

  // Generate wall cutting sheet.
  if (wallPanels.length > 0) {
    const placed = layoutPanels(wallPanels);
    const content = panelsToDxf(placed);
    results.push({ name: "Descomposicion_Paredes.dxf", content });
  }

  // Generate floor cutting sheet.
  if (floorPanels.length > 0) {
    const placed = layoutPanels(floorPanels);
    const content = panelsToDxf(placed);
    results.push({ name: "Descomposicion_Pisos.dxf", content });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Nested-sheet DXF — panels arranged on physical sheets with outlines
// ---------------------------------------------------------------------------

import type { NestingResult } from "./sheet-nester";
import { rotateEdges } from "./sheet-nester";

export function nestedSheetsToDxf(nesting: NestingResult, includeText: boolean = true): string {
  const { sheets, config } = nesting;
  if (sheets.length === 0) return "";

  const lines: string[] = [];
  emitDxfHeader(lines, CS_LAYERS.length);
  lines.push("0", "SECTION", "2", "ENTITIES");

  const cols = Math.min(sheets.length, 3);

  for (let si = 0; si < sheets.length; si++) {
    const col = si % cols;
    const row = Math.floor(si / cols);
    const sx = col * (config.widthM + SHEET_SPACING_M);
    const sy = -(row * (config.heightM + SHEET_SPACING_M));

    // Sheet outline rectangle.
    const x0 = sx, y0 = sy, x1 = sx + config.widthM, y1 = sy + config.heightM;
    const corners: [number, number][] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    for (let ci = 0; ci < 4; ci++) {
      const [ax, ay] = corners[ci];
      const [bx, by] = corners[(ci + 1) % 4];
      lines.push(
        "0", "LINE",
        "8", "ENGRAVE_RASTER",
        "62", "7",
        "10", r(ax), "20", r(ay),
        "11", r(bx), "21", r(by),
      );
    }

    if (includeText) {
      lines.push(
        "0", "TEXT",
        "8", "ENGRAVE_RASTER",
        "62", "8",
        "10", r(sx + config.widthM / 2),
        "20", r(sy + config.heightM + 0.02),
        "40", r(0.03),
        "1", `Plancha ${si + 1}`,
        "72", "1",
        "11", r(sx + config.widthM / 2),
        "21", r(sy + config.heightM + 0.02),
      );
    }

    for (const placed of sheets[si].panels) {
      const { panel, x, y, rotated, effectiveW, effectiveH } = placed;
      const edges = rotated
        ? rotateEdges(panel.edges, panel.widthM)
        : panel.edges;
      emitPanelEntities(
        lines,
        edges,
        effectiveW,
        effectiveH,
        panel.id,
        sx + x,
        sy + y,
        nesting.scaleDenom,
        includeText,
      );
    }
  }

  lines.push("0", "ENDSEC", "0", "EOF");
  return lines.join("\n") + "\n";
}
