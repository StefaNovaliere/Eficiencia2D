import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeUploadResponse } from "@/services/api";

vi.mock("@/services/api-base", () => ({
  fetchWithApiFallback: vi.fn(),
  invalidateApiBaseUrl: vi.fn(),
}));

import { fetchWithApiFallback } from "@/services/api-base";
import { fetchProjectDownloadUrl, listUserProjects } from "@/services/projects";

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as Response;
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
