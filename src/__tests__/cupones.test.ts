import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/api-base", () => ({
  fetchWithApiFallback: vi.fn(),
  invalidateApiBaseUrl: vi.fn(),
}));

import { fetchWithApiFallback } from "@/services/api-base";
import { createCupon, isCuponActive, listCupones } from "@/services/cupones";

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as Response;
}

describe("listCupones", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parsea lista de cupones del backend", async () => {
    vi.mocked(fetchWithApiFallback).mockResolvedValueOnce(
      jsonResponse({
        cupones: [
          {
            id: "c1",
            codigo: "verano2026",
            descripcion: "20% off",
            limite_usos: 100,
            limite_usos_por_usuario: 1,
            descuento_porcentaje: 20,
            fecha_inicio: "2026-06-01T00:00:00Z",
            fecha_expiracion: "2026-08-31T23:59:59Z",
            activo: true,
            usos_actuales: 5,
          },
        ],
        total: 1,
      }),
    );

    const result = await listCupones("token");
    expect(result.total).toBe(1);
    expect(result.cupones[0].codigo).toBe("VERANO2026");
    expect(result.cupones[0].descuento_porcentaje).toBe(20);
  });
});

describe("createCupon", () => {
  it("envía POST con código en mayúsculas", async () => {
    vi.mocked(fetchWithApiFallback).mockResolvedValueOnce(
      jsonResponse({
        id: "c2",
        codigo: "NUEVO",
        descuento_porcentaje: 15,
        activo: true,
      }),
    );

    const created = await createCupon("token", {
      codigo: "nuevo",
      descuento_porcentaje: 15,
      activo: true,
    });

    expect(created.codigo).toBe("NUEVO");
    expect(fetchWithApiFallback).toHaveBeenCalledWith(
      expect.stringContaining("/api/cupones"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"codigo":"NUEVO"'),
      }),
      expect.objectContaining({ token: "token" }),
    );
  });
});

describe("isCuponActive", () => {
  it("devuelve false si activo es false", () => {
    expect(
      isCuponActive({
        id: "1",
        codigo: "X",
        descripcion: null,
        limite_usos: null,
        limite_usos_por_usuario: null,
        descuento_porcentaje: 10,
        fecha_inicio: null,
        fecha_expiracion: null,
        activo: false,
      }),
    ).toBe(false);
  });

  it("devuelve false si ya expiró", () => {
    expect(
      isCuponActive(
        {
          id: "1",
          codigo: "X",
          descripcion: null,
          limite_usos: null,
          limite_usos_por_usuario: null,
          descuento_porcentaje: 10,
          fecha_inicio: "2020-01-01T00:00:00Z",
          fecha_expiracion: "2020-12-31T23:59:59Z",
          activo: true,
        },
        new Date("2026-06-01T00:00:00Z"),
      ),
    ).toBe(false);
  });
});
