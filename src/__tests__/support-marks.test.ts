import { describe, it, expect } from "vitest";
import { computeSupportMarks3D, orientNormalTowardCutter } from "@/core/support-marks";
import type { PlateJoint } from "@/core/pipeline";
import type { Vec3 } from "@/core/types";

const NZ = { x: 0, y: 0, z: 1 };
// Junta horizontal a→b (1 m) sobre el plano z=0, grosor 0.02.
const joint = (kind?: "slot" | "surface"): PlateJoint => ({
  cutId: 1,
  cutterId: 2,
  a: { x: 0, y: 0, z: 0 },
  b: { x: 1, y: 0, z: 0 },
  width: 0.02,
  kind,
});

/** Todos los valores de un eje (0=x,1=y,2=z) de un array de posiciones. */
function axisValues(tris: number[], axis: number): number[] {
  const out: number[] = [];
  for (let i = axis; i < tris.length; i += 3) out.push(tris[i]);
  return out;
}

describe("computeSupportMarks3D", () => {
  it("devuelve el footprint (2 triángulos = 18 números) de una junta", () => {
    const tris = computeSupportMarks3D([joint()], NZ);
    expect(tris.length).toBe(18); // 1 rectángulo = 2 tri × 9
  });

  it("sin flags: preview de todas las juntas", () => {
    expect(computeSupportMarks3D([joint(), joint()], NZ).length).toBe(36);
  });

  it("con flags: sólo las de apoyo (surface), no las ranuras (slot)", () => {
    const tris = computeSupportMarks3D([joint("surface"), joint("slot")], NZ);
    expect(tris.length).toBe(18); // sólo la surface
  });

  it("con flags y surfaceOnly=false: toma todas", () => {
    const tris = computeSupportMarks3D([joint("surface"), joint("slot")], NZ, undefined, {
      surfaceOnly: false,
    });
    expect(tris.length).toBe(36);
  });

  it("lista vacía ⇒ sin geometría", () => {
    expect(computeSupportMarks3D([], NZ)).toEqual([]);
    expect(computeSupportMarks3D([joint("slot")], NZ)).toEqual([]); // sólo slots, nada de apoyo
  });
});

describe("cara INTERIOR (orientación hacia la placa que se apoya)", () => {
  // Pared en el plano x=0; junta vertical a lo largo de y. El piso (cutterId=2)
  // está del lado +X. La normal del grupo apunta al lado EQUIVOCADO (−X).
  const wallJoint: PlateJoint = {
    cutId: 1,
    cutterId: 2,
    a: { x: 0, y: 0, z: 0 },
    b: { x: 0, y: 0, z: 3 },
    width: 0.02,
  };
  const NORMAL_WRONG = { x: -1, y: 0, z: 0 }; // mira hacia AFUERA
  const floorInPlusX = new Map<number, Vec3>([[2, { x: 5, y: 0, z: 1.5 }]]);
  const floorInMinusX = new Map<number, Vec3>([[2, { x: -5, y: 0, z: 1.5 }]]);

  it("normal equivocada + piso en +X ⇒ la marca queda en x>0 (lado interior)", () => {
    const tris = computeSupportMarks3D([wallJoint], NORMAL_WRONG, floorInPlusX);
    for (const x of axisValues(tris, 0)) expect(x).toBeGreaterThan(0);
  });

  it("piso en −X ⇒ la marca queda en x<0 (el lado interior es el otro)", () => {
    const tris = computeSupportMarks3D([wallJoint], NORMAL_WRONG, floorInMinusX);
    for (const x of axisValues(tris, 0)) expect(x).toBeLessThan(0);
  });

  it("orientNormalTowardCutter: conserva la normal si ya mira al cutter, la invierte si no", () => {
    const kept = orientNormalTowardCutter({ x: 1, y: 0, z: 0 }, wallJoint, { x: 5, y: 0, z: 1.5 });
    expect(kept.x).toBe(1);
    const flipped = orientNormalTowardCutter({ x: -1, y: 0, z: 0 }, wallJoint, { x: 5, y: 0, z: 1.5 });
    expect(flipped.x).toBe(1);
  });

  it("sin centroide del cutter ⇒ usa la normal tal cual (comportamiento previo)", () => {
    const tris = computeSupportMarks3D([wallJoint], NORMAL_WRONG, new Map());
    for (const x of axisValues(tris, 0)) expect(x).toBeLessThan(0); // sigue a −X
  });
});
