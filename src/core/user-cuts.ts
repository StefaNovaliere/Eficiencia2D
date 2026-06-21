/**
 * User-defined cuts on review panels (subtracted from the cut sheet / PDF).
 *
 * Backend: send as `user_cuts` in POST /api/generate (see GenerateRequestPayload).
 * Each cut is in panel-local metres (same frame as projectFacesTo2D after normalise).
 */
import { difference } from "polyclip-ts";
import type { PanelEdge } from "@/core/panel-projection";

/** Segments used to approximate circles/ellipses in cuts and previews. */
export const CUT_CIRCLE_SEGMENTS = 64;

export type CutShapeKind = "rect" | "circle" | "line" | "square";

/** @deprecated "square" is legacy; new cuts use rect + Shift. */
export type ActiveCutShapeKind = "rect" | "circle" | "line";

export interface UserCut {
  id: string;
  groupId: number;
  kind: CutShapeKind;
  /** Anchor / corner / centre in normalised panel coords (m). */
  u0: number;
  v0: number;
  /** Drag end — opposite corner, radius point, or line end (m). */
  u1: number;
  v1: number;
  /** Line cuts: keep material on the positive side of the directed line. */
  keepPositive?: boolean;
  /** Unit normal of the clicked face (scene coords, toward camera) — anchors cut to visible surface. */
  surfaceNormal?: { x: number; y: number; z: number };
  /** Signed distance from projection plane to clicked face along `surfaceNormal` (m). */
  surfaceOffset?: number;
}

export interface CutDragState {
  groupId: number;
  kind: CutShapeKind;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  shiftKey: boolean;
  surfaceNormal?: { x: number; y: number; z: number };
  surfaceOffset?: number;
}

const SNAP = 1e4;
function snap(v: number): number {
  return Math.round(v * SNAP) / SNAP;
}

function ringArea(ring: [number, number][]): number {
  let a = 0;
  for (let i = 0; i + 1 < ring.length; i++) {
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return a / 2;
}

/** Build polygon rings from contour edges (outer + holes). */
function edgesToPolygons(edges: PanelEdge[]): [number, number][][] {
  type Key = string;
  const key = (p: { x: number; y: number }): Key =>
    `${snap(p.x)},${snap(p.y)}`;

  const adj = new Map<Key, { x: number; y: number }[]>();
  const addEdge = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const ka = key(a);
    const kb = key(b);
    if (!adj.has(ka)) adj.set(ka, []);
    if (!adj.has(kb)) adj.set(kb, []);
    adj.get(ka)!.push(b);
    adj.get(kb)!.push(a);
  };

  for (const e of edges) {
    addEdge(e.a, e.b);
  }

  const used = new Set<string>();
  const rings: [number, number][][] = [];

  for (const [startKey, neighbors] of adj.entries()) {
    if (neighbors.length === 0) continue;
    const edgeKey = `${startKey}|${key(neighbors[0])}`;
    if (used.has(edgeKey)) continue;

    const ring: [number, number][] = [];
    let cur = startKey;
    let prev: string | null = null;
    let guard = 0;

    while (guard++ < adj.size * 4) {
      const [cx, cy] = cur.split(",").map(Number);
      ring.push([cx, cy]);
      const nbs = adj.get(cur)!;
      let next: string | null = null;
      for (const nb of nbs) {
        const nk = key(nb);
        if (nk === prev) continue;
        const ek = cur < nk ? `${cur}|${nk}` : `${nk}|${cur}`;
        if (used.has(ek)) continue;
        next = nk;
        used.add(ek);
        break;
      }
      if (!next || next === startKey) break;
      prev = cur;
      cur = next;
    }

    if (ring.length >= 4) rings.push(ring);
  }

  return rings;
}

function polygonsToEdges(polys: [number, number][][]): PanelEdge[] {
  const edges: PanelEdge[] = [];
  for (let ri = 0; ri < polys.length; ri++) {
    const ring = polys[ri];
    const isHole = ri >= 1;
    for (let i = 0; i + 1 < ring.length; i++) {
      edges.push({
        a: { x: ring[i][0], y: ring[i][1] },
        b: { x: ring[i + 1][0], y: ring[i + 1][1] },
        hole: isHole,
      });
    }
  }
  return edges;
}

function normalizeEdges(edges: PanelEdge[]): {
  widthM: number;
  heightM: number;
  minU: number;
  minV: number;
  edges: PanelEdge[];
} | null {
  if (edges.length < 3) return null;
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const e of edges) {
    minU = Math.min(minU, e.a.x, e.b.x);
    maxU = Math.max(maxU, e.a.x, e.b.x);
    minV = Math.min(minV, e.a.y, e.b.y);
    maxV = Math.max(maxV, e.a.y, e.b.y);
  }
  const w = maxU - minU;
  const h = maxV - minV;
  if (w < 0.01 || h < 0.01) return null;
  return {
    minU,
    minV,
    widthM: w,
    heightM: h,
    edges: edges.map((e) => ({
      a: { x: e.a.x - minU, y: e.a.y - minV },
      b: { x: e.b.x - minU, y: e.b.y - minV },
      hole: e.hole,
    })),
  };
}

function cutBbox(
  cut: Pick<UserCut, "kind" | "u0" | "v0" | "u1" | "v1">,
): { minU: number; maxU: number; minV: number; maxV: number } {
  const { u0, v0, u1, v1, kind } = cut;
  let minU = Math.min(u0, u1);
  let maxU = Math.max(u0, u1);
  let minV = Math.min(v0, v1);
  let maxV = Math.max(v0, v1);

  if (kind === "square") {
    const side = Math.max(maxU - minU, maxV - minV);
    maxU = minU + side;
    maxV = minV + side;
  }

  return { minU, maxU, minV, maxV };
}

function cutEllipseRadii(cut: Pick<UserCut, "kind" | "u0" | "v0" | "u1" | "v1">): {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
} {
  const { minU, maxU, minV, maxV } = cutBbox(cut);
  return {
    cx: (minU + maxU) / 2,
    cy: (minV + maxV) / 2,
    rx: (maxU - minU) / 2,
    ry: (maxV - minV) / 2,
  };
}

export function translateCut(cut: UserCut, du: number, dv: number): UserCut {
  return {
    ...cut,
    u0: cut.u0 + du,
    v0: cut.v0 + dv,
    u1: cut.u1 + du,
    v1: cut.v1 + dv,
  };
}

export function getCutPanelMargins(
  cut: Pick<UserCut, "kind" | "u0" | "v0" | "u1" | "v1">,
  panelWidthM: number,
  panelHeightM: number,
): { top: number; left: number; right: number; bottom: number } {
  const resolved = resolveCutDrag({
    groupId: 0,
    kind: cut.kind,
    u0: cut.u0,
    v0: cut.v0,
    u1: cut.u1,
    v1: cut.v1,
    shiftKey: false,
  });
  const { minU, maxU, minV, maxV } = cutBbox({ ...cut, ...resolved });
  return {
    left: Math.max(0, minU),
    right: Math.max(0, panelWidthM - maxU),
    bottom: Math.max(0, minV),
    top: Math.max(0, panelHeightM - maxV),
  };
}

function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-12) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * True when (u,v) is on the **perimeter** of an existing cut (for move tool).
 * Interior clicks intentionally miss so you can draw new cuts inside existing ones.
 */
export function hitTestCut(
  cut: UserCut,
  u: number,
  v: number,
  panelWidthM: number,
  panelHeightM: number,
  tolerance = 0.05,
): boolean {
  void panelWidthM;
  void panelHeightM;
  const resolved = resolveCutDrag({
    groupId: cut.groupId,
    kind: cut.kind,
    u0: cut.u0,
    v0: cut.v0,
    u1: cut.u1,
    v1: cut.v1,
    shiftKey: false,
  });

  if (cut.kind === "line") {
    return (
      distToSegment(u, v, resolved.u0, resolved.v0, resolved.u1, resolved.v1) <= tolerance
    );
  }

  if (cut.kind === "circle") {
    const { cx, cy, rx, ry } = cutEllipseRadii({ ...cut, ...resolved });
    if (rx < 0.01 || ry < 0.01) return false;
    // Distance to ellipse perimeter in normalised space
    const nx = (u - cx) / rx;
    const ny = (v - cy) / ry;
    const dist = Math.sqrt(nx * nx + ny * ny);
    // Hit only the ring itself, not the interior
    const tolN = tolerance / Math.min(rx, ry);
    return Math.abs(dist - 1) <= tolN;
  }

  // Rect: hit only the four edges, not the interior
  const { minU, maxU, minV, maxV } = cutBbox({ ...cut, ...resolved });
  const onHEdge =
    u >= minU - tolerance &&
    u <= maxU + tolerance &&
    (Math.abs(v - minV) <= tolerance || Math.abs(v - maxV) <= tolerance);
  const onVEdge =
    v >= minV - tolerance &&
    v <= maxV + tolerance &&
    (Math.abs(u - minU) <= tolerance || Math.abs(u - maxU) <= tolerance);
  return (
    onHEdge || onVEdge
  );
}
/** Closed ring for a cut shape in panel-local metres (preview / derived groups). */
export function cutShapePolygon(
  cut: UserCut,
  widthM: number,
  heightM: number,
): [number, number][] | null {
  const { kind } = cut;
  const resolved = resolveCutDrag({
    groupId: cut.groupId,
    kind: cut.kind,
    u0: cut.u0,
    v0: cut.v0,
    u1: cut.u1,
    v1: cut.v1,
    shiftKey: false,
  });

  if (kind === "line") return null;

  if (kind === "circle") {
    const { cx, cy, rx, ry } = cutEllipseRadii({ ...cut, ...resolved });
    if (rx < 0.02 || ry < 0.02) return null;
    const steps = CUT_CIRCLE_SEGMENTS;
    const ring: [number, number][] = [];
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * Math.PI * 2;
      ring.push([cx + Math.cos(t) * rx, cy + Math.sin(t) * ry]);
    }
    return ring;
  }

  let { minU, maxU, minV, maxV } = cutBbox({ ...cut, ...resolved });

  if (maxU - minU < 0.02 || maxV - minV < 0.02) return null;

  minU = Math.max(0, minU);
  minV = Math.max(0, minV);
  maxU = Math.min(widthM, maxU);
  maxV = Math.min(heightM, maxV);

  return [
    [minU, minV],
    [maxU, minV],
    [maxU, maxV],
    [minU, maxV],
    [minU, minV],
  ];
}

/** Clip edges by half-plane defined by directed line (u0,v0)→(u1,v1). */
function clipPanelByLine(
  edges: PanelEdge[],
  u0: number,
  v0: number,
  u1: number,
  v1: number,
  keepPositive: boolean,
): PanelEdge[] | null {
  const dx = u1 - u0;
  const dy = v1 - v0;
  const side = (p: { x: number; y: number }) => {
    const cross = dx * (p.y - v0) - dy * (p.x - u0);
    return keepPositive ? cross >= -1e-9 : cross <= 1e-9;
  };

  const out: PanelEdge[] = [];
  const crossings: { x: number; y: number }[] = [];

  for (const e of edges) {
    const aIn = side(e.a);
    const bIn = side(e.b);
    if (aIn && bIn) {
      out.push(e);
    } else if (!aIn && !bIn) {
      continue;
    } else {
      const denom = (e.b.x - e.a.x) * dy - (e.b.y - e.a.y) * dx;
      if (Math.abs(denom) < 1e-12) continue;
      const t =
        ((u0 - e.a.x) * dy - (v0 - e.a.y) * dx) / denom;
      const ix = e.a.x + t * (e.b.x - e.a.x);
      const iy = e.a.y + t * (e.b.y - e.a.y);
      const cutPt = { x: ix, y: iy };
      crossings.push(cutPt);
      const keep = aIn ? e.a : e.b;
      out.push(aIn ? { a: keep, b: cutPt, hole: e.hole } : { a: cutPt, b: keep, hole: e.hole });
    }
  }

  if (crossings.length >= 2) {
    crossings.sort((a, b) => (a.x !== b.x ? a.x - b.x : a.y - b.y));
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      out.push({
        a: crossings[i],
        b: crossings[i + 1],
      });
    }
  }

  return out.length >= 3 ? out : null;
}

function applySingleCut(
  widthM: number,
  heightM: number,
  edges: PanelEdge[],
  cut: UserCut,
): { widthM: number; heightM: number; minU: number; minV: number; edges: PanelEdge[] }[] {
  if (cut.kind === "line") {
    const resolved = resolveCutDrag({
      groupId: cut.groupId,
      kind: cut.kind,
      u0: cut.u0,
      v0: cut.v0,
      u1: cut.u1,
      v1: cut.v1,
      shiftKey: false,
    });
    const pieces: {
      widthM: number;
      heightM: number;
      minU: number;
      minV: number;
      edges: PanelEdge[];
    }[] = [];

    for (const keepPositive of [true, false]) {
      const clipped = clipPanelByLine(
        edges,
        resolved.u0,
        resolved.v0,
        resolved.u1,
        resolved.v1,
        keepPositive,
      );
      if (!clipped) continue;
      const norm = normalizeEdges(clipped);
      if (norm && norm.widthM * norm.heightM >= 0.0001) {
        pieces.push({
          widthM: norm.widthM,
          heightM: norm.heightM,
          minU: norm.minU,
          minV: norm.minV,
          edges: norm.edges,
        });
      }
    }

    return pieces.length > 0
      ? pieces
      : [{ widthM, heightM, minU: 0, minV: 0, edges }];
  }

  const cutRing = cutShapePolygon(cut, widthM, heightM);
  if (!cutRing) return [{ widthM, heightM, minU: 0, minV: 0, edges }];

  const panelRings = edgesToPolygons(edges);
  if (panelRings.length === 0) return [{ widthM, heightM, minU: 0, minV: 0, edges }];

  const panelPoly: [number, number][][] = panelRings.map((ring) =>
    ring.map(([x, y]) => [snap(x), snap(y)] as [number, number]),
  );

  let result: [number, number][][][];
  try {
    result = difference(panelPoly, [[cutRing]]);
  } catch {
    return [{ widthM, heightM, minU: 0, minV: 0, edges }];
  }

  const pieces: { widthM: number; heightM: number; minU: number; minV: number; edges: PanelEdge[] }[] = [];
  for (const poly of result) {
    const sorted = [...poly].sort(
      (a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)),
    );
    const pieceEdges = polygonsToEdges(sorted);
    const norm = normalizeEdges(pieceEdges);
    if (norm && norm.widthM * norm.heightM >= 0.0001) {
      pieces.push({
        widthM: norm.widthM,
        heightM: norm.heightM,
        minU: norm.minU,
        minV: norm.minV,
        edges: norm.edges,
      });
    }
  }
  return pieces;
}

/** Apply all cuts for one panel; may split into several pieces. */
export function applyUserCutsToPanel(
  widthM: number,
  heightM: number,
  edges: PanelEdge[],
  cuts: UserCut[],
): { widthM: number; heightM: number; minU: number; minV: number; edges: PanelEdge[] }[] {
  let pieces: { widthM: number; heightM: number; minU: number; minV: number; edges: PanelEdge[] }[] = [
    { widthM, heightM, minU: 0, minV: 0, edges },
  ];

  for (const cut of cuts) {
    const next: typeof pieces = [];
    for (const piece of pieces) {
      next.push(
        ...applySingleCut(piece.widthM, piece.heightM, piece.edges, cut).map((p) => ({
          ...p,
          minU: p.minU + piece.minU,
          minV: p.minV + piece.minV,
        })),
      );
    }
    pieces = next.filter((p) => p.edges.length >= 3);
    if (pieces.length === 0) break;
  }

  return pieces.length > 0 ? pieces : [];
}

/** Outer boundary + holes for a panel piece described by contour edges. */
export function panelPiecePolygons(
  edges: PanelEdge[],
): { outer: [number, number][]; holes: [number, number][][] } | null {
  const rings = edgesToPolygons(edges);
  if (rings.length === 0) return null;
  const sorted = [...rings].sort(
    (a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)),
  );
  return { outer: sorted[0], holes: sorted.slice(1) };
}

/** Snap radius in panel metres (~6 cm, scales with panel size). */
export function panelEdgeSnapTolerance(widthM: number, heightM: number): number {
  const minDim = Math.min(widthM, heightM);
  return Math.max(0.06, minDim * 0.045);
}

function snapScalarToEdges(value: number, limit: number, tol: number): number {
  if (value <= tol) return 0;
  if (value >= limit - tol) return limit;
  return value;
}

function snapScalarPair(
  a: number,
  b: number,
  limit: number,
  tol: number,
): [number, number] {
  let lo = Math.min(a, b);
  let hi = Math.max(a, b);
  if (lo <= tol) lo = 0;
  if (hi >= limit - tol) hi = limit;
  if (hi - lo >= limit - 2 * tol) {
    lo = 0;
    hi = limit;
  }
  return a <= b ? [lo, hi] : [hi, lo];
}

/** Snap cut drag coords to panel edges (sticky borders for full-wall cuts). */
export function snapCutDragToPanelEdges(
  state: CutDragState,
  panelSize: { widthM: number; heightM: number },
  enabled: boolean,
): CutDragState {
  if (!enabled) return state;
  const tol = panelEdgeSnapTolerance(panelSize.widthM, panelSize.heightM);
  const { widthM, heightM } = panelSize;
  let { u0, v0, u1, v1 } = state;

  if (state.kind === "line") {
    u0 = snapScalarToEdges(u0, widthM, tol);
    u1 = snapScalarToEdges(u1, widthM, tol);
    v0 = snapScalarToEdges(v0, heightM, tol);
    v1 = snapScalarToEdges(v1, heightM, tol);
    return { ...state, u0, v0, u1, v1 };
  }

  [u0, u1] = snapScalarPair(u0, u1, widthM, tol);
  [v0, v1] = snapScalarPair(v0, v1, heightM, tol);
  return { ...state, u0, v0, u1, v1 };
}

/** Snap a single UV point (drag start / hover). */
export function snapPointToPanelEdges(
  u: number,
  v: number,
  panelSize: { widthM: number; heightM: number },
  enabled: boolean,
): { u: number; v: number } {
  if (!enabled) return { u, v };
  const tol = panelEdgeSnapTolerance(panelSize.widthM, panelSize.heightM);
  return {
    u: snapScalarToEdges(u, panelSize.widthM, tol),
    v: snapScalarToEdges(v, panelSize.heightM, tol),
  };
}

/** Which panel edges are within snap range (for UI hints). */
export function panelEdgeSnapHints(
  u: number,
  v: number,
  panelSize: { widthM: number; heightM: number },
): { left: boolean; right: boolean; bottom: boolean; top: boolean } {
  const tol = panelEdgeSnapTolerance(panelSize.widthM, panelSize.heightM);
  return {
    left: u <= tol,
    right: u >= panelSize.widthM - tol,
    bottom: v <= tol,
    top: v >= panelSize.heightM - tol,
  };
}

/** Resolve drag end coords with Shift constraints. */
export function resolveCutDrag(state: CutDragState): Pick<UserCut, "u0" | "v0" | "u1" | "v1"> {
  let { u0, v0, u1, v1, kind, shiftKey } = state;
  const du = u1 - u0;
  const dv = v1 - v0;

  if (kind === "square") {
    const side = Math.max(Math.abs(du), Math.abs(dv));
    u1 = u0 + Math.sign(du || 1) * side;
    v1 = v0 + Math.sign(dv || 1) * side;
  } else if (kind === "circle" && shiftKey) {
    const side = Math.max(Math.abs(du), Math.abs(dv));
    u1 = u0 + Math.sign(du || 1) * side;
    v1 = v0 + Math.sign(dv || 1) * side;
  } else if (kind === "line" && shiftKey) {
    if (Math.abs(du) >= Math.abs(dv)) {
      v1 = v0;
    } else {
      u1 = u0;
    }
  } else if (kind === "rect" && shiftKey) {
    const side = Math.max(Math.abs(du), Math.abs(dv));
    u1 = u0 + Math.sign(du || 1) * side;
    v1 = v0 + Math.sign(dv || 1) * side;
  }

  return { u0, v0, u1, v1 };
}

export function cutDimensionsLabel(
  cut: Pick<UserCut, "kind" | "u0" | "v0" | "u1" | "v1">,
  panelSize?: { widthM: number; heightM: number },
): string {
  const fmt = (n: number) => `${Math.abs(n).toFixed(2).replace(".", ",")} m`;
  const resolved = resolveCutDrag({
    groupId: 0,
    kind: cut.kind,
    u0: cut.u0,
    v0: cut.v0,
    u1: cut.u1,
    v1: cut.v1,
    shiftKey: false,
  });
  const merged = { ...cut, ...resolved };

  let sizePart: string;
  if (cut.kind === "line") {
    sizePart = fmt(Math.hypot(resolved.u1 - resolved.u0, resolved.v1 - resolved.v0));
  } else if (cut.kind === "circle") {
    const { minU, maxU, minV, maxV } = cutBbox(merged);
    const w = maxU - minU;
    const h = maxV - minV;
    sizePart =
      Math.abs(w - h) < 0.02
        ? `Ø ${fmt(Math.max(w, h))}`
        : `${fmt(w)} × ${fmt(h)}`;
  } else {
    const { minU, maxU, minV, maxV } = cutBbox(merged);
    sizePart = `${fmt(maxU - minU)} × ${fmt(maxV - minV)}`;
  }

  if (!panelSize || cut.kind === "line") return sizePart;

  const margins = getCutPanelMargins(merged, panelSize.widthM, panelSize.heightM);
  return `${sizePart} · ↑ ${fmt(margins.top)} · ← ${fmt(margins.left)}`;
}

export function createUserCutId(): string {
  return `cut-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** API / backend serialisation (snake_case). */
export function serializeUserCutsForApi(cuts: UserCut[]): Record<string, unknown>[] {
  return cuts.map((c) => ({
    id: c.id,
    group_id: c.groupId,
    kind: c.kind,
    u0: c.u0,
    v0: c.v0,
    u1: c.u1,
    v1: c.v1,
    ...(c.keepPositive != null ? { keep_positive: c.keepPositive } : {}),
    ...(c.surfaceNormal
      ? {
          surface_normal: {
            x: c.surfaceNormal.x,
            y: c.surfaceNormal.y,
            z: c.surfaceNormal.z,
          },
        }
      : {}),
    ...(c.surfaceOffset != null ? { surface_offset: c.surfaceOffset } : {}),
  }));
}

export function parseUserCutsFromApi(raw: unknown): UserCut[] {
  if (!Array.isArray(raw)) return [];
  const out: UserCut[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (typeof o.group_id !== "number" || typeof o.kind !== "string") continue;
    out.push({
      id: String(o.id ?? createUserCutId()),
      groupId: o.group_id,
      kind: o.kind as CutShapeKind,
      u0: Number(o.u0),
      v0: Number(o.v0),
      u1: Number(o.u1),
      v1: Number(o.v1),
      keepPositive: o.keep_positive != null ? Boolean(o.keep_positive) : undefined,
      ...(o.surface_normal && typeof o.surface_normal === "object"
        ? {
            surfaceNormal: {
              x: Number((o.surface_normal as Record<string, unknown>).x),
              y: Number((o.surface_normal as Record<string, unknown>).y),
              z: Number((o.surface_normal as Record<string, unknown>).z),
            },
          }
        : {}),
      ...(o.surface_offset != null ? { surfaceOffset: Number(o.surface_offset) } : {}),
    });
  }
  return out;
}
