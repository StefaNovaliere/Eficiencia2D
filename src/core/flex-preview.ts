/**
 * Preview 3D ESQUEMÁTICO del patrón de flexión (kerf / auxético) sobre la cara
 * del componente seleccionado. NO autoritativo: sólo comunica densidad y
 * orientación. La geometría real la genera el backend (ver CONTRATO_kerf_auxetico.md).
 *
 * Calca el camino de `mark-preview.ts`: proyecta la cara del grupo a 2D, arma los
 * segmentos del patrón en el marco del panel y los mapea de vuelta a 3D.
 */
import type { Face3D, Vec3 } from "@/core/types";
import type { GeometryGroup } from "@/core/group-classifier";
import { projectFacesTo2D } from "@/core/panel-projection";
import { flexPatternSegments2D, type FlexSpec } from "@/core/flex-bending";

type UpAxis = "Y" | "Z";

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** Map panel (u,v) back onto the group's tangent plane. */
function panel2DTo3D(u: number, v: number, uAxis: Vec3, vAxis: Vec3, anchor: Vec3): Vec3 {
  const au = dot(anchor, uAxis);
  const av = dot(anchor, vAxis);
  return {
    x: anchor.x + (u - au) * uAxis.x + (v - av) * vAxis.x,
    y: anchor.y + (u - au) * uAxis.y + (v - av) * vAxis.y,
    z: anchor.z + (u - au) * uAxis.z + (v - av) * vAxis.z,
  };
}

export interface FlexPreviewSegment {
  a: Vec3;
  b: Vec3;
}

export interface FlexPreviewGroupLines {
  groupId: number;
  /** Normal saliente del panel — para ocultar líneas de la cara trasera. */
  normal: Vec3;
  segments: FlexPreviewSegment[];
}

export function computeFlexPreview3D(
  faces: Face3D[],
  groups: GeometryGroup[],
  specs: FlexSpec[],
  up: UpAxis,
  hiddenGroupIds: Set<number> = new Set(),
): FlexPreviewGroupLines[] {
  if (specs.length === 0) return [];
  const specByGroup = new Map(specs.map((s) => [s.groupId, s]));
  const result: FlexPreviewGroupLines[] = [];

  for (const group of groups) {
    const spec = specByGroup.get(group.id);
    if (!spec || hiddenGroupIds.has(group.id)) continue;

    const groupFaces = group.faceIndices
      .map((fi) => faces[fi])
      .filter((f): f is Face3D => !!f && f.vertices.length >= 3);
    if (groupFaces.length === 0) continue;

    const projected = projectFacesTo2D(groupFaces, group.representativeNormal, up);
    if (!projected || projected.widthM <= 0 || projected.heightM <= 0) continue;

    const segs2d = flexPatternSegments2D(spec, projected.widthM, projected.heightM);
    if (segs2d.length === 0) continue;

    const anchor = groupFaces[0].vertices[0];
    const { uAxis, vAxis, originU, originV } = projected;

    const nlen = Math.hypot(
      group.representativeNormal.x,
      group.representativeNormal.y,
      group.representativeNormal.z,
    );
    const bias = nlen > 1e-6 ? 0.002 : 0;
    const nx = nlen > 1e-6 ? (group.representativeNormal.x / nlen) * bias : 0;
    const ny = nlen > 1e-6 ? (group.representativeNormal.y / nlen) * bias : 0;
    const nz = nlen > 1e-6 ? (group.representativeNormal.z / nlen) * bias : 0;

    const normal =
      nlen > 1e-6
        ? {
            x: group.representativeNormal.x / nlen,
            y: group.representativeNormal.y / nlen,
            z: group.representativeNormal.z / nlen,
          }
        : group.representativeNormal;

    const segments: FlexPreviewSegment[] = [];
    for (const s of segs2d) {
      const a = panel2DTo3D(s.u0 + originU, s.v0 + originV, uAxis, vAxis, anchor);
      const b = panel2DTo3D(s.u1 + originU, s.v1 + originV, uAxis, vAxis, anchor);
      segments.push({
        a: { x: a.x + nx, y: a.y + ny, z: a.z + nz },
        b: { x: b.x + nx, y: b.y + ny, z: b.z + nz },
      });
    }

    result.push({ groupId: group.id, normal, segments });
  }

  return result;
}
