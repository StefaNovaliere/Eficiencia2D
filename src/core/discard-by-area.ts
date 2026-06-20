import type { FaceCategory, GeometryGroup } from "./group-classifier";

/** Tolerancia en m² (0.01 ≈ 100 cm²). */
export const AREA_MATCH_TOLERANCE_M2 = 0.01;

export function areaMatchKey(area: number): number {
  return Math.round(area / AREA_MATCH_TOLERANCE_M2) * AREA_MATCH_TOLERANCE_M2;
}

export function areasMatch(a: number, b: number): boolean {
  return areaMatchKey(a) === areaMatchKey(b);
}

export function getEffectiveCategory(
  group: GeometryGroup,
  overrides?: Map<number, FaceCategory>,
): FaceCategory {
  return overrides?.get(group.id) ?? group.category;
}

/**
 * Capas con la misma área, orientación y categoría efectiva que la referencia.
 * Sirve para descarte masivo o para reclasificar en bloque (p. ej. ventanas descartadas → pared).
 */
export function findGroupsWithSameArea(
  groups: GeometryGroup[],
  reference: GeometryGroup,
  overrides?: Map<number, FaceCategory>,
): GeometryGroup[] {
  const refCat = getEffectiveCategory(reference, overrides);
  const key = areaMatchKey(reference.totalArea);

  return groups.filter((g) => {
    if (g.id === reference.id) return false;
    if (areaMatchKey(g.totalArea) !== key) return false;
    if (g.orientation !== reference.orientation) return false;
    if (getEffectiveCategory(g, overrides) !== refCat) return false;
    return true;
  });
}

/** Referencia + todos los componentes similares (incluye la referencia). */
export function collectSimilarGroups(
  groups: GeometryGroup[],
  reference: GeometryGroup,
  overrides?: Map<number, FaceCategory>,
): GeometryGroup[] {
  return [reference, ...findGroupsWithSameArea(groups, reference, overrides)];
}
