import { describe, it, expect } from "vitest";
import {
  serializeRibsForApi,
  serializeColumnsForApi,
  buildRibGeometry,
  buildColumnGeometry,
  removeRib,
  removeColumn,
  type Rib,
  type Column,
} from "@/core/reinforcements";

const RIB: Rib = { id: "rib-1", groupA: 2, groupB: 5, sizeM: 0.3 };
const COL: Column = { id: "col-1", position: { x: 1, y: 0, z: 2 }, heightM: 3, sizeM: 0.2 };

describe("serialización", () => {
  it("nervios → snake_case", () => {
    expect(serializeRibsForApi([RIB])[0]).toEqual({
      id: "rib-1",
      group_a: 2,
      group_b: 5,
      size_m: 0.3,
    });
  });
  it("columnas → snake_case con position [x,y,z]", () => {
    expect(serializeColumnsForApi([COL])[0]).toEqual({
      id: "col-1",
      position: [1, 0, 2],
      height_m: 3,
      size_m: 0.2,
    });
  });
});

describe("remove", () => {
  it("nervios y columnas por id", () => {
    expect(removeRib([RIB], "rib-1")).toEqual([]);
    expect(removeColumn([COL], "col-1")).toEqual([]);
  });
});

describe("geometría esquemática", () => {
  it("cartela: slab a partir de un triángulo rectángulo", () => {
    const g = buildRibGeometry(
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      0.3,
      0.02,
    );
    // 1 triángulo → 2 tapas (frente+dorso) = 18 números; paredes (3 aristas) = 54.
    expect(g.caps.length).toBe(18);
    expect(g.walls.length).toBe(3 * 2 * 9);
  });
  it("columna: caja de 12 triángulos (36 vértices, 108 números)", () => {
    const box = buildColumnGeometry({ x: 0, y: 0, z: 0 }, 3, 0.2);
    expect(box.length).toBe(12 * 9);
    // altura: y va de 0 a 3.
    const ys = box.filter((_, i) => i % 3 === 1);
    expect(Math.min(...ys)).toBeCloseTo(0, 9);
    expect(Math.max(...ys)).toBeCloseTo(3, 9);
    // sección centrada en x=0±0.1, z=0±0.1.
    const xs = box.filter((_, i) => i % 3 === 0);
    expect(Math.min(...xs)).toBeCloseTo(-0.1, 9);
    expect(Math.max(...xs)).toBeCloseTo(0.1, 9);
  });
});
