import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// CONTRATO_verificacion §0 y §3.2: el instructivo pide `/verificacion` (reporte y
// piezas recortadas, sin planchas) y consulta el efecto previsto de cada botón.

vi.mock("@/services/api-base", () => ({
  fetchWithApiFallback: vi.fn(async (path: string, init?: RequestInit) => {
    return fetch(`http://test.local${path}`, init);
  }),
  invalidateApiBaseUrl: vi.fn(),
}));

import { fetchEfectosVerificacion, fetchVerificacion } from "@/services/api";
import { parseEfectos, parseVerificacion } from "@/core/verificacion";
// Respuestas REALES del backend (demo.obj, 1:100), recortadas.
import respuesta from "./fixtures/verificacion-respuesta-demo.json";
import efectosCompletos from "./fixtures/verificacion-efectos-demo.json";

const mockFetch = vi.fn();
beforeEach(() => vi.stubGlobal("fetch", mockFetch));
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as unknown as Response;
}

const pedido = {
  file_id: "abc",
  axis: "Y" as const,
  min_area_m2: 1,
  merges: [[180, 182]],
  splits: [],
  overrides: { 18: "discard" },
  wall_wall_decisions: {},
  marks: [],
  sheet_config: { width_m: 1, height_m: 0.6, gap_m: 0.003 },
  scale_denom: 100,
};

describe("fetchVerificacion", () => {
  it("pide /api/verificacion con el mismo cuerpo que /nesting-preview", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(respuesta));
    await fetchVerificacion(pedido);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("http://test.local/api/verificacion");
    const cuerpo = JSON.parse(String(init.body));
    expect(cuerpo.merges).toEqual([[180, 182]]);
    expect(cuerpo.overrides).toEqual({ "18": "discard" });
    expect(cuerpo.scale_denom).toBe(100);
  });

  it("lee el reporte, las piezas recortadas, los absorbidos, los avisos y las juntas", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(respuesta));
    const r = await fetchVerificacion(pedido);
    expect(r.verificacion?.veredicto).toBe("no_arma");
    // Las piezas llegan ya recortadas, con su contorno y la etiqueta de la plancha.
    expect([...r.nestingPlacements!.keys()].sort()).toEqual([180, 182]);
    expect(r.nestingPlacements!.get(180)?.panelId).toBe("A9");
    expect(r.nestingPlacements!.get(180)?.outline?.length).toBeGreaterThan(3);
    expect(r.absorbedGroups?.get(183)).toBe(180);
    expect(r.warnings?.length).toBe(3);
    expect(r.plateJoints?.[0]).toHaveProperty("cutId");
    // No trae planchas: no es un nesting.
    expect(r.wallNesting).toBeUndefined();
    expect(r.floorNesting).toBeUndefined();
  });

  it("trae los efectos que ya estaban calculados al responder", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(respuesta));
    const r = await fetchVerificacion(pedido);
    expect(r.efectos?.listo).toBe(false);
    expect(r.efectos?.total).toBe(4);
    expect(r.efectos?.efectos.get("b60ff963a827")?.resultado).toBe("mejora");
  });

  it("una respuesta sin `efectos` no deja nada por consultar", async () => {
    const { efectos: _sin, ...sinEfectos } = respuesta;
    mockFetch.mockResolvedValueOnce(jsonResponse(sinEfectos));
    const r = await fetchVerificacion(pedido);
    expect(r.efectos).toEqual({
      listo: true,
      calculadas: 0,
      total: 0,
      efectos: new Map(),
      sinSesion: false,
    });
  });

  /**
   * Backend anterior a este contrato: el endpoint no existe. Se atiende con
   * `/nesting-preview`, que trae lo mismo (más lento), y no hay efectos.
   */
  it("con un backend sin el endpoint (404) cae a /nesting-preview", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ detail: "Not Found" }, 404));
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        wall_nesting: { sheets: [], config: {}, scale_denom: 100, unplaced: [] },
        floor_nesting: { sheets: [], config: {}, scale_denom: 100, unplaced: [] },
        config: { width_m: 1, height_m: 0.6, gap_m: 0.003 },
        verificacion: respuesta.verificacion,
        placements: respuesta.placements,
      }),
    );
    const r = await fetchVerificacion(pedido);
    expect(mockFetch.mock.calls.map((c) => c[0])).toEqual([
      "http://test.local/api/verificacion",
      "http://test.local/api/nesting-preview",
    ]);
    expect(r.verificacion?.veredicto).toBe("no_arma");
    expect(r.nestingPlacements?.size).toBe(2);
    expect(r.efectos).toBeUndefined();
  });

  it("un error del backend se propaga con su detalle, sin caer al nesting", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ detail: "Error en verificación: se rompió" }, 500),
    );
    await expect(fetchVerificacion(pedido)).rejects.toThrow(/se rompió/);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe("efectos previstos (§3.2)", () => {
  it("fetchEfectosVerificacion consulta /api/verificacion/efectos con el mismo cuerpo", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(efectosCompletos));
    const e = await fetchEfectosVerificacion(pedido);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("http://test.local/api/verificacion/efectos");
    expect(JSON.parse(String(init.body)).merges).toEqual([[180, 182]]);
    expect(e.listo).toBe(true);
    expect(e.efectos.size).toBe(4);
  });

  it("cada acción con efecto se encuentra por su id", () => {
    const v = parseVerificacion(respuesta.verificacion)!;
    const e = parseEfectos(efectosCompletos)!;
    const acciones = v.nudos[0].acciones;
    // Las que cambian algo traen id; las informativas, null.
    expect(acciones.map((a) => a.id)).toEqual(["b60ff963a827", "e28048d2f875", null, null]);
    const efecto = e.efectos.get(acciones[0].id!);
    expect(efecto).toEqual({
      resultado: "mejora",
      esteLugar: "resuelto",
      texto: "Resuelve este lugar",
    });
  });

  it("sin sesión en el backend lo dice", () => {
    const e = parseEfectos({ listo: false, calculadas: 0, total: 0, efectos: {}, sin_sesion: true })!;
    expect(e.sinSesion).toBe(true);
    expect(e.efectos.size).toBe(0);
  });

  it("un resultado que no conoce queda como desconocido, no como mejora", () => {
    const e = parseEfectos({
      listo: true,
      calculadas: 1,
      total: 1,
      efectos: { abc: { resultado: "otra_cosa", este_lugar: "raro", texto: "?" } },
    })!;
    expect(e.efectos.get("abc")).toEqual({ resultado: "desconocido", esteLugar: null, texto: "?" });
  });

  it("algo que no es un objeto no se toma por efectos", () => {
    expect(parseEfectos(undefined)).toBeUndefined();
    expect(parseEfectos("nada")).toBeUndefined();
    expect(parseEfectos(null)).toBeUndefined();
  });
});
