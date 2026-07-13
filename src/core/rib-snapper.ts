/**
 * Snapping magnético de NERVIOS: dado el punto 3D donde apunta el mouse, busca
 * la junta placa↔placa (`PlateJoint`, arista exacta del backend) más cercana.
 * Si está a menos del umbral, el overlay muestra un "nervio fantasma" anclado a
 * esa esquina y el click lo fija en la posición `t` sobre la arista.
 *
 * Puro y testeable — la interacción vive en `RibSnapperOverlay`.
 */

import type { PlateJoint } from "@/core/pipeline";
import type { Vec3 } from "@/core/types";

export interface RibSnap {
  joint: PlateJoint;
  /** Posición sobre la arista a→b (0..1). */
  t: number;
  /** Punto de la arista más cercano al mouse (coords de mundo). */
  closest: Vec3;
  /** Distancia mouse→arista (m mundo). */
  distM: number;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** Punto más cercano del segmento a→b al punto p, con su parámetro t (0..1). */
export function closestPointOnSegment(
  p: Vec3,
  a: Vec3,
  b: Vec3,
): { t: number; point: Vec3 } {
  const ab = sub(b, a);
  const len2 = dot(ab, ab);
  const t = len2 > 1e-12 ? Math.min(Math.max(dot(sub(p, a), ab) / len2, 0), 1) : 0;
  return { t, point: { x: a.x + ab.x * t, y: a.y + ab.y * t, z: a.z + ab.z * t } };
}

/**
 * Junta más cercana al punto (imán). `null` si ninguna está a < `maxDistM`.
 */
export function findNearestJoint(
  point: Vec3,
  joints: PlateJoint[],
  maxDistM: number,
): RibSnap | null {
  let best: RibSnap | null = null;
  for (const joint of joints) {
    if (!joint?.a || !joint?.b) continue;
    const { t, point: closest } = closestPointOnSegment(point, joint.a, joint.b);
    const d = sub(point, closest);
    const distM = Math.hypot(d.x, d.y, d.z);
    if (distM <= maxDistM && (!best || distM < best.distM)) {
      best = { joint, t, closest, distM };
    }
  }
  return best;
}
