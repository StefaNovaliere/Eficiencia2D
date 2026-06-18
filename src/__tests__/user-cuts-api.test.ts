import { describe, it, expect } from "vitest";
import {
  serializeUserCutsForApi,
  parseUserCutsFromApi,
  type UserCut,
} from "@/core/user-cuts";
import { projectFacesTo2D } from "@/core/panel-projection";
import type { Face3D } from "@/core/types";

describe("user-cuts API serialization", () => {
  it("serializa a snake_case según el contrato del backend", () => {
    const cuts: UserCut[] = [
      { id: "cut-1", groupId: 12, kind: "rect", u0: 0.1, v0: 0.05, u1: 0.4, v1: 0.35 },
      { id: "cut-2", groupId: 3, kind: "line", u0: 0, v0: 0, u1: 1, v1: 0, keepPositive: true },
    ];
    const wire = serializeUserCutsForApi(cuts);
    expect(wire[0]).toMatchObject({
      id: "cut-1",
      group_id: 12,
      kind: "rect",
      u0: 0.1, v0: 0.05, u1: 0.4, v1: 0.35,
    });
    expect(wire[0]).not.toHaveProperty("keep_positive"); // sólo cuando está definido
    expect(wire[1]).toMatchObject({ group_id: 3, kind: "line", keep_positive: true });
  });

  it("round-trip serialize → parse preserva los cortes", () => {
    const cuts: UserCut[] = [
      { id: "cut-1", groupId: 7, kind: "circle", u0: 0.2, v0: 0.2, u1: 0.5, v1: 0.5 },
      { id: "cut-2", groupId: 9, kind: "line", u0: 0, v0: 0, u1: 0.3, v1: 0.1, keepPositive: false },
    ];
    expect(parseUserCutsFromApi(serializeUserCutsForApi(cuts))).toEqual(cuts);
  });

  it("parseUserCutsFromApi ignora entradas inválidas", () => {
    expect(parseUserCutsFromApi(null)).toEqual([]);
    expect(parseUserCutsFromApi([{ kind: "rect" }])).toEqual([]); // falta group_id
  });
});

describe("projectFacesTo2D (preview)", () => {
  it("proyecta una pared rectangular a sus dimensiones reales", () => {
    // Pared vertical en el plano XY (normal +Z): 2m de ancho × 3m de alto.
    const face: Face3D = {
      vertices: [
        { x: 0, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 2, y: 3, z: 0 },
        { x: 0, y: 3, z: 0 },
      ],
      normal: { x: 0, y: 0, z: 1 },
      innerLoops: [],
    };
    const proj = projectFacesTo2D([face], { x: 0, y: 0, z: 1 }, "Y");
    expect(proj).not.toBeNull();
    expect(proj!.widthM).toBeCloseTo(2, 3);
    expect(proj!.heightM).toBeCloseTo(3, 3);
    expect(proj!.edges.length).toBeGreaterThanOrEqual(4);
  });

  it("devuelve null para un grupo de caras vacío", () => {
    expect(projectFacesTo2D([], { x: 0, y: 0, z: 1 }, "Y")).toBeNull();
  });
});
