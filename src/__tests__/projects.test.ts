import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeUploadResponse } from "@/services/api";

vi.mock("@/services/api-base", () => ({
  fetchWithApiFallback: vi.fn(),
  invalidateApiBaseUrl: vi.fn(),
}));

import { fetchWithApiFallback } from "@/services/api-base";
import { deleteUserProject, fetchProjectDownloadUrl, listUserProjects, openUserProject, patchProjectState, fetchProjectState } from "@/services/projects";

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as Response;
}

function b64(arr: Uint32Array | Float32Array): string {
  return Buffer.from(new Uint8Array(arr.buffer)).toString("base64");
}

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

describe("listUserProjects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("parsea { proyectos, total } del backend", async () => {
    vi.mocked(fetchWithApiFallback).mockResolvedValueOnce(
      jsonResponse({
        proyectos: [
          {
            id: "uuid-1",
            nombre: "Mi maqueta",
            formato: "stl",
            tamano_bytes: 1024,
            url_archivo: "user/proj/modelo.stl",
            metadata_impresion: { archivo_original: "modelo.stl", summary: {} },
            fecha_creacion: "2026-06-25T12:00:00+00:00",
            download_url: null,
          },
        ],
        total: 1,
      }),
    );

    const result = await listUserProjects("token");
    expect(result.total).toBe(1);
    expect(result.proyectos).toHaveLength(1);
    expect(result.proyectos[0].id).toBe("uuid-1");
    expect(result.proyectos[0].metadata_impresion?.archivo_original).toBe("modelo.stl");
  });
});

describe("openUserProject", () => {
  it("envía POST a /open y normaliza la respuesta del pipeline", async () => {
    vi.mocked(fetchWithApiFallback).mockResolvedValueOnce(
      jsonResponse({
        id: "uuid-1",
        proyecto_id: "uuid-1",
        file_id: "uuid-1",
        nombre: "Mi maqueta",
        original_filename: "modelo.stl",
        preview_obj: "v obj...",
        summary: { walls: 2, floors: 1, discards: 0, total_groups: 3 },
        topology: {
          stem: "modelo",
          groups: [{ id: 0, name: "Group0", face_ids: [0] }],
          joints: [],
          faces_packed: onePackedTriangle(),
          raw_faces_packed: onePackedTriangle(),
        },
        message: "Proyecto cargado correctamente.",
      }),
    );

    const result = await openUserProject("token", "uuid-1");

    expect(fetchWithApiFallback).toHaveBeenCalledWith(
      expect.stringContaining("/api/projects/uuid-1/open"),
      expect.objectContaining({ method: "POST" }),
      expect.objectContaining({ token: "token" }),
    );
    expect(result.file_id).toBe("uuid-1");
    expect(result.proyecto_id).toBe("uuid-1");
    expect(result.original_filename).toBe("modelo.stl");
    expect(result.topology?.faces).toHaveLength(1);
    expect(result.preview_obj).toBe("v obj...");
  });

  it("incluye saved_state al abrir un proyecto guardado", async () => {
    vi.mocked(fetchWithApiFallback).mockResolvedValueOnce(
      jsonResponse({
        id: "uuid-1",
        proyecto_id: "uuid-1",
        file_id: "uuid-1",
        original_filename: "modelo.stl",
        preview_obj: "v obj...",
        summary: { walls: 2, floors: 1, discards: 0, total_groups: 3 },
        topology: {
          stem: "modelo",
          groups: [{ id: 0, name: "Group0", face_ids: [0] }],
          joints: [],
          faces_packed: onePackedTriangle(),
          raw_faces_packed: onePackedTriangle(),
        },
        saved_state: {
          merges: [[1, 2]],
          overrides: { "5": "wall" },
          scale_denom: 50,
        },
        estado_actualizado_at: "2026-06-29T22:30:00+00:00",
      }),
    );

    const result = await openUserProject("token", "uuid-1");
    expect(result.saved_state?.merges).toEqual([[1, 2]]);
    expect(result.saved_state?.overrides).toEqual({ "5": "wall" });
    expect(result.estado_actualizado_at).toBe("2026-06-29T22:30:00+00:00");
  });
});

describe("patchProjectState", () => {
  it("envía PATCH parcial al endpoint de estado", async () => {
    vi.mocked(fetchWithApiFallback).mockResolvedValueOnce(
      jsonResponse({
        proyecto_id: "uuid-1",
        nombre: "Mi casa",
        estado_r2: "user/proj/estado.json",
        estado_actualizado_at: "2026-06-29T22:30:00+00:00",
        estado: { overrides: { "5": "wall" } },
        message: "Estado del proyecto guardado correctamente.",
      }),
    );

    const result = await patchProjectState("token", "uuid-1", {
      overrides: { "5": "wall" },
    });

    expect(fetchWithApiFallback).toHaveBeenCalledWith(
      expect.stringContaining("/api/projects/uuid-1/state"),
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ overrides: { "5": "wall" } }),
      }),
      expect.objectContaining({ token: "token" }),
    );
    expect(result.estado.overrides).toEqual({ "5": "wall" });
  });
});

describe("fetchProjectState", () => {
  it("lee el estado guardado con GET", async () => {
    vi.mocked(fetchWithApiFallback).mockResolvedValueOnce(
      jsonResponse({
        proyecto_id: "uuid-1",
        nombre: "Mi casa",
        estado_r2: "user/proj/estado.json",
        estado_actualizado_at: "2026-06-29T22:30:00+00:00",
        estado: { merges: [[1, 2]] },
        message: "ok",
      }),
    );

    const result = await fetchProjectState("token", "uuid-1");
    expect(fetchWithApiFallback).toHaveBeenCalledWith(
      expect.stringContaining("/api/projects/uuid-1/state"),
      expect.objectContaining({ method: "GET" }),
      expect.objectContaining({ token: "token" }),
    );
    expect(result.estado.merges).toEqual([[1, 2]]);
  });
});

describe("deleteUserProject", () => {
  it("envía DELETE y acepta 204 sin body", async () => {
    vi.mocked(fetchWithApiFallback).mockResolvedValueOnce(
      { ok: true, status: 204, json: async () => ({}) } as Response,
    );

    await expect(deleteUserProject("token", "uuid-1")).resolves.toBeUndefined();
    expect(fetchWithApiFallback).toHaveBeenCalledWith(
      expect.stringContaining("/api/projects/uuid-1"),
      expect.objectContaining({ method: "DELETE" }),
      expect.objectContaining({ token: "token" }),
    );
  });
});

describe("fetchProjectDownloadUrl", () => {
  it("devuelve download_url firmada", async () => {
    vi.mocked(fetchWithApiFallback).mockResolvedValueOnce(
      jsonResponse({
        proyecto_id: "uuid-1",
        nombre: "Mi maqueta",
        formato: "stl",
        download_url: "https://r2.example.com/file?sig=abc",
      }),
    );

    const info = await fetchProjectDownloadUrl("token", "uuid-1");
    expect(info.download_url).toContain("r2.example.com");
    expect(info.proyecto_id).toBe("uuid-1");
  });
});

describe("normalizeUploadResponse", () => {
  it("unifica id, proyecto_id y file_id en proyectos guardados", () => {
    const result = normalizeUploadResponse({
      id: "uuid-1",
      message: "ok",
      original_filename: "modelo.stl",
      summary: { walls: 1, floors: 0, discards: 0, total_groups: 1 },
      preview_obj: "",
    });

    expect(result.file_id).toBe("uuid-1");
    expect(result.proyecto_id).toBe("uuid-1");
    expect(result.id).toBe("uuid-1");
  });

  it("usa proyecto_id cuando id no viene", () => {
    const result = normalizeUploadResponse({
      proyecto_id: "uuid-2",
      nombre: "Mi maqueta",
      summary: { walls: 0, floors: 0, discards: 0, total_groups: 0 },
      preview_obj: "",
    });

    expect(result.file_id).toBe("uuid-2");
    expect(result.original_filename).toBe("Mi maqueta");
  });

  it("upload temporal solo conserva file_id", () => {
    const result = normalizeUploadResponse({
      file_id: "temp-uuid",
      message: "Archivo procesado con éxito.",
      original_filename: "modelo.stl",
      summary: { walls: 0, floors: 0, discards: 0, total_groups: 0 },
      preview_obj: "",
    });

    expect(result.file_id).toBe("temp-uuid");
    expect(result.proyecto_id).toBeUndefined();
  });
});
