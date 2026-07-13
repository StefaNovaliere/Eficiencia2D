/**
 * Marcas de APOYO (rojas): dónde se apoya/pega un piso o estante sobre la cara
 * INTERIOR de una pared. Es el "mapa" de armado grabado en rojo.
 *
 * La geometría ya existe: el backend expone `PlateJoint {a,b,width, cutterId}`
 * (segmento de intersección placa↔placa en coords de mundo). El footprint se
 * dibuja como rectángulo a→b engrosado por `width`, desplazado un pelo sobre la
 * normal para no pelear con la malla (z-fighting).
 *
 * CLAVE (fix cara interior): la normal del grupo (`representativeNormal`) puede
 * mirar hacia AFUERA del volumen. Orientamos el offset POR JUNTA con dot product
 * contra el centroide de la placa que se apoya (la `cutter`): la marca queda
 * SIEMPRE del lado de la pared que mira hacia el piso — la cara interior donde
 * efectivamente se pega. Ver CONTRATO_marcas_apoyo_backend.md (preview no
 * autoritativo; el grabado real lo hace el backend).
 */

import type { PlateJoint } from "@/core/pipeline";
import type { Vec3 } from "@/core/types";

const EPS = 1e-9;
/** Separación de la marca sobre la cara (m) para evitar z-fighting. */
const SURFACE_BIAS_M = 0.0015;
/** Ancho de respaldo si el joint no trae `width` válido. */
const FALLBACK_WIDTH_M = 0.012;

function norm(v: Vec3): Vec3 | null {
  const l = Math.hypot(v.x, v.y, v.z);
  return l > EPS ? { x: v.x / l, y: v.y / l, z: v.z / l } : null;
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

/**
 * Normal de la cara orientada HACIA la placa que se apoya (interior), por junta.
 * `hacia = cutterCentroid − puntoMedioDelJoint`; si `dot(normal, hacia) < 0`, la
 * normal del grupo mira al lado contrario → se invierte.
 */
export function orientNormalTowardCutter(
  normal: Vec3,
  joint: Pick<PlateJoint, "a" | "b">,
  cutterCentroid: Vec3,
): Vec3 {
  const mid = {
    x: (joint.a.x + joint.b.x) / 2,
    y: (joint.a.y + joint.b.y) / 2,
    z: (joint.a.z + joint.b.z) / 2,
  };
  const toward = {
    x: cutterCentroid.x - mid.x,
    y: cutterCentroid.y - mid.y,
    z: cutterCentroid.z - mid.z,
  };
  return dot(normal, toward) >= 0
    ? normal
    : { x: -normal.x, y: -normal.y, z: -normal.z };
}

function pushTri(out: number[], a: Vec3, b: Vec3, c: Vec3): void {
  out.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
}

/** Rectángulo footprint de un joint (a→b engrosado `width`), con offset sobre `n`. */
function jointFootprint(joint: PlateJoint, n: Vec3, out: number[]): void {
  const dir = norm({
    x: joint.b.x - joint.a.x,
    y: joint.b.y - joint.a.y,
    z: joint.b.z - joint.a.z,
  });
  if (!dir) return;
  const perpRaw = cross(n, dir);
  const perp = norm(perpRaw);
  if (!perp) return;
  const half = Number.isFinite(joint.width) && joint.width > 0 ? joint.width / 2 : FALLBACK_WIDTH_M / 2;
  const off = { x: n.x * SURFACE_BIAS_M, y: n.y * SURFACE_BIAS_M, z: n.z * SURFACE_BIAS_M };
  const P = (base: Vec3, s: number): Vec3 => ({
    x: base.x + perp.x * half * s + off.x,
    y: base.y + perp.y * half * s + off.y,
    z: base.z + perp.z * half * s + off.z,
  });
  const a1 = P(joint.a, 1);
  const a2 = P(joint.a, -1);
  const b1 = P(joint.b, 1);
  const b2 = P(joint.b, -1);
  pushTri(out, a1, a2, b1);
  pushTri(out, a2, b2, b1);
}

/**
 * Footprint (triángulos, coords de mundo) de las juntas de apoyo de un grupo,
 * para pintar en rojo sobre la CARA INTERIOR.
 *
 * - `cutterCentroids`: centroide por id de grupo (para orientar la normal hacia
 *   la placa que se apoya, POR JUNTA — una pared puede recibir pisos de ambos
 *   lados). Si falta el centroide de un joint, se usa la normal tal cual.
 * - `surfaceOnly` (default true): si el backend ya marcó `kind`, sólo toma las
 *   `surface` (apoyo pegado). Sin flags, muestra todas (preview).
 */
export function computeSupportMarks3D(
  joints: PlateJoint[],
  normal: Vec3,
  cutterCentroids?: Map<number, Vec3>,
  opts?: { surfaceOnly?: boolean },
): number[] {
  if (joints.length === 0) return [];
  const surfaceOnly = opts?.surfaceOnly ?? true;
  const anyFlagged = joints.some((j) => j.kind === "slot" || j.kind === "surface");
  const chosen =
    surfaceOnly && anyFlagged ? joints.filter((j) => j.kind === "surface") : joints;
  if (chosen.length === 0) return [];

  const n0 = norm(normal) ?? { x: 0, y: 0, z: 1 };
  const out: number[] = [];
  for (const joint of chosen) {
    const centroid = cutterCentroids?.get(joint.cutterId);
    const n = centroid ? orientNormalTowardCutter(n0, joint, centroid) : n0;
    jointFootprint(joint, n, out);
  }
  return out;
}
