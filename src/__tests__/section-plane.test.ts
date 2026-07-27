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

  describe("dirección del corte (invert)", () => {
    /** Distancia con signo del plano al punto: se conserva el lado >= 0. */
    const dist = (p: ReturnType<typeof sectionPlaneParams>, x: number, y: number, z: number) =>
      p.normal.x * x + p.normal.y * y + p.normal.z * z + p.constant;

    it("invert=true apunta en +eje (normal opuesta)", () => {
      expect(sectionPlaneParams("x", 0.5, min, max, center, true).normal).toEqual({
        x: 1, y: 0, z: 0,
      });
      expect(sectionPlaneParams("z", 0.5, min, max, center, true).normal).toEqual({
        x: 0, y: 0, z: 1,
      });
    });

    it("conserva lados OPUESTOS con el mismo corte", () => {
      // Corte en x a la mitad ⇒ cutWorld = 0. Mundo = modelo − center.
      const normal = sectionPlaneParams("x", 0.5, min, max, center, false);
      const flipped = sectionPlaneParams("x", 0.5, min, max, center, true);

      // Punto del lado "menor" (modelo x=2 ⇒ mundo −3)
      expect(dist(normal, -3, 0, 0)).toBeGreaterThan(0); // visible sin invertir
      expect(dist(flipped, -3, 0, 0)).toBeLessThan(0);   // recortado al invertir

      // Punto del lado "mayor" (modelo x=8 ⇒ mundo +3): exactamente al revés
      expect(dist(normal, 3, 0, 0)).toBeLessThan(0);
      expect(dist(flipped, 3, 0, 0)).toBeGreaterThan(0);
    });

    it("el plano de corte queda en el MISMO lugar; sólo cambia el lado", () => {
      const a = sectionPlaneParams("y", 0.25, min, max, center, false);
      const b = sectionPlaneParams("y", 0.25, min, max, center, true);
      // Ambos pasan por el mismo punto: distancia 0 sobre el plano de corte.
      // y: modelo [0,4] al 25% ⇒ modelo 1 ⇒ mundo 1 − 2 = −1.
      expect(dist(a, 0, -1, 0)).toBeCloseTo(0, 5);
      expect(dist(b, 0, -1, 0)).toBeCloseTo(0, 5);
    });
  });
});
