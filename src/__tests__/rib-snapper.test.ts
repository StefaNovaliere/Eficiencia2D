import { describe, it, expect } from "vitest";
import { findNearestJoint, closestPointOnSegment } from "@/core/rib-snapper";
import { resolveRibSizeM, DEFAULT_RIB_PHYSICAL_M } from "@/core/reinforcements";
import type { PlateJoint } from "@/core/pipeline";

const J = (id: number, a: [number, number, number], b: [number, number, number]): PlateJoint => ({
  cutId: id,
  cutterId: id + 100,
  a: { x: a[0], y: a[1], z: a[2] },
  b: { x: b[0], y: b[1], z: b[2] },
  width: 0.02,
});

describe("closestPointOnSegment", () => {
  it("proyecta dentro del segmento", () => {
    const r = closestPointOnSegment({ x: 1, y: 5, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 });
    expect(r.t).toBeCloseTo(0.25, 9);
    expect(r.point).toEqual({ x: 1, y: 0, z: 0 });
  });
  it("clampea a los extremos", () => {
    const a = { x: 0, y: 0, z: 0 };
    const b = { x: 4, y: 0, z: 0 };
    expect(closestPointOnSegment({ x: -3, y: 1, z: 0 }, a, b).t).toBe(0);
    expect(closestPointOnSegment({ x: 9, y: 1, z: 0 }, a, b).t).toBe(1);
  });
});

describe("findNearestJoint (imán)", () => {
  const joints = [J(1, [0, 0, 0], [4, 0, 0]), J(2, [0, 0, 10], [4, 0, 10])];

  it("elige la junta más cercana entre varias, con t y punto", () => {
    const snap = findNearestJoint({ x: 2, y: 0.3, z: 0.2 }, joints, 1)!;
    expect(snap.joint.cutId).toBe(1);
    expect(snap.t).toBeCloseTo(0.5, 6);
    expect(snap.closest).toEqual({ x: 2, y: 0, z: 0 });
    expect(snap.distM).toBeCloseTo(Math.hypot(0.3, 0.2), 6);
  });

  it("fuera del umbral ⇒ null (sin imán)", () => {
    expect(findNearestJoint({ x: 2, y: 5, z: 5 }, joints, 1)).toBeNull();
  });

  it("lista vacía ⇒ null", () => {
    expect(findNearestJoint({ x: 0, y: 0, z: 0 }, [], 10)).toBeNull();
  });
});

describe("tamaño físico del nervio", () => {
  it("cartela de 50 mm a 1:100 ⇒ 5 m de mundo", () => {
    expect(DEFAULT_RIB_PHYSICAL_M).toBe(0.05);
    expect(resolveRibSizeM(100)).toBeCloseTo(5, 9);
    expect(resolveRibSizeM(50)).toBeCloseTo(2.5, 9);
    expect(resolveRibSizeM(0)).toBeCloseTo(0.05, 9); // escala mínima 1
  });
});
