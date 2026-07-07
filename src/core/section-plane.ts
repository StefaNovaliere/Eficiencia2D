/**
 * Plano de sección (corte) del visor: helper puro que calcula normal + constante
 * de un THREE.Plane a partir del eje, la posición 0..1 y el AABB del modelo.
 * La escena está centrada (meshes dentro de un group trasladado por -center), así
 * que el plano va en coords de mundo = coord de modelo − center.
 */
export type SectionAxis = "x" | "y" | "z";

export interface SectionPlaneParams {
  normal: { x: number; y: number; z: number };
  constant: number;
}

/**
 * @param axis   eje del corte
 * @param pos    posición 0..1 dentro del rango del modelo en ese eje
 * @param min    AABB mínimo (coords de modelo)
 * @param max    AABB máximo (coords de modelo)
 * @param center centro del modelo (el offset de la escena)
 *
 * Se conserva el lado con coordenada MENOR al corte (normal = −eje), de modo que
 * subir `pos` va "pelando" material desde el frente.
 */
export function sectionPlaneParams(
  axis: SectionAxis,
  pos: number,
  min: { x: number; y: number; z: number },
  max: { x: number; y: number; z: number },
  center: { x: number; y: number; z: number },
): SectionPlaneParams {
  const t = Math.min(1, Math.max(0, pos));
  const lo = min[axis];
  const hi = max[axis];
  const cutModel = lo + (hi - lo) * t;
  const cutWorld = cutModel - center[axis];
  const normal = { x: 0, y: 0, z: 0 };
  normal[axis] = -1;
  // Plano n·p + c = 0 con n = −eje ⇒ se conserva coord < cutWorld.
  return { normal, constant: cutWorld };
}
