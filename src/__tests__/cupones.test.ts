import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/api-base", () => ({
  fetchWithApiFallback: vi.fn(),
  invalidateApiBaseUrl: vi.fn(),
}));

import { fetchWithApiFallback } from "@/services/api-base";
import {
  calcularPrecioFinalConDescuento,
  createCupon,
  formatCuponBeneficio,
  isCuponActive,
  listCupones,
  resolverPrecioFinalDescuento,
  updateCupon,
  validarCuponPorCodigo,
} from "@/services/cupones";

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
            tipo: "descuento",
            plan_id: null,
            plan: null,
            limite_usos: 100,
            limite_usos_por_usuario: 1,
            descuento_porcentaje: 20,
            descuento_monto: null,
            fecha_inicio: "2026-06-01T00:00:00Z",
            fecha_expiracion: "2026-08-31T23:59:59Z",
            activo: true,
            usos_actuales: 5,
          },
        ],
        total: 1,
        page: 1,
        page_size: 20,
        total_pages: 1,
      }),
    );

    const result = await listCupones("token");
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
    expect(result.page_size).toBe(20);
    expect(result.cupones[0].codigo).toBe("VERANO2026");
    expect(result.cupones[0].tipo).toBe("descuento");
    expect(result.cupones[0].descuento_porcentaje).toBe(20);
  });
});

describe("createCupon", () => {
  it("envía POST con código en mayúsculas y beneficio porcentual", async () => {
    vi.mocked(fetchWithApiFallback).mockResolvedValueOnce(
      jsonResponse({
        id: "c2",
        codigo: "NUEVO",
        tipo: "descuento",
        descuento_porcentaje: 15,
        activo: true,
      }),
    );

    const created = await createCupon("token", {
      codigo: "nuevo",
      descripcion: "15% off",
      limite_usos: 50,
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

  it("envía plan_id para cupón de acceso a plan", async () => {
    vi.mocked(fetchWithApiFallback).mockResolvedValueOnce(
      jsonResponse({
        id: "c3",
        codigo: "PROGRATIS",
        tipo: "plan",
        plan_id: 2,
        activo: true,
      }),
    );

    await createCupon("token", {
      codigo: "PROGRATIS",
      descripcion: "Acceso Pro",
      limite_usos: 10,
      plan_id: 2,
    });

    expect(fetchWithApiFallback).toHaveBeenCalledWith(
      expect.stringContaining("/api/cupones"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"plan_id":2'),
      }),
      expect.objectContaining({ token: "token" }),
    );
  });
});

describe("updateCupon", () => {
  it("envía PATCH con activo false", async () => {
    vi.mocked(fetchWithApiFallback).mockResolvedValueOnce(
      jsonResponse({
        id: "c1",
        codigo: "VERANO2026",
        tipo: "descuento",
        descuento_porcentaje: 20,
        activo: false,
      }),
    );

    const updated = await updateCupon("token", "c1", { activo: false });

    expect(updated.activo).toBe(false);
    expect(fetchWithApiFallback).toHaveBeenCalledWith(
      expect.stringContaining("/api/cupones/c1"),
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ activo: false }),
      }),
      expect.objectContaining({ token: "token" }),
    );
  });
});

describe("validarCuponPorCodigo", () => {
  it("valida cupón sin plan_id (solo código)", async () => {
    vi.mocked(fetchWithApiFallback).mockResolvedValueOnce(
      jsonResponse({
        tipo: "descuento",
        message: "Cupón válido: 20% de descuento",
        precio_original: null,
        precio_final: null,
        cupon: {
          id: "c1",
          codigo: "VERANO2026",
          tipo: "descuento",
          descuento_porcentaje: 20,
          activo: true,
        },
      }),
    );

    const result = await validarCuponPorCodigo("VERANO2026", { token: "token" });

    expect(result.tipo).toBe("descuento");
    expect(fetchWithApiFallback).toHaveBeenCalledWith(
      expect.stringContaining("/api/cupones/validar"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ codigo: "VERANO2026" }),
      }),
      expect.objectContaining({ token: "token" }),
    );
  });

  it("envía POST a /validar con código y plan_id para calcular precio", async () => {
    vi.mocked(fetchWithApiFallback).mockResolvedValueOnce(
      jsonResponse({
        tipo: "descuento",
        message: "Cupón válido: 20% de descuento",
        precio_original: 8000,
        precio_final: 6400,
        cupon: {
          id: "c1",
          codigo: "VERANO2026",
          tipo: "descuento",
          descuento_porcentaje: 20,
          activo: true,
        },
      }),
    );

    const result = await validarCuponPorCodigo("verano2026", {
      planId: 2,
      token: "token",
    });

    expect(result.tipo).toBe("descuento");
    expect(result.precio_final).toBe(6400);
    expect(result.cupon.codigo).toBe("VERANO2026");
    expect(fetchWithApiFallback).toHaveBeenCalledWith(
      expect.stringContaining("/api/cupones/validar"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ codigo: "VERANO2026", plan_id: 2 }),
      }),
      expect.objectContaining({ token: "token" }),
    );
  });

  it("parsea cupón tipo plan", async () => {
    vi.mocked(fetchWithApiFallback).mockResolvedValueOnce(
      jsonResponse({
        tipo: "plan",
        message: "Cupón válido: acceso al plan Pro",
        precio_original: null,
        precio_final: null,
        cupon: {
          id: "c4",
          codigo: "PROGRATIS",
          tipo: "plan",
          plan_id: 2,
          plan: {
            id: 2,
            slug: "pro",
            nombre: "Pro",
            precio_mensual: 8000,
            moneda: "ARS",
          },
          activo: true,
        },
      }),
    );

    const result = await validarCuponPorCodigo("PROGRATIS", { planId: 2 });
    expect(result.tipo).toBe("plan");
    expect(result.cupon.plan?.nombre).toBe("Pro");
    expect(formatCuponBeneficio(result.cupon)).toBe("Acceso a Pro");
  });
});

describe("calcularPrecioFinalConDescuento", () => {
  it("aplica descuento porcentual", () => {
    expect(
      calcularPrecioFinalConDescuento(8000, {
        id: "1",
        codigo: "X",
        descripcion: null,
        tipo: "descuento",
        plan_id: null,
        plan: null,
        descuento_porcentaje: 20,
        descuento_monto: null,
        limite_usos: null,
        limite_usos_por_usuario: null,
        fecha_inicio: null,
        fecha_expiracion: null,
        activo: true,
      }),
    ).toBe(6400);
  });

  it("aplica descuento fijo sin bajar de cero", () => {
    expect(
      calcularPrecioFinalConDescuento(8000, {
        id: "1",
        codigo: "X",
        descripcion: null,
        tipo: "descuento",
        plan_id: null,
        plan: null,
        descuento_porcentaje: null,
        descuento_monto: 1500,
        limite_usos: null,
        limite_usos_por_usuario: null,
        fecha_inicio: null,
        fecha_expiracion: null,
        activo: true,
      }),
    ).toBe(6500);
  });

  it("prefiere precio_final del backend en resolverPrecioFinalDescuento", () => {
    const cupon = {
      id: "1",
      codigo: "X",
      descripcion: null,
      tipo: "descuento" as const,
      plan_id: null,
      plan: null,
      descuento_porcentaje: 20,
      descuento_monto: null,
      limite_usos: null,
      limite_usos_por_usuario: null,
      fecha_inicio: null,
      fecha_expiracion: null,
      activo: true,
    };
    expect(resolverPrecioFinalDescuento(8000, cupon, { precio_final: 6000 })).toBe(6000);
    expect(resolverPrecioFinalDescuento(8000, cupon, null)).toBe(6400);
  });
});

describe("isCuponActive", () => {
  it("devuelve false si activo es false", () => {
    expect(
      isCuponActive({
        id: "1",
        codigo: "X",
        descripcion: null,
        tipo: "descuento",
        plan_id: null,
        plan: null,
        limite_usos: null,
        limite_usos_por_usuario: null,
        descuento_porcentaje: 10,
        descuento_monto: null,
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
          tipo: "descuento",
          plan_id: null,
          plan: null,
          limite_usos: null,
          limite_usos_por_usuario: null,
          descuento_porcentaje: 10,
          descuento_monto: null,
          fecha_inicio: "2020-01-01T00:00:00Z",
          fecha_expiracion: "2020-12-31T23:59:59Z",
          activo: true,
        },
        new Date("2026-06-01T00:00:00Z"),
      ),
    ).toBe(false);
  });
});
