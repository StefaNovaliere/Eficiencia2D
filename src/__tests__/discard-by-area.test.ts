import { describe, expect, it } from "vitest";
import {
  areaMatchKey,
  areasMatch,
  collectSimilarGroups,
  findGroupsWithSameArea,
  getEffectiveCategory,
} from "@/core/discard-by-area";
import type { GeometryGroup } from "@/core/group-classifier";

function mockGroup(
  id: number,
  area: number,
  opts?: Partial<Pick<GeometryGroup, "orientation" | "category">>,
): GeometryGroup {
  return {
    id,
    label: `G${id}`,
    category: opts?.category ?? "wall",
    faceIndices: [id],
    totalArea: area,
    centroid: { x: 0, y: 0, z: 0 },
    orientation: opts?.orientation ?? "vertical",
    representativeNormal: { x: 0, y: 1, z: 0 },
  };
}

describe("discard-by-area", () => {
  it("agrupa áreas dentro de la tolerancia", () => {
    expect(areasMatch(1.204, 1.203)).toBe(true);
    expect(areasMatch(1.204, 1.22)).toBe(false);
  });

  it("encuentra capas con la misma área, orientación y categoría", () => {
    const groups = [
      mockGroup(1, 1.204),
      mockGroup(2, 1.204),
      mockGroup(3, 2.5),
      mockGroup(4, 1.203),
      mockGroup(5, 1.204, { orientation: "horizontal" }),
      mockGroup(6, 1.204, { category: "floor" }),
    ];
    const matches = findGroupsWithSameArea(groups, groups[0]);
    expect(matches.map((g) => g.id).sort()).toEqual([2, 4]);
  });

  it("usa claves de área estables", () => {
    expect(areaMatchKey(1.204)).toBe(areaMatchKey(1.203));
  });

  it("encuentra descartes iguales para reclasificación masiva", () => {
    const groups = [
      mockGroup(1, 0.45, { category: "discard" }),
      mockGroup(2, 0.45, { category: "discard" }),
      mockGroup(3, 0.45, { category: "wall" }),
      mockGroup(4, 0.45, { category: "discard", orientation: "horizontal" }),
    ];
    const matches = findGroupsWithSameArea(groups, groups[0]);
    expect(matches.map((g) => g.id)).toEqual([2]);
    expect(collectSimilarGroups(groups, groups[0]).map((g) => g.id)).toEqual([1, 2]);
  });

  it("getEffectiveCategory respeta overrides", () => {
    const g = mockGroup(1, 1, { category: "discard" });
    const overrides = new Map([[1, "wall" as const]]);
    expect(getEffectiveCategory(g, overrides)).toBe("wall");
  });
});
