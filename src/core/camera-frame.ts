/**
 * Helpers puros de encuadre de cámara para el visor 3D (testeables, sin three).
 */

/**
 * Distancia de cámara (perspectiva) para que una esfera envolvente de radio
 * `radiusM` entre en el campo de visión vertical `fovDeg`, con un margen.
 */
export function frameDistance(radiusM: number, fovDeg: number, margin = 1.3): number {
  const r = Math.max(radiusM, 1e-3);
  const fov = (Math.max(1, Math.min(179, fovDeg)) * Math.PI) / 180;
  return (r / Math.sin(fov / 2)) * margin;
}

/** Radio de la esfera envolvente de un bbox (min/max en cada eje). */
export function boundingRadius(
  min: { x: number; y: number; z: number },
  max: { x: number; y: number; z: number },
): number {
  const dx = max.x - min.x;
  const dy = max.y - min.y;
  const dz = max.z - min.z;
  return 0.5 * Math.hypot(dx, dy, dz);
}

/** Centro de un bbox. */
export function boundingCenter(
  min: { x: number; y: number; z: number },
  max: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  return {
    x: (min.x + max.x) / 2,
    y: (min.y + max.y) / 2,
    z: (min.z + max.z) / 2,
  };
}
