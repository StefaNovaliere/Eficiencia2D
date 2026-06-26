import { describe, it, expect } from "vitest";
import { edgesToRings, liftPiece, liftFaces, buildSlots } from "@/core/assembly-lift";
import type { Placement, PlateJoint } from "@/core/pipeline";
import type { NestingPanel } from "@/core/sheet-nester";
import type { Face3D } from "@/core/types";

// Marco identidad: u→+X, v→+Y, origin en cero. Liftear == coords (u,v,0).
const IDENTITY: Placement = {
  origin: { x: 0, y: 0, z: 0 },
  uAxis: { x: 1, y: 0, z: 0 },
  vAxis: { x: 0, y: 1, z: 0 },
  normal: { x: 0, y: 0, z: 1 },
  widthM: 2,
  heightM: 1,
  mirrored: false,
};

function rectEdges(w: number, h: number): NestingPanel["edges"] {
  return [
    { a: { x: 0, y: 0 }, b: { x: w, y: 0 } },
    { a: { x: w, y: 0 }, b: { x: w, y: h } },
    { a: { x: w, y: h }, b: { x: 0, y: h } },
    { a: { x: 0, y: h }, b: { x: 0, y: 0 } },
  ];
}

describe("edgesToRings", () => {
  it("separates the outer contour from a hole ring", () => {
    const edges: NestingPanel["edges"] = [
      ...rectEdges(2, 1),
      { a: { x: 0.5, y: 0.3 }, b: { x: 0.8, y: 0.3 }, hole: true },
      { a: { x: 0.8, y: 0.3 }, b: { x: 0.8, y: 0.6 }, hole: true },
      { a: { x: 0.8, y: 0.6 }, b: { x: 0.5, y: 0.6 }, hole: true },
      { a: { x: 0.5, y: 0.6 }, b: { x: 0.5, y: 0.3 }, hole: true },
    ];
    const { outer, holes } = edgesToRings(edges);
    expect(outer).toHaveLength(1);
    expect(outer[0]).toHaveLength(4);
    expect(holes).toHaveLength(1);
    expect(holes[0]).toHaveLength(4);
  });
});

describe("liftPiece", () => {
  it("lifts a rectangle when no nesting panel is given (placement frame)", () => {
    const g = liftPiece(IDENTITY, null);
    // 2 triángulos × 3 vértices × 3 coords.
    expect(g.positions.length).toBe(18);
    expect(g.hasHoles).toBe(false);
    // Todos los z = 0 (plano XY), x∈[0,2], y∈[0,1].
    for (let i = 0; i < g.positions.length; i += 3) {
      expect(g.positions[i + 2]).toBeCloseTo(0);
      expect(g.positions[i]).toBeGreaterThanOrEqual(-1e-9);
      expect(g.positions[i]).toBeLessThanOrEqual(2 + 1e-9);
    }
  });

  it("scales the panel contour to the placement width (auto unit-correct)", () => {
    // Panel a escala 1:50 → ancho 0.04 que debe mapear a placement.widthM = 2.
    const panel: NestingPanel = {
      id: "A1",
      category: "wall",
      widthM: 0.04,
      heightM: 0.02,
      edges: rectEdges(0.04, 0.02),
    };
    const g = liftPiece(IDENTITY, panel);
    let maxX = -Infinity;
    for (let i = 0; i < g.positions.length; i += 3) maxX = Math.max(maxX, g.positions[i]);
    expect(maxX).toBeCloseTo(2, 5); // 0.04 × (2 / 0.04) = 2
  });

  it("undoes the horizontal mirror with u = widthM - u", () => {
    const panel: NestingPanel = {
      id: "B1",
      category: "wall",
      widthM: 2,
      heightM: 1,
      // Marca asimétrica cerca de u=0 para distinguir el espejo.
      edges: [
        { a: { x: 0, y: 0 }, b: { x: 0.5, y: 0 } },
        { a: { x: 0.5, y: 0 }, b: { x: 0.5, y: 1 } },
        { a: { x: 0.5, y: 1 }, b: { x: 0, y: 1 } },
        { a: { x: 0, y: 1 }, b: { x: 0, y: 0 } },
      ],
    };
    const normal = liftPiece({ ...IDENTITY, mirrored: false }, panel);
    const mirrored = liftPiece({ ...IDENTITY, mirrored: true }, panel);
    const maxXof = (g: { positions: number[] }) => {
      let m = -Infinity;
      for (let i = 0; i < g.positions.length; i += 3) m = Math.max(m, g.positions[i]);
      return m;
    };
    // Sin espejo el ancho ocupa [0,0.5]; con espejo ocupa [1.5,2].
    expect(maxXof(normal)).toBeCloseTo(0.5, 5);
    expect(maxXof(mirrored)).toBeCloseTo(2, 5);
  });

  it("liftFaces (fallback #1) triangulates faces in world coords", () => {
    const quad: Face3D = {
      vertices: [
        { x: 0, y: 0, z: 1 },
        { x: 2, y: 0, z: 1 },
        { x: 2, y: 1, z: 1 },
        { x: 0, y: 1, z: 1 },
      ],
      normal: { x: 0, y: 0, z: 1 },
      innerLoops: [],
    };
    const g = liftFaces([quad]);
    expect(g.positions.length).toBe(18); // 2 triángulos × 3 × 3
    expect(g.hasHoles).toBe(false);
    // Coordenadas de mundo sin transformar: z constante = 1, x∈[0,2], y∈[0,1].
    for (let i = 0; i < g.positions.length; i += 3) {
      expect(g.positions[i + 2]).toBeCloseTo(1);
    }
  });

  it("buildSlots (overlay v2) thickens each plate_joint into a quad on the face plane", () => {
    // Segmento a→b a lo largo de X, normal +Z → la ranura se engrosa en Y.
    const joints: PlateJoint[] = [
      { cutId: 1, cutterId: 2, a: { x: 0, y: 1, z: 0 }, b: { x: 1, y: 1, z: 0 }, width: 0.02 },
    ];
    const slots = buildSlots(joints, { x: 0, y: 0, z: 1 });
    // 2 triángulos × 3 × 3 = 18.
    expect(slots.length).toBe(18);
    // Engrosado ±0.01 en Y alrededor de y=1 → valores de Y en [0.99, 1.01].
    for (let i = 0; i < slots.length; i += 3) {
      expect(slots[i + 1]).toBeGreaterThan(0.985);
      expect(slots[i + 1]).toBeLessThan(1.015);
    }
  });

  it("buildSlots ignora joints degenerados (a==b)", () => {
    const joints: PlateJoint[] = [
      { cutId: 1, cutterId: 2, a: { x: 0, y: 0, z: 0 }, b: { x: 0, y: 0, z: 0 }, width: 0.02 },
    ];
    expect(buildSlots(joints, { x: 0, y: 0, z: 1 })).toEqual([]);
  });

  it("emits opening segments for holes", () => {
    const panel: NestingPanel = {
      id: "C1",
      category: "wall",
      widthM: 2,
      heightM: 1,
      edges: [
        ...rectEdges(2, 1),
        { a: { x: 0.5, y: 0.3 }, b: { x: 0.8, y: 0.3 }, hole: true },
        { a: { x: 0.8, y: 0.3 }, b: { x: 0.8, y: 0.6 }, hole: true },
        { a: { x: 0.8, y: 0.6 }, b: { x: 0.5, y: 0.6 }, hole: true },
        { a: { x: 0.5, y: 0.6 }, b: { x: 0.5, y: 0.3 }, hole: true },
      ],
    };
    const g = liftPiece(IDENTITY, panel);
    expect(g.hasHoles).toBe(true);
    expect(g.openings.length).toBeGreaterThan(0);
  });
});
