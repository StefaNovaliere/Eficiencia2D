import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  normalizePlan,
  normalizePlanesList,
  normalizeSuscripcion,
  seleccionarPlan,
  MOCK_PLANES,
  type Plan,
} from "@/services/planes";
import { apiFetch } from "@/services/api";

vi.mock("@/services/api", () => ({
  apiFetch: vi.fn(),
}));

const apiFetchMock = vi.mocked(apiFetch);

function fakeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const PRO: Plan = MOCK_PLANES.find((p) => p.slug === "pro")!;
const GRATIS: Plan = MOCK_PLANES.find((p) => p.slug === "gratis")!;

describe("normalizePlan", () => {
  it("acepta snake_case del backend y aplica defaults", () => {
    const plan = normalizePlan({
      id: "pro",
      nombre: "Pro",
      precio_mensual: 8000,
      features: ["a", "b"],
      recomendado: true,
    });
    expect(plan).not.toBeNull();
    expect(plan!.moneda).toBe("ARS");
    expect(plan!.periodo).toBe("mes");
    expect(plan!.destacado).toBe(true);
    expect(plan!.features).toEqual(["a", "b"]);
  });

  it("descarta entradas sin id o sin nombre", () => {
    expect(normalizePlan({ nombre: "x" })).toBeNull();
    expect(normalizePlan({ id: "x", nombre: "" })).toBeNull();
    expect(normalizePlan(null)).toBeNull();
  });
});

describe("normalizePlanesList", () => {
  it("ordena por `orden` y tolera envoltorios {planes|items|data}", () => {
    const list = normalizePlanesList({
      planes: [
        { id: "b", nombre: "B", orden: 2 },
        { id: "a", nombre: "A", orden: 1 },
      ],
    });
    expect(list.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("devuelve [] para formas inesperadas", () => {
    expect(normalizePlanesList(null)).toEqual([]);
    expect(normalizePlanesList({ nope: 1 })).toEqual([]);
  });
});

describe("normalizeSuscripcion", () => {
  it("normaliza estado válido y extrae plan_id anidado", () => {
    const sub = normalizeSuscripcion({
      suscripcion: { plan_id: "pro", estado: "activa", periodo_fin: "2026-08-01" },
    });
    expect(sub.plan_id).toBe("pro");
    expect(sub.estado).toBe("activa");
    expect(sub.periodo_fin).toBe("2026-08-01");
  });

  it("cae a 'ninguna' ante estado desconocido o vacío", () => {
    expect(normalizeSuscripcion({ estado: "raro" }).estado).toBe("ninguna");
    expect(normalizeSuscripcion(null)).toEqual({
      plan_id: null,
      estado: "ninguna",
      periodo_fin: null,
    });
  });
});

describe("seleccionarPlan", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  it("plan pago con checkout_url → kind:'checkout' (redirige a MP)", async () => {
    apiFetchMock.mockResolvedValue(
      fakeResponse(200, { checkout_url: "https://mp.example/checkout/123" }),
    );
    const result = await seleccionarPlan("tok", PRO);
    expect(result).toEqual({ kind: "checkout", url: "https://mp.example/checkout/123" });
  });

  it("plan gratis 200 sin checkout → kind:'activa'", async () => {
    apiFetchMock.mockResolvedValue(
      fakeResponse(200, { plan_id: "gratis", estado: "activa", periodo_fin: null }),
    );
    const result = await seleccionarPlan("tok", GRATIS);
    expect(result.kind).toBe("activa");
    if (result.kind === "activa") {
      expect(result.suscripcion.plan_id).toBe("gratis");
      expect(result.suscripcion.estado).toBe("activa");
    }
  });

  it("error 500 → tira con el detail del backend (no 'activado')", async () => {
    apiFetchMock.mockResolvedValue(
      fakeResponse(500, { detail: "MercadoPago no está configurado." }),
    );
    await expect(seleccionarPlan("tok", PRO)).rejects.toThrow(
      "MercadoPago no está configurado.",
    );
  });
});

describe("MOCK_PLANES (fallback inventado)", () => {
  it("tiene 3 tiers con un destacado", () => {
    expect(MOCK_PLANES).toHaveLength(3);
    expect(MOCK_PLANES.filter((p) => p.destacado)).toHaveLength(1);
    expect(MOCK_PLANES.some((p) => p.precio_mensual === 0)).toBe(true);
  });
});
