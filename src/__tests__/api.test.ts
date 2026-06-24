import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

// El backend es dueño de la geometría: estos tests verifican que la capa de
// servicios mapea snake_case → camelCase y decodifica faces_packed sin tocar
// la geometría.

vi.mock("@/services/api-base", () => ({
  resolveApiBaseUrl: vi.fn(async () => "http://test.local"),
  invalidateApiBaseUrl: vi.fn(),
}));

import { recomputeTopology, fetchNestingPreview } from "@/services/api";

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
