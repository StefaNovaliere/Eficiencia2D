/**
 * Conectividad para fusión de paredes: coplanares Y en contacto físico.
 *
 * Dos paredes en el mismo plano pero separadas (hueco / vano / distancia)
 * NO deben fusionarse. El cluster a fusionar tiene que ser un único
 * componente conexo bajo la relación "se tocan".
 */

import type { GeometryGroup } from "./group-classifier";
import type { Face3D, Vec3 } from "./types";
import type { Joint } from "./joint-detector";

/** Tolerancia de coplanaridad (normal + distancia al plano), en metros. */
const COPLANAR_EPS = 0.02;

/**
 * Holgura para considerar que dos AABB en el plano se tocan (malla / espesor).
 * ~5 cm cubre bordes compartidos sin unir vanos típicos de puertas.
 */
const TOUCH_GAP_M = 0.05;

/** |dihedral − π| bajo esto ⇒ arista compartida casi plana (contacto coplanar). */
const FLAT_DIHEDRAL_EPS = 0.25; // ~14°

export interface PlaneBounds2D {
  minU: number;
  maxU: number;
  minV: number;
  maxV: number;
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

function normalize(v: Vec3): Vec3 | null {
  const len = Math.hypot(v.x, v.y, v.z);
  if (!(len > 1e-12)) return null;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

/** Misma orientación (±) y mismo plano (distancia centroide→plano). */
export function areGroupsCoplanar(a: GeometryGroup, b: GeometryGroup): boolean {
  const na = a.representativeNormal;
  const nb = b.representativeNormal;
  const d = dot(na, nb);
  if (Math.abs(Math.abs(d) - 1) > COPLANAR_EPS) return false;
  const ca = a.centroid;
  const cb = b.centroid;
  const planeDist =
    (cb.x - ca.x) * na.x + (cb.y - ca.y) * na.y + (cb.z - ca.z) * na.z;
  return Math.abs(planeDist) < COPLANAR_EPS;
}

/** Base ortonormal (u, v) del plano de la pared. */
function planeBasis(normal: Vec3): { u: Vec3; v: Vec3 } | null {
  const n = normalize(normal);
  if (!n) return null;
  const ref =
    Math.abs(n.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const u = normalize(cross(ref, n));
  if (!u) return null;
  const v = cross(n, u);
  return { u, v };
}

/** AABB de las caras del grupo proyectadas al plano (`origin` + `u`/`v` compartidos). */
export function groupPlaneBounds(
  group: GeometryGroup,
  faces: Face3D[],
  origin: Vec3,
  basis: { u: Vec3; v: Vec3 },
): PlaneBounds2D | null {
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  let any = false;

  for (const fi of group.faceIndices) {
    const face = faces[fi];
    if (!face) continue;
    for (const p of face.vertices) {
      const dx = p.x - origin.x;
      const dy = p.y - origin.y;
      const dz = p.z - origin.z;
      const uu = dx * basis.u.x + dy * basis.u.y + dz * basis.u.z;
      const vv = dx * basis.v.x + dy * basis.v.y + dz * basis.v.z;
      minU = Math.min(minU, uu);
      maxU = Math.max(maxU, uu);
      minV = Math.min(minV, vv);
      maxV = Math.max(maxV, vv);
      any = true;
    }
  }
  if (!any || !Number.isFinite(minU)) return null;
  return { minU, maxU, minV, maxV };
}

/** ¿Los AABB 2D se solapan o quedan a ≤ gap metros? */
export function planeBoundsTouch(
  a: PlaneBounds2D,
  b: PlaneBounds2D,
  gapM = TOUCH_GAP_M,
): boolean {
  const g = Math.max(0, gapM);
  if (a.maxU + g < b.minU || b.maxU + g < a.minU) return false;
  if (a.maxV + g < b.minV || b.maxV + g < a.minV) return false;
  return true;
}

function jointIsFlatContact(joint: Joint): boolean {
  const a = Math.abs(joint.dihedralAngle);
  const toPi = Math.min(Math.abs(a - Math.PI), Math.abs(a));
  return toPi < FLAT_DIHEDRAL_EPS;
}

/**
 * ¿Dos paredes coplanares están unidas (se tocan)?
 * Usa AABB en el mismo marco del plano + juntas casi planas del backend.
 */
export function areCoplanarWallsUnited(
  a: GeometryGroup,
  b: GeometryGroup,
  faces: Face3D[],
  joints?: Joint[],
): boolean {
  if (a.id === b.id) return true;
  if (!areGroupsCoplanar(a, b)) return false;

  if (joints) {
    for (const j of joints) {
      const pair =
        (j.groupA === a.id && j.groupB === b.id) ||
        (j.groupA === b.id && j.groupB === a.id);
      if (pair && jointIsFlatContact(j)) return true;
    }
  }

  const basis = planeBasis(a.representativeNormal);
  if (!basis) return false;
  // Mismo origen para ambos: si no, cada AABB está centrado en su centroide
  // y siempre se “tocan” en coordenadas locales.
  const origin = a.centroid;
  const ba = groupPlaneBounds(a, faces, origin, basis);
  const bb = groupPlaneBounds(b, faces, origin, basis);
  if (!ba || !bb) return false;
  return planeBoundsTouch(ba, bb);
}

/** Grafo de adyacencia (contacto) entre paredes coplanares. */
function buildUnitedAdj(
  walls: GeometryGroup[],
  faces: Face3D[],
  joints?: Joint[],
): Map<number, Set<number>> {
  const adj = new Map<number, Set<number>>();
  const ensure = (id: number) => {
    let s = adj.get(id);
    if (!s) {
      s = new Set();
      adj.set(id, s);
    }
    return s;
  };
  for (const w of walls) ensure(w.id);

  for (let i = 0; i < walls.length; i++) {
    for (let j = i + 1; j < walls.length; j++) {
      const a = walls[i];
      const b = walls[j];
      if (!areCoplanarWallsUnited(a, b, faces, joints)) continue;
      ensure(a.id).add(b.id);
      ensure(b.id).add(a.id);
    }
  }
  return adj;
}

/** Componente conexo (BFS) que contiene `seedId` dentro de `walls`. */
export function connectedUnitedWallIds(
  seedId: number,
  walls: GeometryGroup[],
  faces: Face3D[],
  joints?: Joint[],
): number[] {
  const byId = new Map(walls.map((w) => [w.id, w]));
  if (!byId.has(seedId)) return [];
  const adj = buildUnitedAdj(walls, faces, joints);
  const seen = new Set<number>([seedId]);
  const queue = [seedId];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const nb of adj.get(cur) ?? []) {
      if (seen.has(nb)) continue;
      seen.add(nb);
      queue.push(nb);
    }
  }
  return [...seen];
}

/**
 * ¿Se puede fusionar esta selección?
 * Requiere ≥2 paredes, todas coplanares entre sí, y un solo componente unido.
 */
export function evaluateWallMergeSelection(
  walls: GeometryGroup[],
  faces: Face3D[],
  joints?: Joint[],
): { ok: boolean; reason: string | null; cluster: number[] } {
  if (walls.length < 2) {
    return { ok: false, reason: null, cluster: [] };
  }

  const ref = walls[0];
  for (let i = 1; i < walls.length; i++) {
    if (!areGroupsCoplanar(ref, walls[i])) {
      return {
        ok: false,
        reason: "Solo se pueden fusionar paredes coplanares y unidas.",
        cluster: [],
      };
    }
  }

  const adj = buildUnitedAdj(walls, faces, joints);
  const seed = walls[0].id;
  const seen = new Set<number>([seed]);
  const queue = [seed];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const nb of adj.get(cur) ?? []) {
      if (seen.has(nb)) continue;
      seen.add(nb);
      queue.push(nb);
    }
  }

  if (seen.size < walls.length) {
    return {
      ok: false,
      reason:
        "Hay paredes en el mismo plano pero separadas: solo se pueden fusionar si están unidas.",
      cluster: [],
    };
  }

  return { ok: true, reason: null, cluster: walls.map((w) => w.id) };
}
