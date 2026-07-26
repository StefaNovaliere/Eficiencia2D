import { describe, it, expect } from "vitest";
import {
  buildSlab,
  buildInwardSlab,
  faceNormalFromPositions,
  orientOutwardNormal,
  resolveSlabThicknessM,
} from "@/core/assembly-slab";

// Cuadrado unitario en el plano z=0 (normal +Z), dos triángulos.
const SQUARE: number[] = [
  0, 0, 0, 1, 0, 0, 1, 1, 0, // t1
  0, 0, 0, 1, 1, 0, 0, 1, 0, // t2
];
const NZ = { x: 0, y: 0, z: 1 };

describe("buildSlab", () => {
  it("duplica las tapas (frente + dorso) desplazadas ±depth/2 sobre la normal", () => {
    const { caps } = buildSlab(SQUARE, NZ, 0.1);
    // 2 tapas × 2 triángulos × 9 números.
    expect(caps.length).toBe(SQUARE.length * 2);
    // z de las tapas = ±0.05 (nunca 0).
    for (let i = 2; i < caps.length; i += 3) {
      expect(Math.abs(Math.abs(caps[i]) - 0.05)).toBeLessThan(1e-9);
    }
    const zs = new Set<number>();
    for (let i = 2; i < caps.length; i += 3) zs.add(Number(caps[i].toFixed(4)));
    expect([...zs].sort()).toEqual([-0.05, 0.05]);
  });

  it("cose paredes sobre las 4 aristas de borde (las internas no)", () => {
    const { walls } = buildSlab(SQUARE, NZ, 0.1);
    // El cuadrado tiene 4 aristas de borde; la diagonal es interna (compartida) → sin pared.
    // 4 aristas × 1 quad × 2 triángulos × 9 números.
    expect(walls.length).toBe(4 * 2 * 9);
  });

  it("winding del dorso invertido respecto del frente", () => {
    const { caps } = buildSlab(SQUARE, NZ, 0.1);
    const front = caps.slice(0, SQUARE.length);
    const back = caps.slice(SQUARE.length);
    // Normal geométrica del primer triángulo (producto cruz) debe apuntar +Z en
    // el frente y −Z en el dorso.
    const nz = (tri: number[]) => {
      const ux = tri[3] - tri[0], uy = tri[4] - tri[1];
      const vx = tri[6] - tri[0], vy = tri[7] - tri[1];
      return ux * vy - uy * vx; // componente z del cross
    };
    expect(nz(front.slice(0, 9))).toBeGreaterThan(0);
    expect(nz(back.slice(0, 9))).toBeLessThan(0);
  });

  it("degrada con seguridad: depth<=0 o normal inválida ⇒ sin engrosar", () => {
    expect(buildSlab(SQUARE, NZ, 0)).toEqual({ caps: SQUARE, walls: [] });
    expect(buildSlab(SQUARE, { x: 0, y: 0, z: 0 }, 0.1)).toEqual({ caps: SQUARE, walls: [] });
    expect(buildSlab([], NZ, 0.1)).toEqual({ caps: [], walls: [] });
  });

  it("faceNormalFromPositions devuelve la normal del plano (unitaria)", () => {
    const n = faceNormalFromPositions(SQUARE)!;
    expect(n.x).toBeCloseTo(0, 6);
    expect(n.y).toBeCloseTo(0, 6);
    expect(Math.abs(n.z)).toBeCloseTo(1, 6);
    expect(faceNormalFromPositions([])).toBeNull();
  });

  it("resolveSlabThicknessM escala el espesor del material por el denominador", () => {
    expect(resolveSlabThicknessM(0.003, 100)).toBeCloseTo(0.3, 9); // MDF 3mm @ 1:100
    expect(resolveSlabThicknessM(0.003, 50)).toBeCloseTo(0.15, 9);
    // Degradados seguros: escala mínima 1, material negativo → 0.
    expect(resolveSlabThicknessM(0.003, 0)).toBeCloseTo(0.003, 9);
    expect(resolveSlabThicknessM(-1, 100)).toBe(0);
  });

  it("un hueco interior también recibe pared (agujero pasante)", () => {
    // Anillo cuadrado con un hueco: modelamos sólo el borde del hueco como un
    // triángulo aislado invertido para verificar que sus aristas cuentan como borde.
    // Cuadrado exterior (4 aristas borde) + triángulo interior separado (3 aristas borde).
    const withHole = [...SQUARE, 0.4, 0.4, 0, 0.6, 0.4, 0, 0.5, 0.6, 0];
    const { walls } = buildSlab(withHole, NZ, 0.1);
    // 4 (exterior) + 3 (triángulo interior) = 7 aristas de borde.
    expect(walls.length).toBe(7 * 2 * 9);
  });
});

describe("buildInwardSlab", () => {
  it("deja la tapa exterior en z=0 y mueve la interior −outward·depth", () => {
    const { caps } = buildInwardSlab(SQUARE, NZ, 0.1);
    expect(caps.length).toBe(SQUARE.length * 2);
    const outer = caps.slice(0, SQUARE.length);
    const inner = caps.slice(SQUARE.length);
    for (let i = 2; i < outer.length; i += 3) {
      expect(outer[i]).toBeCloseTo(0, 9);
    }
    for (let i = 2; i < inner.length; i += 3) {
      expect(inner[i]).toBeCloseTo(-0.1, 9);
    }
  });

  it("cose paredes laterales sobre el borde", () => {
    const { walls } = buildInwardSlab(SQUARE, NZ, 0.1);
    expect(walls.length).toBe(4 * 2 * 9);
  });

  it("orientOutwardNormal apunta lejos del centro del edificio", () => {
    const n = orientOutwardNormal(
      { x: 0, y: 0, z: -1 },
      { x: 0, y: 0, z: 5 },
      { x: 0, y: 0, z: 0 },
    );
    expect(n.z).toBeCloseTo(1, 6);
  });
});
