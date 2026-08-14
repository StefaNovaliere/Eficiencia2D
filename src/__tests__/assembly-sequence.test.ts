import { describe, it, expect } from "vitest";
import type { AssemblyPreviewData } from "@/services/api";
import {
  buildAssemblyPieces,
  resolveAssemblySteps,
  prepareAssemblyPiecesForRender,
  computeSequenceCenter,
} from "@/core/assembly-sequence";

describe("buildAssemblyPieces", () => {
  it("assigns stepIndex from ordered pasos, not array position of piezas", () => {
    const data: AssemblyPreviewData = {
      panels: [],
      elevations: {},
      steps: [
        { title: "Base", description: "", panel_ids: ["A1"] },
        { title: "Muros", description: "", panel_ids: ["B1", "B2"] },
      ],
      sequencePieces: [
        {
          id: "A1",
          stepIndex: 99,
          kind: "oriented_box",
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          normal: { x: 0, y: 1, z: 0 },
          width_m: 4,
          height_m: 0.15,
          depth_m: 3,
          category: "floor",
        },
        {
          id: "B1",
          stepIndex: 99,
          kind: "oriented_box",
          position: { x: 1, y: 1, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          normal: { x: 0, y: 0, z: 1 },
          width_m: 2,
          height_m: 3,
          depth_m: 0.012,
          category: "wall",
        },
        {
          id: "B2",
          stepIndex: 99,
          kind: "oriented_box",
          position: { x: 2, y: 1, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          normal: { x: 0, y: 0, z: 1 },
          width_m: 2,
          height_m: 3,
          depth_m: 0.012,
          category: "wall",
        },
      ],
      totals: { wall_count: 2, floor_count: 1, total_panels: 3 },
    };

    const steps = resolveAssemblySteps(data);
    const pieces = buildAssemblyPieces(data, steps);

    expect(pieces.find((p) => p.id === "A1")?.stepIndex).toBe(0);
    expect(pieces.find((p) => p.id === "B1")?.stepIndex).toBe(1);
    expect(pieces.find((p) => p.id === "B2")?.stepIndex).toBe(1);
  });
});

describe("prepareAssemblyPiecesForRender", () => {
  it("keeps metre coords for oriented_box_v1", () => {
    const raw = [
      {
        id: "W1",
        stepIndex: 0,
        kind: "oriented_box" as const,
        position: { x: 5, y: 1.5, z: 0 },
        rotation: { x: 0, y: 1.2, z: 0 },
        normal: { x: 0, y: 0, z: 1 },
        width_m: 2,
        height_m: 3,
        depth_m: 0.012,
        category: "wall",
      },
    ];
    const prepared = prepareAssemblyPiecesForRender(raw, {
      viewerSchema: "oriented_box_v1",
    });
    expect(prepared[0].position.x).toBe(5);
    expect(prepared[0].rotation.y).toBeCloseTo(1.2);
    expect(prepared[0].depth_m).toBe(0.012);
    const center = computeSequenceCenter(prepared);
    expect(Number.isFinite(center.x)).toBe(true);
  });

  it("converts legacy mm coordinates when schema is absent", () => {
    const raw = [
      {
        id: "W1",
        stepIndex: 0,
        position: { x: 5000, y: 1500, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        normal: { x: 0, y: 0, z: 1 },
        width_m: 2000,
        height_m: 3000,
        depth_m: 18,
        category: "wall",
      },
    ];
    const prepared = prepareAssemblyPiecesForRender(raw);
    expect(prepared[0].position.x).toBeCloseTo(5);
    expect(prepared[0].width_m).toBeCloseTo(2);
  });

  /**
   * Camino VIVO del instructivo: la guía que arma el front deja
   * `sequencePieces` en undefined, así que las piezas salen de `panels`. Ese
   * camino no deduplicaba, y una etiqueta repetida entre pasos dibujaba la misma
   * placa dos veces — dos piezas superpuestas que hacen z-fighting y se ven como
   * una pared de más.
   */
  it("no dibuja la misma pieza dos veces si la etiqueta se repite entre pasos", () => {
    const data: AssemblyPreviewData = {
      panels: [
        {
          id: "A1",
          category: "wall",
          source_group_id: 1,
          width_m: 4,
          height_m: 3,
          area_m2: 12,
          centroid: { x: 0, y: 0, z: 0 },
          normal: { x: 0, y: 0, z: 1 },
          label: "A1",
        },
      ],
      elevations: {},
      totals: { wall_count: 1, floor_count: 0, total_panels: 1 },
    };
    const steps = [
      { title: "Sur", description: "", panel_ids: ["A1"] },
      { title: "Norte", description: "", panel_ids: ["A1"] },
    ];

    const pieces = buildAssemblyPieces(data, steps);
    expect(pieces).toHaveLength(1);
    expect(pieces[0].stepIndex).toBe(0);
  });

  it("replaces invalid dims with safe minimums", () => {
    const raw = [
      {
        id: "X",
        stepIndex: 0,
        position: { x: 1, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        normal: { x: 0, y: 1, z: 0 },
        width_m: NaN,
        height_m: 0,
        depth_m: -1,
        category: "wall",
      },
    ];
    const prepared = prepareAssemblyPiecesForRender(raw, {
      viewerSchema: "oriented_box_v1",
    });
    expect(prepared[0].width_m).toBeGreaterThan(0);
    expect(prepared[0].depth_m).toBeGreaterThan(0);
  });
});
