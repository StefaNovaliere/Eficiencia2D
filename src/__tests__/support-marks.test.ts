import { describe, it, expect } from "vitest";
import { computeSupportMarks3D } from "@/core/support-marks";
import type { PlateJoint } from "@/core/pipeline";

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
    const tris = computeSupportMarks3D([joint("surface"), joint("slot")], NZ, {
      surfaceOnly: false,
    });
    expect(tris.length).toBe(36);
  });

  it("lista vacía ⇒ sin geometría", () => {
    expect(computeSupportMarks3D([], NZ)).toEqual([]);
    expect(computeSupportMarks3D([joint("slot")], NZ)).toEqual([]); // sólo slots, nada de apoyo
  });
});
