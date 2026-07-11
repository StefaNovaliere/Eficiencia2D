/**
 * Geometría de preview (NO autoritativa) de nervios/columnas para el visor de
 * Revisión. La pieza real (con encastres/muescas) la genera el backend; acá sólo
 * mostramos un esquema en la ubicación pedida para que el usuario vea qué agregó.
 */

import type { GeometryGroup } from "@/core/group-classifier";
import type { Vec3 } from "@/core/types";
import { buildColumnGeometry, buildRibGeometry, type Rib, type Column } from "@/core/reinforcements";

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v.x, v.y, v.z);
  return l > 1e-9 ? { x: v.x / l, y: v.y / l, z: v.z / l } : { x: 0, y: 0, z: 0 };
}

/**
 * Triángulos combinados (coords de mundo) de todos los refuerzos, para un mesh
 * de overlay. Columnas = caja en su posición; nervios = cartela esquemática en la
 * unión de los centroides de las dos placas.
 */
export function computeReinforcementsGeometry(
  ribs: Rib[],
  columns: Column[],
  groups: GeometryGroup[],
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
    const corner: Vec3 = {
      x: (A.centroid.x + B.centroid.x) / 2,
      y: (A.centroid.y + B.centroid.y) / 2,
      z: (A.centroid.z + B.centroid.z) / 2,
    };
    const dirA = normalize(sub(A.centroid, corner));
    const dirB = normalize(sub(B.centroid, corner));
    const thicknessM = Math.max(r.sizeM * 0.06, 0.01);
    const g = buildRibGeometry(corner, dirA, dirB, r.sizeM, thicknessM);
    out.push(...g.caps, ...g.walls);
  }

  return out;
}
