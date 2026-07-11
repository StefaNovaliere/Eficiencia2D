/**
 * Geometría de preview (NO autoritativa) de nervios/columnas para el visor de
 * Revisión. La pieza real (con encastres/muescas) la genera el backend; acá sólo
 * mostramos un esquema en la ubicación pedida.
 *
 * El nervio se ancla en la **arista de intersección** de las dos placas ⊥ (p.ej.
 * pared-piso), como un soporte en la esquina, en la posición `t` a lo largo de la
 * arista. Los catetos de la cartela van perpendiculares a la arista, hacia el
 * interior de cada placa.
 */

import type { GeometryGroup } from "@/core/group-classifier";
import type { Face3D, Vec3 } from "@/core/types";
import { buildColumnGeometry, buildRibGeometry, type Rib, type Column } from "@/core/reinforcements";

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
function scale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}
function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v.x, v.y, v.z);
  return l > 1e-9 ? { x: v.x / l, y: v.y / l, z: v.z / l } : { x: 0, y: 0, z: 0 };
}

function groupVertices(g: GeometryGroup, faces: Face3D[]): Vec3[] {
  const out: Vec3[] = [];
  for (const fi of g.faceIndices) {
    const f = faces[fi];
    if (f?.vertices) out.push(...f.vertices);
  }
  return out;
}

export interface RibEdge {
  /** Punto sobre la arista en la posición pedida (`t`). */
  corner: Vec3;
  /** Cateto hacia el interior de la placa A (perpendicular a la arista). */
  dirA: Vec3;
  /** Cateto hacia el interior de la placa B. */
  dirB: Vec3;
}

/**
 * Arista de intersección de dos placas ⊥ y el punto en la posición `t`, con los
 * catetos hacia el interior de cada placa. `null` si son ~paralelas o no se cruzan.
 */
export function ribEdgeForGroups(
  gA: GeometryGroup,
  gB: GeometryGroup,
  faces: Face3D[],
  t: number,
): RibEdge | null {
  const nA = normalize(gA.representativeNormal);
  const nB = normalize(gB.representativeNormal);
  const dir = cross(nA, nB);
  const dirLen = Math.hypot(dir.x, dir.y, dir.z);
  if (dirLen < 1e-6) return null; // placas paralelas → sin arista
  const d = scale(dir, 1 / dirLen);

  // Punto sobre la línea de intersección de los dos planos.
  // P0 = ( (dA·(nB×dir)) + (dB·(dir×nA)) ) / |dir|²   (dir = nA×nB, sin normalizar)
  const dA = dot(nA, gA.centroid);
  const dB = dot(nB, gB.centroid);
  const denom = dot(dir, dir);
  const p0 = scale(
    add(scale(cross(nB, dir), dA), scale(cross(dir, nA), dB)),
    1 / denom,
  );

  // Clip de la arista al solape de ambas placas (proyección sobre `d`).
  const span = (g: GeometryGroup) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of groupVertices(g, faces)) {
      const s = dot(sub(v, p0), d);
      if (s < lo) lo = s;
      if (s > hi) hi = s;
    }
    return { lo, hi };
  };
  const sa = span(gA);
  const sb = span(gB);
  if (!Number.isFinite(sa.lo) || !Number.isFinite(sb.lo)) return null;
  let lo = Math.max(sa.lo, sb.lo);
  let hi = Math.min(sa.hi, sb.hi);
  if (hi <= lo) {
    // Sin solape real: usar el centro del tramo común aproximado.
    const mid = (Math.max(sa.lo, sb.lo) + Math.min(sa.hi, sb.hi)) / 2;
    lo = mid;
    hi = mid;
  }

  const s = lo + Math.min(Math.max(t, 0), 1) * (hi - lo);
  const corner = add(p0, scale(d, s));

  // Catetos: perpendiculares a la arista, en el plano de cada placa, hacia el
  // interior (centroide).
  const orient = (n: Vec3, centroid: Vec3): Vec3 => {
    let leg = normalize(cross(n, d));
    if (dot(leg, sub(centroid, corner)) < 0) leg = scale(leg, -1);
    return leg;
  };
  return { corner, dirA: orient(nA, gA.centroid), dirB: orient(nB, gB.centroid) };
}

/**
 * Triángulos combinados (coords de mundo) de todos los refuerzos, para un mesh
 * de overlay. Columnas = caja; nervios = cartela sobre la arista de intersección.
 */
export function computeReinforcementsGeometry(
  ribs: Rib[],
  columns: Column[],
  groups: GeometryGroup[],
  faces: Face3D[],
): number[] {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const out: number[] = [];

  for (const c of columns) {
    out.push(...buildColumnGeometry(c.position, c.heightM, c.sizeM));
  }

  for (const r of ribs) {
    const A = byId.get(r.groupA);
    const B = byId.get(r.groupB);
    if (!A || !B) continue;
    const edge = ribEdgeForGroups(A, B, faces, r.t);
    if (!edge) continue;
    const thicknessM = Math.max(r.sizeM * 0.06, 0.01);
    const g = buildRibGeometry(edge.corner, edge.dirA, edge.dirB, r.sizeM, thicknessM);
    out.push(...g.caps, ...g.walls);
  }

  return out;
}
