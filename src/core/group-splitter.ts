// ============================================================================
// Group Splitter
//
// Splits a GeometryGroup into separate reviewable units when two coplanar
// panels touch along a single shared edge (a "bridge" in the patch adjacency
// graph). Triangles of the same panel are merged into patches first so
// internal triangulation diagonals are not mistaken for panel boundaries.
// ============================================================================

import type { Face3D, Vec3 } from "./types";
import type { GeometryGroup } from "./group-classifier";

const SNAP = 100;

function snap3(v: number): number {
  return Math.round(v * SNAP) / SNAP;
}

function edgeKey(a: Vec3, b: Vec3): string {
  const ka = `${snap3(a.x)},${snap3(a.y)},${snap3(a.z)}`;
  const kb = `${snap3(b.x)},${snap3(b.y)},${snap3(b.z)}`;
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

function enumerateEdges(face: Face3D): string[] {
  const keys: string[] = [];
  const verts = face.vertices;
  for (let i = 0; i < verts.length; i++) {
    keys.push(edgeKey(verts[i], verts[(i + 1) % verts.length]));
  }
  return keys;
}

/** Merge face pairs that are only a triangulation diagonal of one quad. */
function mergeTriangulationPatches(patches: number[][], faces: Face3D[]): number[][] {
  let current = patches.map((p) => [...p]);

  const patchVerts = (patch: number[]) => {
    const keys = new Set<string>();
    for (const fi of patch) {
      const face = faces[fi];
      if (!face) continue;
      for (const v of face.vertices) {
        keys.add(`${snap3(v.x)},${snap3(v.y)},${snap3(v.z)}`);
      }
    }
    return keys;
  };

  let changed = true;
  while (changed) {
    changed = false;
    const adj = buildPatchGraph(current, faces);

    for (let a = 0; a < current.length; a++) {
      for (const b of adj.get(a) ?? []) {
        if (b <= a) continue;
        const combined = [...current[a], ...current[b]];
        if (combined.length > 2) continue;
        const verts = patchVerts(combined);
        if (verts.size > 4) continue;

        const merged = combined;
        const next: number[][] = [];
        for (let i = 0; i < current.length; i++) {
          if (i === a || i === b) continue;
          next.push(current[i]);
        }
        next.push(merged);
        current = next;
        changed = true;
        break;
      }
      if (changed) break;
    }
  }

  return current;
}

/** Merge coplanar, edge-connected faces into patches (triangulation-safe). */
function buildPatches(faceIndices: number[], faces: Face3D[]): number[][] {
  if (faceIndices.length <= 1) return [faceIndices];
  const atomic = faceIndices.map((fi) => [fi]);
  return mergeTriangulationPatches(atomic, faces);
}

/** Undirected patch adjacency via shared edges between non-merged patches. */
function buildPatchGraph(patches: number[][], faces: Face3D[]): Map<number, Set<number>> {
  const patchOfFace = new Map<number, number>();
  patches.forEach((patch, pi) => {
    for (const fi of patch) patchOfFace.set(fi, pi);
  });

  const edgeToPatches = new Map<string, Set<number>>();
  patches.forEach((patch, pi) => {
    for (const fi of patch) {
      const face = faces[fi];
      if (!face) continue;
      for (const ek of enumerateEdges(face)) {
        const set = edgeToPatches.get(ek);
        if (set) set.add(pi);
        else edgeToPatches.set(ek, new Set([pi]));
      }
    }
  });

  const adj = new Map<number, Set<number>>();
  for (let i = 0; i < patches.length; i++) adj.set(i, new Set());

  for (const patchSet of edgeToPatches.values()) {
    if (patchSet.size < 2) continue;
    const list = Array.from(patchSet);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        adj.get(list[i])!.add(list[j]);
        adj.get(list[j])!.add(list[i]);
      }
    }
  }

  return adj;
}

/** Tarjan bridge-finding on patch adjacency graph. */
function findBridges(adj: Map<number, Set<number>>): Array<[number, number]> {
  const bridges: Array<[number, number]> = [];
  const visited = new Set<number>();
  const disc = new Map<number, number>();
  const low = new Map<number, number>();
  let timer = 0;

  function dfs(u: number, parent: number) {
    visited.add(u);
    disc.set(u, timer);
    low.set(u, timer);
    timer++;

    for (const v of adj.get(u) ?? []) {
      if (v === parent) continue;
      if (!visited.has(v)) {
        dfs(v, u);
        low.set(u, Math.min(low.get(u)!, low.get(v)!));
        if (low.get(v)! > disc.get(u)!) {
          bridges.push(u < v ? [u, v] : [v, u]);
        }
      } else {
        low.set(u, Math.min(low.get(u)!, disc.get(v)!));
      }
    }
  }

  for (const node of adj.keys()) {
    if (!visited.has(node)) dfs(node, -1);
  }

  return bridges;
}

function componentsAfterRemovingBridges(
  patchCount: number,
  adj: Map<number, Set<number>>,
  bridges: Array<[number, number]>,
): number[][] {
  const bridgeSet = new Set(bridges.map(([a, b]) => `${a}|${b}`));

  const parent = Array.from({ length: patchCount }, (_, i) => i);
  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }
  function union(a: number, b: number) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  for (let i = 0; i < patchCount; i++) {
    for (const j of adj.get(i) ?? []) {
      if (i >= j) continue;
      const key = `${i}|${j}`;
      if (bridgeSet.has(key)) continue;
      union(i, j);
    }
  }

  const compMap = new Map<number, number[]>();
  for (let i = 0; i < patchCount; i++) {
    const root = find(i);
    const arr = compMap.get(root);
    if (arr) arr.push(i);
    else compMap.set(root, [i]);
  }

  return Array.from(compMap.values());
}

function buildGroupFromFaces(
  base: GeometryGroup,
  faceIndices: number[],
  faces: Face3D[],
  id: number,
  partLabel: string,
): GeometryGroup {
  let totalArea = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const fi of faceIndices) {
    const face = faces[fi];
    if (!face) continue;
    let area = 0;
    const verts = face.vertices;
    const n = verts.length;
    const c = {
      x: verts.reduce((s, v) => s + v.x, 0) / n,
      y: verts.reduce((s, v) => s + v.y, 0) / n,
      z: verts.reduce((s, v) => s + v.z, 0) / n,
    };
    for (let i = 1; i < n - 1; i++) {
      const ax = verts[0].x - c.x;
      const ay = verts[0].y - c.y;
      const az = verts[0].z - c.z;
      const bx = verts[i].x - c.x;
      const by = verts[i].y - c.y;
      const bz = verts[i].z - c.z;
      const dx = verts[i + 1].x - c.x;
      const dy = verts[i + 1].y - c.y;
      const dz = verts[i + 1].z - c.z;
      const crx = ay * bz - az * by;
      const cry = az * bx - ax * bz;
      const crz = ax * by - ay * bx;
      area += Math.sqrt(crx * crx + cry * cry + crz * crz) / 2;
    }
    totalArea += area;
    cx += c.x * area;
    cy += c.y * area;
    cz += c.z * area;
    for (const v of verts) {
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
    }
  }

  const centroid =
    totalArea > 0
      ? { x: cx / totalArea, y: cy / totalArea, z: cz / totalArea }
      : base.centroid;

  return {
    ...base,
    id,
    label: partLabel,
    faceIndices,
    totalArea,
    centroid,
    minY: minY === Infinity ? base.minY : minY,
    maxY: maxY === -Infinity ? base.maxY : maxY,
  };
}

function tryBridgeSplit(
  faces: Face3D[],
  group: GeometryGroup,
  patches: number[][],
  nextId: number,
): { groups: GeometryGroup[]; nextId: number } | null {
  if (patches.length <= 1) return null;

  const adj = buildPatchGraph(patches, faces);
  const bridges = findBridges(adj);
  if (bridges.length === 0) return null;

  const components = componentsAfterRemovingBridges(patches.length, adj, bridges);
  if (components.length <= 1) return null;

  const result: GeometryGroup[] = [];
  let id = nextId;

  components.forEach((comp, idx) => {
    const faceIndices: number[] = [];
    for (const pi of comp) {
      faceIndices.push(...patches[pi]);
    }
    const partLabel = `${group.label} (${idx + 1}/${components.length})`;
    const gid = idx === 0 ? group.id : id++;
    result.push(buildGroupFromFaces(group, faceIndices, faces, gid, partLabel));
  });

  return { groups: result, nextId: id };
}

/** Split vertical walls when faces have clearly different height spans. */
function tryVerticalSpanSplit(
  faces: Face3D[],
  group: GeometryGroup,
  nextId: number,
): { groups: GeometryGroup[]; nextId: number } | null {
  const isVertical =
    group.orientation === "vertical" ||
    (typeof group.orientation === "string" && group.orientation.startsWith("Vertical"));
  if (!isVertical) return null;

  const buckets = new Map<string, number[]>();
  for (const fi of group.faceIndices) {
    const face = faces[fi];
    if (!face) continue;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const v of face.vertices) {
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
    }
    const key = `${snap3(minY)}|${snap3(maxY)}`;
    const arr = buckets.get(key);
    if (arr) arr.push(fi);
    else buckets.set(key, [fi]);
  }

  if (buckets.size <= 1) return null;

  const components = Array.from(buckets.values());
  const result: GeometryGroup[] = [];
  let id = nextId;

  components.forEach((faceIndices, idx) => {
    const partLabel = `${group.label} (${idx + 1}/${components.length})`;
    const gid = idx === 0 ? group.id : id++;
    result.push(buildGroupFromFaces(group, faceIndices, faces, gid, partLabel));
  });

  return { groups: result, nextId: id };
}

/**
 * Split a group into separate pieces when panel-level bridge edges exist,
 * or when vertical wall faces have different height spans (partial edge contact).
 */
export function splitGroupAtPanelBridges(
  faces: Face3D[],
  group: GeometryGroup,
  nextId: number,
): { groups: GeometryGroup[]; nextId: number } {
  const patches = buildPatches(group.faceIndices, faces);

  const bridgeSplit = tryBridgeSplit(faces, group, patches, nextId);
  if (bridgeSplit) return bridgeSplit;

  const spanSplit = tryVerticalSpanSplit(faces, group, nextId);
  if (spanSplit) return spanSplit;

  return { groups: [group], nextId };
}

/** Split all wall groups that contain separable panel bridges. */
export function splitWallGroupsAtPanelBridges(
  faces: Face3D[],
  groups: GeometryGroup[],
): GeometryGroup[] {
  let nextId = Math.max(0, ...groups.map((g) => g.id)) + 1;
  const result: GeometryGroup[] = [];

  for (const group of groups) {
    if (group.category !== "wall" && group.originalCategory !== "wall") {
      result.push(group);
      continue;
    }
    const split = splitGroupAtPanelBridges(faces, group, nextId);
    nextId = split.nextId;
    result.push(...split.groups);
  }

  return result;
}
