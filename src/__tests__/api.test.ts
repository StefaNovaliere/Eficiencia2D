import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

// El backend es dueño de la geometría: estos tests verifican que la capa de
// servicios mapea snake_case → camelCase y decodifica faces_packed sin tocar
// la geometría.

vi.mock("@/services/api-base", () => ({
  fetchWithApiFallback: vi.fn(async (path: string, init?: RequestInit) => {
    return fetch(`http://test.local${path}`, init);
  }),
  invalidateApiBaseUrl: vi.fn(),
}));

import {
  buildRecomputePayload,
  categorySignature,
  topologySignature,
  recomputeTopology,
  fetchNestingPreview,
  normalizeAssemblyGuide,
  overridesToRecord,
  toWirePipelinePayload,
} from "@/services/api";

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

/** Topología mínima válida: los tests de payload no miran la respuesta. */
function minimalTopology() {
  return {
    applied_axis: "Z",
    groups: [],
    wall_wall_joints: [],
    faces_packed: onePackedTriangle(),
    raw_faces_packed: onePackedTriangle(),
  };
}

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Internal Server Error",
    json: async () => data,
  } as unknown as Response;
}

describe("toWirePipelinePayload", () => {
  it("usa proyecto_id con JWT y file_id sin auth", () => {
    expect(
      toWirePipelinePayload(
        { file_id: "abc", original_filename: "m.stl", axis: "Y" },
        "token",
      ),
    ).toEqual({
      original_filename: "m.stl",
      axis: "Y",
      proyecto_id: "abc",
    });

    expect(
      toWirePipelinePayload({ file_id: "temp", axis: "Y" }, null),
    ).toEqual({
      axis: "Y",
      file_id: "temp",
    });
  });

  it("stringifica claves de overrides y wall_wall_decisions", () => {
    expect(
      toWirePipelinePayload(
        {
          file_id: "abc",
          overrides: { 1: "wall" },
          wall_wall_decisions: { 2: 0 },
        },
        "token",
      ),
    ).toMatchObject({
      proyecto_id: "abc",
      overrides: { "1": "wall" },
      wall_wall_decisions: { "2": 0 },
    });
  });
});

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
      original_filename: "modelo.stl",
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
    expect(JSON.parse(String(init.body))).toEqual({
      file_id: "abc",
      original_filename: "modelo.stl",
      axis: "Z",
      min_area_m2: 1,
    });
  });

  /**
   * El backend arma `placements` y `assembly_steps` — el instructivo y las
   * etiquetas de pieza — con la categoría EFECTIVA. Si el front no manda los
   * overrides, cae a la clasificación automática: lo que el usuario descartó
   * sigue apareciendo y lo que rescató no aparece nunca.
   */
  it("manda las recategorizaciones del usuario", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ topology: minimalTopology() }));

    await recomputeTopology({
      file_id: "abc",
      original_filename: "modelo.stl",
      axis: "Z",
      min_area_m2: 1,
      merges: [],
      splits: [],
      overrides: { 243: "wall", 100: "discard" },
    });

    const [, init] = mockFetch.mock.calls[0];
    // El backend indexa por string: las claves numéricas viajan serializadas.
    expect(JSON.parse(String(init.body)).overrides).toEqual({
      "243": "wall",
      "100": "discard",
    });
  });

  it("sin recategorizaciones no manda el campo, y el backend usa la automática", async () => {
    // Importa para girar el eje / cambiar el área mínima: ahí los grupos se
    // re-derivan y los overrides viejos ya no aplican, así que tienen que
    // desaparecer del payload en vez de viajar vacíos o desactualizados.
    mockFetch.mockResolvedValueOnce(jsonResponse({ topology: minimalTopology() }));

    await recomputeTopology({
      file_id: "abc",
      original_filename: "modelo.stl",
      axis: "Z",
      min_area_m2: 1,
      merges: [],
      splits: [],
      overrides: {},
    });

    expect(JSON.parse(String(mockFetch.mock.calls[0][1].body))).not.toHaveProperty("overrides");
  });
});

describe("overridesToRecord", () => {
  it("convierte la lista del front al mapa que espera el backend", () => {
    expect(
      overridesToRecord([
        { groupId: 243, newCategory: "wall" },
        { groupId: 100, newCategory: "discard" },
      ]),
    ).toEqual({ 243: "wall", 100: "discard" });
  });

  it("una lista vacía da un mapa vacío", () => {
    expect(overridesToRecord([])).toEqual({});
  });

  it("gana la última recategorización del mismo grupo", () => {
    expect(
      overridesToRecord([
        { groupId: 7, newCategory: "discard" },
        { groupId: 7, newCategory: "floor" },
      ]),
    ).toEqual({ 7: "floor" });
  });
});

describe("buildRecomputePayload", () => {
  const base = {
    fileId: "abc",
    originalFilename: "modelo.stl",
    axis: "Y" as const,
    minAreaM2: 1,
    merges: [],
    splits: [],
    overrides: { 243: "wall", 100: "discard" },
    scaleDenom: 50,
    wallWallDecisions: {},
  };

  it("arrastra las recategorizaciones guardadas cuando el cambio es otro", () => {
    // Fusionar o dividir no toca la clasificación: los overrings del usuario
    // tienen que seguir viajando o el instructivo vuelve a la automática.
    const payload = buildRecomputePayload(base, { merges: [[1, 2]] });
    expect(payload.overrides).toEqual({ 243: "wall", 100: "discard" });
    expect(payload.merges).toEqual([[1, 2]]);
  });

  /**
   * Girar el eje y cambiar el área mínima re-derivan los grupos, así que los
   * IDs viejos dejan de significar lo mismo. La pantalla limpia el estado, pero
   * `setState` es asincrónico y el valor viejo sigue vivo en ese render: por eso
   * manda `overrides: {}` explícito y tiene que ganarle al estado base.
   */
  it("el vacío explícito le gana al estado base (girar eje / área mínima)", () => {
    const payload = buildRecomputePayload(base, { axis: "Z", overrides: {} });
    expect(payload.overrides).toEqual({});
    expect(payload.axis).toBe("Z");
  });

  it("sin cambios replica el estado actual", () => {
    expect(buildRecomputePayload(base)).toEqual({
      file_id: "abc",
      original_filename: "modelo.stl",
      axis: "Y",
      min_area_m2: 1,
      merges: [],
      splits: [],
      overrides: { 243: "wall", 100: "discard" },
      scale_denom: 50,
      wall_wall_decisions: {},
    });
  });

  /**
   * La escala es lo que hace fiel a la topología: los recortes de encaje valen
   * 3 mm de MDF, que son 6 cm de edificio a 1:20 y 60 cm a 1:200. Sin ella el
   * backend devuelve la proyección cruda y el instructivo no sirve para decidir
   * si algo encaja.
   */
  it("manda la escala y las decisiones de junta", () => {
    const payload = buildRecomputePayload(
      { ...base, scaleDenom: 100, wallWallDecisions: { 12: 250 } },
      { axis: "Z" },
    );
    expect(payload.scale_denom).toBe(100);
    expect(payload.wall_wall_decisions).toEqual({ 12: 250 });
  });

  it("un cambio puntual de escala pisa a la del estado", () => {
    expect(buildRecomputePayload(base, { scale_denom: 20 }).scale_denom).toBe(20);
  });
});

describe("categorySignature", () => {
  /**
   * Cada cambio de firma cuesta un recompute entero para renumerar. La lista de
   * overrides puede llegar reordenada sin que haya cambiado nada real, así que
   * reordenarla NO puede contar como cambio.
   */
  it("no depende del orden en que llegan los overrides", () => {
    const a = overridesToRecord([
      { groupId: 3, newCategory: "wall" },
      { groupId: 12, newCategory: "discard" },
    ]);
    const b = overridesToRecord([
      { groupId: 12, newCategory: "discard" },
      { groupId: 3, newCategory: "wall" },
    ]);
    expect(categorySignature(a)).toBe(categorySignature(b));
  });

  it("descartar un componente cambia la firma", () => {
    const antes = categorySignature({ 3: "wall" });
    const despues = categorySignature({ 3: "wall", 12: "discard" });
    expect(despues).not.toBe(antes);
  });

  it("mover una pieza de pared a piso cambia la firma", () => {
    // Cambia el prefijo (A→B) y corre la numeración de las dos categorías.
    expect(categorySignature({ 3: "wall" })).not.toBe(categorySignature({ 3: "floor" }));
  });

  it("rescatar un descartado cambia la firma", () => {
    expect(categorySignature({ 7: "discard" })).not.toBe(categorySignature({ 7: "wall" }));
  });

  it("sin recategorizaciones la firma es vacía", () => {
    expect(categorySignature({})).toBe("");
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
      original_filename: "modelo.stl",
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

  it("manda paper/page_mode/combine_sheets en el PRIMER intento", async () => {
    // Regresión: omitirlos en el primer intento hacía que cambiar el papel o el
    // toggle de planchas combinadas nunca se reflejara en el preview.
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        wall_nesting: { sheets: [], config: {}, scale_denom: 50, unplaced: [] },
        floor_nesting: { sheets: [], config: {}, scale_denom: 50, unplaced: [] },
        config: { width_m: 0.28, height_m: 0.19, gap_m: 0.003 },
      }),
    );

    await fetchNestingPreview({
      file_id: "abc",
      original_filename: "modelo.stl",
      axis: "Y",
      min_area_m2: 1,
      merges: [],
      splits: [],
      overrides: {},
      wall_wall_decisions: {},
      marks: [],
      sheet_config: { width_m: 1, height_m: 0.6, gap_m: 0.003 },
      scale_denom: 50,
      paper: "A3",
      page_mode: "one_per_sheet",
      combine_sheets: true,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const firstBody = JSON.parse(String(mockFetch.mock.calls[0][1]?.body));
    expect(firstBody.paper).toBe("A3");
    expect(firstBody.page_mode).toBe("one_per_sheet");
    expect(firstBody.combine_sheets).toBe(true);
  });

  it("degrada a un intento sin paper/page_mode si el backend no los soporta", async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse(
          { detail: "Error en nesting-preview: too many values to unpack (expected 5)" },
          500,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          wall_nesting: { sheets: [], config: {}, scale_denom: 50, unplaced: [] },
          floor_nesting: { sheets: [], config: {}, scale_denom: 50, unplaced: [] },
          config: { width_m: 1, height_m: 0.6, gap_m: 0.003 },
        }),
      );

    const result = await fetchNestingPreview({
      file_id: "abc",
      original_filename: "modelo.stl",
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

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(String(mockFetch.mock.calls[0][1]?.body));
    const retryBody = JSON.parse(String(mockFetch.mock.calls[1][1]?.body));
    expect(firstBody.paper).toBe("A4");
    expect(firstBody.page_mode).toBe("one_per_sheet");
    expect(retryBody).not.toHaveProperty("paper");
    expect(retryBody).not.toHaveProperty("page_mode");
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

  it("does not crash when nested fields are undefined during camelCase conversion", () => {
    expect(() =>
      normalizeAssemblyGuide({
        pasos: [{ titulo: "Paso 1", descripcion: "Test", camera_focus: undefined }],
        piezas: [
          {
            id: "A1",
            position: [0, 0, 0],
            size: [1, 2, 0.02],
            rotation: undefined,
            color: "#475569",
          },
        ],
        meta: { piece_count: 1, step_count: 1, viewer_schema: "oriented_box_v1" },
      }),
    ).not.toThrow();
  });
});

describe("topologySignature", () => {
  const base = {
    overrides: { 3: "wall" },
    scaleDenom: 50,
    wallWallDecisions: { 12: 250 },
  };

  /**
   * Es lo que decide cuándo hay que volver a pedir la topología. La escala entra
   * porque los recortes de encaje valen 3 mm de MDF: 6 cm de edificio a 1:20 y
   * 60 cm a 1:200. Si no dispara, el instructivo queda dibujando las medidas de
   * la escala anterior.
   */
  it("cambia con la escala", () => {
    expect(topologySignature({ ...base, scaleDenom: 100 })).not.toBe(
      topologySignature(base),
    );
  });

  it("cambia al elegir otro que ceda en una junta", () => {
    expect(
      topologySignature({ ...base, wallWallDecisions: { 12: 251 } }),
    ).not.toBe(topologySignature(base));
  });

  it("cambia al recategorizar", () => {
    expect(topologySignature({ ...base, overrides: { 3: "floor" } })).not.toBe(
      topologySignature(base),
    );
  });

  it("no depende del orden de las decisiones", () => {
    // Cada refresco de más cuesta un recompute entero.
    expect(
      topologySignature({ ...base, wallWallDecisions: { 12: 250, 4: 7 } }),
    ).toBe(topologySignature({ ...base, wallWallDecisions: { 4: 7, 12: 250 } }));
  });
});
