import { describe, it, expect } from "vitest";
import { sectionPlaneParams } from "@/core/section-plane";

const min = { x: 0, y: 0, z: 0 };
const max = { x: 10, y: 4, z: 6 };
const center = { x: 5, y: 2, z: 3 };

describe("sectionPlaneParams", () => {
  it("normal apunta en -eje", () => {
    expect(sectionPlaneParams("x", 0.5, min, max, center).normal).toEqual({ x: -1, y: 0, z: 0 });
    expect(sectionPlaneParams("z", 0.5, min, max, center).normal).toEqual({ x: 0, y: 0, z: -1 });
  });

  it("pos 0 y 1 mapean a los extremos (en coords de mundo, centradas)", () => {
    // x: modelo [0,10], center 5 ⇒ mundo [-5, 5]
    expect(sectionPlaneParams("x", 0, min, max, center).constant).toBeCloseTo(-5, 5);
    expect(sectionPlaneParams("x", 1, min, max, center).constant).toBeCloseTo(5, 5);
    expect(sectionPlaneParams("x", 0.5, min, max, center).constant).toBeCloseTo(0, 5);
  });

  it("clampa pos fuera de [0,1]", () => {
    expect(sectionPlaneParams("x", -1, min, max, center).constant).toBeCloseTo(-5, 5);
    expect(sectionPlaneParams("x", 2, min, max, center).constant).toBeCloseTo(5, 5);
  });
});
