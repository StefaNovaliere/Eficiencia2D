import type { FaceCategory, GeometryGroup } from "./group-classifier";

/** Tolerancia en m² (0.01 ≈ 100 cm²). */
export const AREA_MATCH_TOLERANCE_M2 = 0.01;

export function areaMatchKey(area: number): number {
  return Math.round(area / AREA_MATCH_TOLERANCE_M2) * AREA_MATCH_TOLERANCE_M2;
}

export function areasMatch(a: number, b: number): boolean {
  return areaMatchKey(a) === areaMatchKey(b);
}

function effectiveCategory(
  group: GeometryGroup,
  overrides?: Map<number, FaceCategory>,
): FaceCategory {
  return overrides?.get(group.id) ?? group.category;
}

/**
 * Candidatos para descarte masivo por tamaño.
 * Exige misma área, orientación y categoría — evita mezclar ventanas con tramos de muro distintos.
 */
export function findGroupsWithSameArea(
  groups: GeometryGroup[],
  reference: GeometryGroup,
  overrides?: Map<number, FaceCategory>,
): GeometryGroup[] {
  const refCat = effectiveCategory(reference, overrides);
  const key = areaMatchKey(reference.totalArea);

  return groups.filter((g) => {
    if (g.id === reference.id) return false;
    if (areaMatchKey(g.totalArea) !== key) return false;
    if (g.orientation !== reference.orientation) return false;
    if (effectiveCategory(g, overrides) !== refCat) return false;
    return true;
  });
}
