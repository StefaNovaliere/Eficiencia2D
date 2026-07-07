import { describe, it, expect } from "vitest";
import { frameDistance, boundingRadius, boundingCenter } from "@/core/camera-frame";

describe("frameDistance", () => {
  it("mete la esfera en el fov (más radio ⇒ más distancia)", () => {
    const d1 = frameDistance(1, 45);
    const d2 = frameDistance(2, 45);
    expect(d2).toBeGreaterThan(d1);
    expect(d2 / d1).toBeCloseTo(2, 5); // lineal en el radio
  });

  it("fov más chico ⇒ más lejos", () => {
    expect(frameDistance(1, 20)).toBeGreaterThan(frameDistance(1, 60));
  });

  it("a 90° de fov, D ≈ r/sin45 · margen", () => {
    expect(frameDistance(1, 90, 1)).toBeCloseTo(1 / Math.sin(Math.PI / 4), 5);
  });

  it("radio mínimo evita distancia 0/negativa", () => {
    expect(frameDistance(0, 45)).toBeGreaterThan(0);
  });
});

describe("boundingRadius / boundingCenter", () => {
  it("radio = media diagonal; centro = punto medio", () => {
    const min = { x: 0, y: 0, z: 0 };
    const max = { x: 2, y: 0, z: 0 };
    expect(boundingRadius(min, max)).toBeCloseTo(1, 5);
    expect(boundingCenter(min, max)).toEqual({ x: 1, y: 0, z: 0 });
  });
});
