import { describe, it, expect } from "vitest";
import type { GeometryGroup } from "@/core/group-classifier";
import type { Face3D } from "@/core/types";
import {
  areGroupsCoplanar,
  areCoplanarWallsUnited,
  evaluateWallMergeSelection,
  connectedUnitedWallIds,
  groupPlaneBounds,
  planeBoundsTouch,
} from "@/core/wall-merge-connectivity";

function wall(
  id: number,
  centroid: { x: number; y: number; z: number },
  faceIndices: number[],
): GeometryGroup {
  return {
    id,
    label: `W${id}`,
    category: "wall",
    faceIndices,
    totalArea: 1,
    centroid,
    orientation: "N",
    representativeNormal: { x: 0, y: 0, z: 1 },
  };
}

/** Quad en z=0: [x0,y0]–[x1,y1]. */
function quad(x0: number, y0: number, x1: number, y1: number): Face3D {
  return {
    vertices: [
      { x: x0, y: y0, z: 0 },
      { x: x1, y: y0, z: 0 },
      { x: x1, y: y1, z: 0 },
      { x: x0, y: y1, z: 0 },
    ],
    normal: { x: 0, y: 0, z: 1 },
    innerLoops: [],
  };
}

describe("wall-merge-connectivity", () => {
  it("detecta coplanaridad y rechazo por plano distinto", () => {
    const a = wall(1, { x: 0, y: 1, z: 0 }, [0]);
    const b = wall(2, { x: 2, y: 1, z: 0 }, [1]);
    const c = wall(3, { x: 0, y: 1, z: 1 }, [2]);
    c.representativeNormal = { x: 1, y: 0, z: 0 };
    expect(areGroupsCoplanar(a, b)).toBe(true);
    expect(areGroupsCoplanar(a, c)).toBe(false);
  });

  it("AABB en el plano: unidos si se tocan, no si hay hueco", () => {
    const faces = [
      quad(0, 0, 2, 3), // A: x 0..2
      quad(2, 0, 4, 3), // B: toca A en x=2
      quad(5, 0, 7, 3), // C: hueco de 1 m respecto a B
    ];
    const a = wall(1, { x: 1, y: 1.5, z: 0 }, [0]);
    const b = wall(2, { x: 3, y: 1.5, z: 0 }, [1]);
    const c = wall(3, { x: 6, y: 1.5, z: 0 }, [2]);

    expect(areCoplanarWallsUnited(a, b, faces)).toBe(true);
    expect(areCoplanarWallsUnited(b, c, faces)).toBe(false);
    expect(areCoplanarWallsUnited(a, c, faces)).toBe(false);
  });

  it("bloquea fusión de coplanares separadas", () => {
    const faces = [quad(0, 0, 2, 3), quad(5, 0, 7, 3)];
    const a = wall(1, { x: 1, y: 1.5, z: 0 }, [0]);
    const b = wall(2, { x: 6, y: 1.5, z: 0 }, [1]);
    const eval_ = evaluateWallMergeSelection([a, b], faces);
    expect(eval_.ok).toBe(false);
    expect(eval_.reason).toMatch(/separadas|unidas/i);
  });

  it("permite fusión de coplanares en contacto", () => {
    const faces = [quad(0, 0, 2, 3), quad(2, 0, 4, 3)];
    const a = wall(1, { x: 1, y: 1.5, z: 0 }, [0]);
    const b = wall(2, { x: 3, y: 1.5, z: 0 }, [1]);
    const eval_ = evaluateWallMergeSelection([a, b], faces);
    expect(eval_.ok).toBe(true);
    expect(eval_.cluster).toEqual([1, 2]);
  });

  it("fachada unida: solo el componente conexo desde la semilla", () => {
    // A–B unidos; C separado en el mismo plano
    const faces = [
      quad(0, 0, 2, 3),
      quad(2, 0, 4, 3),
      quad(8, 0, 10, 3),
    ];
    const walls = [
      wall(1, { x: 1, y: 1.5, z: 0 }, [0]),
      wall(2, { x: 3, y: 1.5, z: 0 }, [1]),
      wall(3, { x: 9, y: 1.5, z: 0 }, [2]),
    ];
    expect(connectedUnitedWallIds(1, walls, faces).sort()).toEqual([1, 2]);
    expect(connectedUnitedWallIds(3, walls, faces)).toEqual([3]);
  });

  it("planeBoundsTouch respeta la holgura", () => {
    const basis = { u: { x: 1, y: 0, z: 0 }, v: { x: 0, y: 1, z: 0 } };
    const origin = { x: 0, y: 0, z: 0 };
    const a = groupPlaneBounds(
      wall(1, { x: 0.5, y: 0.5, z: 0 }, [0]),
      [quad(0, 0, 1, 1)],
      origin,
      basis,
    )!;
    const b = groupPlaneBounds(
      wall(2, { x: 1.54, y: 0.5, z: 0 }, [0]),
      [quad(1.04, 0, 2.04, 1)],
      origin,
      basis,
    )!;
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(planeBoundsTouch(a, b, 0.05)).toBe(true);
    expect(planeBoundsTouch(a, b, 0.01)).toBe(false);
  });
});
