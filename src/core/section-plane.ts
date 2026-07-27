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
 * @param invert dirección del corte. `false` (default) conserva el lado de
 *               coordenada MENOR (pela desde el máximo hacia el mínimo);
 *               `true` conserva el lado MAYOR (pela desde el otro extremo).
 *
 * En ambos casos vale la convención de three.js: se conserva el semiespacio con
 * `distanceToPoint(p) >= 0`. El filtrado del raycast usa el MISMO criterio.
 */
export function sectionPlaneParams(
  axis: SectionAxis,
  pos: number,
  min: { x: number; y: number; z: number },
  max: { x: number; y: number; z: number },
  center: { x: number; y: number; z: number },
  invert = false,
): SectionPlaneParams {
  const t = Math.min(1, Math.max(0, pos));
  const lo = min[axis];
  const hi = max[axis];
  const cutModel = lo + (hi - lo) * t;
  const cutWorld = cutModel - center[axis];
  const normal = { x: 0, y: 0, z: 0 };

  if (invert) {
    // n = +eje, c = −cutWorld ⇒ distancia = p·eje − cutWorld ≥ 0 ⇒ conserva p·eje ≥ cutWorld.
    normal[axis] = 1;
    return { normal, constant: -cutWorld };
  }

  // n = −eje, c = cutWorld ⇒ distancia = cutWorld − p·eje ≥ 0 ⇒ conserva p·eje ≤ cutWorld.
  normal[axis] = -1;
  return { normal, constant: cutWorld };
}
