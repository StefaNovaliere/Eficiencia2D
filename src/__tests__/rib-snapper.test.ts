import { describe, it, expect } from "vitest";
import { findNearestJoint, closestPointOnSegment } from "@/core/rib-snapper";
import { resolveRibSizeM, DEFAULT_RIB_PHYSICAL_M } from "@/core/reinforcements";
import { jointToEdge, jointsToPlateJoints } from "@/core/reinforcements-preview";
import type { PlateJoint } from "@/core/pipeline";
import type { Joint } from "@/core/joint-detector";

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
  it("cartela de 20 mm a 1:100 ⇒ 2 m de mundo", () => {
    expect(DEFAULT_RIB_PHYSICAL_M).toBe(0.02);
    expect(resolveRibSizeM(100)).toBeCloseTo(2, 9);
    expect(resolveRibSizeM(50)).toBeCloseTo(1, 9);
    expect(resolveRibSizeM(0)).toBeCloseTo(0.02, 9); // escala mínima 1
  });
});

// ─── jointToEdge ──────────────────────────────────────────────────────────────
describe("jointToEdge", () => {
  const j: Joint = {
    groupA: 1,
    groupB: 2,
    totalLength: 4,
    dihedralAngle: Math.PI / 2,
    edgeMid: { x: 2, y: 0, z: 0 },
    edgeDir: { x: 1, y: 0, z: 0 }, // ya unitario
    horizontalFrac: 1,
  };

  it("reconstruye extremos a/b desde edgeMid + edgeDir × totalLength/2", () => {
    const { a, b } = jointToEdge(j);
    expect(a.x).toBeCloseTo(0, 9);
    expect(b.x).toBeCloseTo(4, 9);
    expect(a.y).toBeCloseTo(0, 9);
  });

  it("normaliza edgeDir si no es unitario", () => {
    const j2 = { ...j, edgeDir: { x: 2, y: 0, z: 0 } }; // largo 2, no unitario
    const { a, b } = jointToEdge(j2);
    expect(b.x - a.x).toBeCloseTo(4, 9); // la longitud total sigue siendo 4
  });
});

// ─── jointsToPlateJoints ──────────────────────────────────────────────────────
describe("jointsToPlateJoints", () => {
  const j: Joint = {
    groupA: 10,
    groupB: 20,
    totalLength: 3,
    dihedralAngle: Math.PI / 2,
    edgeMid: { x: 0, y: 0, z: 1.5 },
    edgeDir: { x: 0, y: 0, z: 1 },
    horizontalFrac: 0,
  };

  it("convierte Joint → PlateJoint con cutId=groupA, cutterId=groupB", () => {
    const pjs = jointsToPlateJoints([j]);
    expect(pjs).toHaveLength(1);
    expect(pjs[0].cutId).toBe(10);
    expect(pjs[0].cutterId).toBe(20);
    expect(pjs[0].a.z).toBeCloseTo(0, 9);
    expect(pjs[0].b.z).toBeCloseTo(3, 9);
  });

  it("lista vacía ⇒ lista vacía", () => {
    expect(jointsToPlateJoints([])).toHaveLength(0);
  });
});
