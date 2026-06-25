import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

// El backend es dueño de la geometría: estos tests verifican que la capa de
// servicios mapea snake_case → camelCase y decodifica faces_packed sin tocar
// la geometría.

vi.mock("@/services/api-base", () => ({
  resolveApiBaseUrl: vi.fn(async () => "http://test.local"),
  invalidateApiBaseUrl: vi.fn(),
}));

import { recomputeTopology, fetchNestingPreview, normalizeAssemblyGuide } from "@/services/api";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function b64(arr: Uint32Array | Float32Array): string {
  return Buffer.from(new Uint8Array(arr.buffer)).toString("base64");
}

/** Un triángulo empaquetado en el formato del backend (1 cara, 3 vértices). */
function onePackedTriangle() {
  return {
    count: 1,
    format: "packed-le-v1",
    vertex_counts_b64: b64(new Uint32Array([3])),
    coords_b64: b64(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])),
    normals_b64: b64(new Float32Array([0, 0, 1])),
    idx_counts_b64: b64(new Uint32Array([3])),
    indices_b64: b64(new Uint32Array([0, 1, 2])),
  };
}

function jsonResponse(data: unknown) {
  return { ok: true, json: async () => data } as unknown as Response;
}

describe("recomputeTopology", () => {
  it("decodes faces_packed and camelizes the topology", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        topology: {
          applied_axis: "Z",
          groups: [{ id: 0, label: "G0", category: "wall", face_indices: [0] }],
          wall_wall_joints: [{ joint_index: 2, group_a: 0, group_b: 1 }],
          faces_packed: onePackedTriangle(),
          raw_faces_packed: onePackedTriangle(),
        },
      }),
    );

    const result = await recomputeTopology({
      file_id: "abc",
      axis: "Z",
      min_area_m2: 1,
      merges: [],
      splits: [],
    });

    expect(result.appliedAxis).toBe("Z");
    expect(result.faces).toHaveLength(1);
    expect(result.faces[0].vertices).toHaveLength(3);
    expect(result.rawFaces).toHaveLength(1);
    // snake_case anidado se cameliza
    expect(result.wallWallJoints[0].jointIndex).toBe(2);
    expect(result.groups[0].faceIndices).toEqual([0]);

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("http://test.local/api/recompute");
    expect(init.method).toBe("POST");
  });
});

describe("fetchNestingPreview", () => {
  it("camelizes the nesting preview payload", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        wall_nesting: { sheets: [], config: {}, scale_denom: 50, unplaced: [] },
        floor_nesting: { sheets: [], config: {}, scale_denom: 50, unplaced: [] },
        config: { width_m: 1, height_m: 0.6, gap_m: 0.003 },
      }),
    );

    const result = await fetchNestingPreview({
      file_id: "abc",
      axis: "Y",
      min_area_m2: 1,
      merges: [],
      splits: [],
      overrides: {},
      wall_wall_decisions: {},
      marks: [],
      sheet_config: { width_m: 1, height_m: 0.6, gap_m: 0.003 },
      scale_denom: 50,
      paper: "A4",
      page_mode: "one_per_sheet",
    });

    expect(result.wallNesting.scaleDenom).toBe(50);
    expect(result.floorNesting).toBeDefined();
    expect(result.config.widthM).toBe(1);
  });
});

describe("normalizeAssemblyGuide", () => {
  it("maps canonical backend piezas/pasos with bbox arrays", () => {
    const result = normalizeAssemblyGuide({
      message: "Secuencia de ensamble calculada.",
      steps: [
        {
          step_index: 0,
          title: "Colocar Base",
          description: "Ubica la pieza base (A1).",
          part_ids: ["A1"],
          camera_focus: { x: 2, y: 0.075, z: 1.5 },
        },
        {
          step_index: 1,
          title: "Muros",
          description: "Levantar muros",
          part_ids: ["B1"],
          camera_focus: { x: 1, y: 1.5, z: 0 },
        },
      ],
      pasos: [
        {
          titulo: "Colocar Base",
          descripcion: "Ubica la pieza base (A1) en la superficie de trabajo.",
          piezaIds: ["A1"],
        },
        {
          titulo: "Levantar muros",
          descripcion: "Colocá los muros perimetrales.",
          piezaIds: ["B1"],
        },
      ],
      piezas: [
        {
          id: "A1",
          kind: "oriented_box",
          position: [2, 0.075, 1.5],
          size: [4, 0.15, 3],
          rotation: [0, 0, 0],
          color: "#64748b",
          category: "floor",
        },
        {
          id: "B1",
          kind: "oriented_box",
          position: [1, 1.5, 0],
          size: [2, 3, 0.012],
          rotation: [0, Math.PI / 2, 0],
          color: "#475569",
          category: "wall",
        },
      ],
      meta: {
        piece_count: 2,
        step_count: 2,
        applied_axis: "Y",
        viewer_schema: "oriented_box_v1",
      },
    });

    expect(result.panels).toHaveLength(2);
    expect(result.steps).toHaveLength(2);
    expect(result.steps?.[0].title).toBe("Colocar Base");
    expect(result.steps?.[0].panel_ids).toEqual(["A1"]);
    expect(result.steps?.[0].camera_focus).toEqual({ x: 2, y: 0.075, z: 1.5 });
    expect(result.sequencePieces).toHaveLength(2);
    expect(result.sequencePieces?.[0].position).toEqual({ x: 2, y: 0.075, z: 1.5 });
    expect(result.sequencePieces?.[0].width_m).toBe(4);
    expect(result.sequencePieces?.[0].kind).toBe("oriented_box");
    expect(result.sequencePieces?.[0].rotation).toEqual({ x: 0, y: 0, z: 0 });
    expect(result.sequencePieces?.[1].rotation.y).toBeCloseTo(Math.PI / 2);
    expect(result.sequencePieces?.[1].depth_m).toBe(0.012);
    expect(result.viewerSchema).toBe("oriented_box_v1");
    expect(result.sequencePieces?.[0].color).toBe("#64748b");
    expect(result.sequencePieces?.[0].stepIndex).toBe(0);
    expect(result.sequencePieces?.[1].stepIndex).toBe(1);
    expect(result.totals.total_panels).toBe(2);
  });

  it("assigns unmapped piezas to the last step and keeps all 41 indices valid", () => {
    const piezas = Array.from({ length: 41 }, (_, i) => ({
      id: `P${i + 1}`,
      position: [i * 0.5, 0, 0],
      size: [1, 2, 0.02],
      color: "#475569",
    }));

    const result = normalizeAssemblyGuide({
      pasos: [{ titulo: "Paso 1", descripcion: "Solo una", piezaIds: ["P1"] }],
      steps: [{ step_index: 0, title: "Step 1", part_ids: ["P1"] }],
      piezas,
      meta: { piece_count: 41, step_count: 1 },
    });

    expect(result.sequencePieces).toHaveLength(41);
    expect(result.sequencePieces?.[0].stepIndex).toBe(0);
    expect(result.sequencePieces?.[40].stepIndex).toBe(0);
    expect(result.steps?.[0].panel_ids).toContain("P41");
    expect(result.totals.total_panels).toBe(41);
  });
});
