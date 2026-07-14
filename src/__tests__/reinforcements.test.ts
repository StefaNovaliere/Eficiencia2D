import { describe, it, expect } from "vitest";
import {
  serializeRibsForApi,
  serializeColumnsForApi,
  buildRibGeometry,
  buildColumnGeometry,
  removeRib,
  removeColumn,
  type Rib,
  type Column,
} from "@/core/reinforcements";
import { ribEdgeForGroups, computeReinforcementsGeometry } from "@/core/reinforcements-preview";
import { toExtractedCutGroupId } from "@/core/cut-derived-groups";
import type { GeometryGroup } from "@/core/group-classifier";
import type { Face3D } from "@/core/types";
import type { PlateJoint } from "@/core/pipeline";

const RIB: Rib = { id: "rib-1", groupA: 2, groupB: 5, sizeM: 0.3, t: 0.5 };
const COL: Column = { id: "col-1", position: { x: 1, y: 0, z: 2 }, heightM: 3, sizeM: 0.2 };

describe("serialización", () => {
  it("nervios → snake_case", () => {
    expect(serializeRibsForApi([RIB])[0]).toEqual({
      id: "rib-1",
      group_a: 2,
      group_b: 5,
      size_m: 0.3,
      pos_t: 0.5,
    });
  });
  it("columnas → snake_case con position [x,y,z]", () => {
    expect(serializeColumnsForApi([COL])[0]).toEqual({
      id: "col-1",
      position: [1, 0, 2],
      height_m: 3,
      size_m: 0.2,
    });
  });
});

describe("remove", () => {
  it("nervios y columnas por id", () => {
    expect(removeRib([RIB], "rib-1")).toEqual([]);
    expect(removeColumn([COL], "col-1")).toEqual([]);
  });
});

describe("ribEdgeForGroups (arista de intersección)", () => {
  // Pared en x=0 (⊥ eje X) y piso en y=0 (⊥ eje Y). Se cruzan en la recta x=0,y=0
  // (a lo largo de z). z compartido: [0,3].
  const wall = {
    id: 1,
    faceIndices: [0],
    centroid: { x: 0, y: 1, z: 1.5 },
    representativeNormal: { x: 1, y: 0, z: 0 },
  } as unknown as GeometryGroup;
  const floor = {
    id: 2,
    faceIndices: [1],
    centroid: { x: 1.5, y: 0, z: 1.5 },
    representativeNormal: { x: 0, y: 1, z: 0 },
  } as unknown as GeometryGroup;
  const faces = [
    { vertices: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 2, z: 0 }, { x: 0, y: 2, z: 3 }, { x: 0, y: 0, z: 3 }] },
    { vertices: [{ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }, { x: 3, y: 0, z: 3 }, { x: 0, y: 0, z: 3 }] },
  ] as unknown as Face3D[];

  it("ancla en la arista y los catetos apuntan al interior de cada placa", () => {
    const e = ribEdgeForGroups(wall, floor, faces, 0.5)!;
    expect(e).not.toBeNull();
    expect(e.corner.x).toBeCloseTo(0, 6);
    expect(e.corner.y).toBeCloseTo(0, 6);
    expect(e.corner.z).toBeCloseTo(1.5, 6); // t=0.5 sobre z∈[0,3]
    // cateto en la pared → sube en +y; cateto en el piso → avanza en +x.
    expect(e.dirA.y).toBeCloseTo(1, 6);
    expect(e.dirB.x).toBeCloseTo(1, 6);
  });

  it("t desliza a lo largo de la arista", () => {
    expect(ribEdgeForGroups(wall, floor, faces, 0)!.corner.z).toBeCloseTo(0, 6);
    expect(ribEdgeForGroups(wall, floor, faces, 1)!.corner.z).toBeCloseTo(3, 6);
  });

  it("placas paralelas y sin joint ⇒ null", () => {
    const floor2 = { ...floor, representativeNormal: { x: 1, y: 0, z: 0 } } as GeometryGroup;
    expect(ribEdgeForGroups(wall, floor2, faces, 0.5)).toBeNull();
  });

  it("sin solape real ⇒ null (evita ubicaciones lejanas)", () => {
    // Piso desplazado en z fuera del rango de la pared (z 10..13) → sin arista común.
    const farFaces = [
      faces[0],
      { vertices: [{ x: 0, y: 0, z: 10 }, { x: 3, y: 0, z: 10 }, { x: 3, y: 0, z: 13 }, { x: 0, y: 0, z: 13 }] },
    ] as unknown as Face3D[];
    expect(ribEdgeForGroups(wall, floor, farFaces, 0.5)).toBeNull();
  });

  it("usa la arista EXACTA del backend (PlateJoint) cuando se pasa", () => {
    const joint = { a: { x: 5, y: 5, z: 0 }, b: { x: 5, y: 5, z: 4 } };
    const e = ribEdgeForGroups(wall, floor, faces, 0.5, joint)!;
    expect(e.corner.x).toBeCloseTo(5, 6);
    expect(e.corner.y).toBeCloseTo(5, 6);
    expect(e.corner.z).toBeCloseTo(2, 6); // t=0.5 sobre z∈[0,4]
  });
});

// ─── owner-id resolution + clamp ──────────────────────────────────────────────
describe("computeReinforcementsGeometry — resolución de ids derivados", () => {
  const wall = {
    id: 175,
    faceIndices: [0],
    centroid: { x: 0, y: 1, z: 1.5 },
    representativeNormal: { x: 1, y: 0, z: 0 },
  } as unknown as GeometryGroup;
  const floor = {
    id: 4,
    faceIndices: [1],
    centroid: { x: 1.5, y: 0, z: 1.5 },
    representativeNormal: { x: 0, y: 1, z: 0 },
  } as unknown as GeometryGroup;
  const faces = [
    { normal: { x: 1, y: 0, z: 0 }, vertices: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 2, z: 0 }, { x: 0, y: 2, z: 3 }, { x: 0, y: 0, z: 3 }] },
    { normal: { x: 0, y: 1, z: 0 }, vertices: [{ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }, { x: 3, y: 0, z: 3 }, { x: 0, y: 0, z: 3 }] },
  ] as unknown as Face3D[];

  const plateJoints: PlateJoint[] = [
    {
      cutId: 175,
      cutterId: 4,
      a: { x: 0, y: 0, z: 0 },
      b: { x: 0, y: 0, z: 3 },
      width: 0.02,
    },
  ];

  it("par con ids padre → produce geometría (triángulos > 0)", () => {
    const rib: Rib = { id: "r1", groupA: 175, groupB: 4, sizeM: 2, t: 0.5 };
    const tris = computeReinforcementsGeometry([rib], [], [wall, floor], faces, plateJoints, [wall, floor]);
    expect(tris.length).toBeGreaterThan(0);
  });

  it("par con id DERIVADO (-175001) → resuelve al padre 175 y produce geometría", () => {
    const derivedId = toExtractedCutGroupId(175, 0); // = -175501
    const rib: Rib = { id: "r2", groupA: derivedId, groupB: 4, sizeM: 2, t: 0.5 };
    // displayGroups contiene el derivado; projectionGroups contiene el padre
    const tris = computeReinforcementsGeometry(
      [rib], [],
      [{ ...wall, id: derivedId }], // displayGroups: sólo el derivado
      faces,
      plateJoints,
      [wall, floor],               // projectionGroups: los padres
    );
    expect(tris.length).toBeGreaterThan(0);
  });

  it("sin junta para el par → sin triángulos (no inventa esquina)", () => {
    const rib: Rib = { id: "r3", groupA: 999, groupB: 888, sizeM: 2, t: 0.5 };
    const tris = computeReinforcementsGeometry([rib], [], [wall, floor], faces, plateJoints, [wall, floor]);
    expect(tris.length).toBe(0);
  });

  it("clamp universal: sizeM mayor que 35% del largo de junta queda reducido", () => {
    const juntaLen = 3; // junta de 3 m
    const bigRib: Rib = { id: "r4", groupA: 175, groupB: 4, sizeM: 99, t: 0.5 };
    const tris = computeReinforcementsGeometry([bigRib], [], [wall, floor], faces, plateJoints, [wall, floor]);
    // Con clamp 0.35*3=1.05m, los vértices del triángulo deben estar a ≤1.05m del corner
    const maxCoordExpected = 1.05;
    // Verificar que ningún vértice queda descontroladamente lejos del corner (0,0,1.5)
    const cornerX = 0; const cornerY = 0; const cornerZ = 1.5;
    for (let i = 0; i + 2 < tris.length; i += 3) {
      const dx = tris[i] - cornerX;
      const dy = tris[i+1] - cornerY;
      const dz = tris[i+2] - cornerZ;
      const dist = Math.hypot(dx, dy, dz);
      expect(dist).toBeLessThanOrEqual(maxCoordExpected + 0.1); // margen por espesor
    }
    expect(tris.length).toBeGreaterThan(0);
  });
});

describe("geometría esquemática", () => {
  it("cartela: slab a partir de un triángulo rectángulo", () => {
    const g = buildRibGeometry(
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      0.3,
      0.02,
    );
    // 1 triángulo → 2 tapas (frente+dorso) = 18 números; paredes (3 aristas) = 54.
    expect(g.caps.length).toBe(18);
    expect(g.walls.length).toBe(3 * 2 * 9);
  });
  it("columna: caja de 12 triángulos (36 vértices, 108 números)", () => {
    const box = buildColumnGeometry({ x: 0, y: 0, z: 0 }, 3, 0.2);
    expect(box.length).toBe(12 * 9);
    // altura: y va de 0 a 3.
    const ys = box.filter((_, i) => i % 3 === 1);
    expect(Math.min(...ys)).toBeCloseTo(0, 9);
    expect(Math.max(...ys)).toBeCloseTo(3, 9);
    // sección centrada en x=0±0.1, z=0±0.1.
    const xs = box.filter((_, i) => i % 3 === 0);
    expect(Math.min(...xs)).toBeCloseTo(-0.1, 9);
    expect(Math.max(...xs)).toBeCloseTo(0.1, 9);
  });
});
