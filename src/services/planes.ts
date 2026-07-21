// ============================================================================
// Planes de pago (suscripciones) — capa de datos del FRONT.
//
// Hoy el backend todavía NO expone planes ni suscripción (ver
// CONTRATO_planes_pago.md para lo que debe implementar). Este módulo está escrito
// para funcionar YA con datos inventados (MOCK_PLANES + localStorage) y
// **conectarse solo** al backend cuando los endpoints existan, sin tocar la UI:
//   - lectura: intenta el endpoint real; si 404 / no-ok / error de red → mock/local.
//   - escritura: intenta el endpoint real; si falla → persiste en localStorage.
// El patrón de normalización sigue a `src/services/rols.ts`.
// ============================================================================

import { apiFetch } from "@/services/api";
import { parseApiError } from "@/services/api-errors";

export interface Plan {
  /** Id estable del plan (string; suele ser el id numérico del backend). */
  id: string;
  /** Id numérico para cupones y suscripción (`plan_id` en la API). */
  plan_id: number;
  /** Slug legible (`gratis` | `pro` | `estudio` | …). */
  slug: string;
  nombre: string;
  /** Precio del período en la moneda dada (0 = gratis). */
  precio_mensual: number;
  moneda: string;
  periodo: "mes" | "año";
  descripcion: string;
  features: string[];
  /** Plan recomendado (badge + resaltado). */
  destacado?: boolean;
  /** Orden de aparición (asc). */
  orden?: number;
}

export type SuscripcionEstado = "activa" | "pendiente" | "cancelada" | "ninguna";

export interface Suscripcion {
  /** Plan vigente, o null si no hay suscripción. */
  plan_id: string | null;
  estado: SuscripcionEstado;
  /** Fin del período vigente (ISO) o null. */
  periodo_fin: string | null;
  /** Si true, no se renueva al terminar el período. */
  cancela_al_fin?: boolean;
}

/** Resultado de seleccionar un plan: se activó, o hay que ir a pagar. */
export type SeleccionPlanResult =
  | { kind: "activa"; suscripcion: Suscripcion }
  | { kind: "checkout"; url: string };

// ---------------------------------------------------------------------------
// Planes inventados (placeholder). Reemplazar por los reales del backend.
// Precios en ARS, claramente de ejemplo.
// ---------------------------------------------------------------------------
export const MOCK_PLANES: Plan[] = [
  {
    id: "1",
    plan_id: 1,
    slug: "gratis",
    nombre: "Gratis",
    precio_mensual: 0,
    moneda: "ARS",
    periodo: "mes",
    descripcion: "Para probar la herramienta.",
    features: [
      "1 proyecto activo",
      "Visor 3D y revisión",
      "Exporta con marca de agua",
    ],
    orden: 1,
  },
  {
    id: "2",
    plan_id: 2,
    slug: "pro",
    nombre: "Pro",
    precio_mensual: 8000,
    moneda: "ARS",
    periodo: "mes",
    descripcion: "Para uso profesional.",
    features: [
      "Proyectos ilimitados",
      "Exporta sin marca de agua",
      "Instructivo de armado",
      "Soporte prioritario",
    ],
    destacado: true,
    orden: 2,
  },
  {
    id: "3",
    plan_id: 3,
    slug: "estudio",
    nombre: "Estudio",
    precio_mensual: 20000,
    moneda: "ARS",
    periodo: "mes",
    descripcion: "Para equipos y estudios.",
    features: [
      "Todo lo de Pro",
      "Múltiples usuarios",
      "Prioridad de cómputo",
      "Facturación por equipo",
    ],
    orden: 3,
  },
];

// ---------------------------------------------------------------------------
// Normalizadores tolerantes (aceptan snake_case del backend futuro).
// ---------------------------------------------------------------------------
function toStringArray(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x)).filter((s) => s.trim() !== "");
  }
  return [];
}

export function normalizePlan(raw: unknown): Plan | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const id = p.id ?? p.slug;
  const nombre = p.nombre ?? p.name ?? p.titulo;
  if (id == null || nombre == null || String(nombre).trim() === "") return null;

  const precio = Number(p.precio_mensual ?? p.precio ?? p.price ?? 0);
  const periodoRaw = String(p.periodo ?? p.period ?? "mes");
  const idStr = String(id);
  const numericId = Number(p.plan_id ?? idStr);
  const planId = Number.isFinite(numericId) ? numericId : 0;

  return {
    id: idStr,
    plan_id: planId,
    slug: String(p.slug ?? idStr),
    nombre: String(nombre),
    precio_mensual: Number.isFinite(precio) ? precio : 0,
    moneda: String(p.moneda ?? p.currency ?? "ARS"),
    periodo: periodoRaw === "año" || periodoRaw === "anio" ? "año" : "mes",
    descripcion: String(p.descripcion ?? p.description ?? ""),
    features: toStringArray(p.features ?? p.beneficios),
    destacado: Boolean(p.destacado ?? p.recomendado ?? p.featured ?? false),
    orden: p.orden != null ? Number(p.orden) : undefined,
  };
}

export function normalizePlanesList(raw: unknown): Plan[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object"
      ? ((raw as Record<string, unknown>).planes ??
          (raw as Record<string, unknown>).items ??
          (raw as Record<string, unknown>).data)
      : null;

  if (!Array.isArray(list)) return [];
  const planes = list
    .map(normalizePlan)
    .filter((x): x is Plan => x != null);
  planes.sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
  return planes;
}

/** Id numérico del plan para cupones y suscripción. */
export function resolvePlanNumericId(plan: Plan): number {
  if (Number.isFinite(plan.plan_id) && plan.plan_id > 0) return plan.plan_id;
  const parsed = Number(plan.id);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  throw new Error(`No se pudo resolver el id numérico del plan "${plan.nombre}"`);
}

/** Busca un plan del catálogo por id numérico o slug. */
export function findPlanByNumericId(planes: Plan[], planId: number): Plan | undefined {
  return planes.find((p) => p.plan_id === planId || Number(p.id) === planId);
}

const VALID_ESTADOS: SuscripcionEstado[] = [
  "activa",
  "pendiente",
  "cancelada",
  "ninguna",
];

export function normalizeSuscripcion(raw: unknown): Suscripcion {
  if (!raw || typeof raw !== "object") {
    return { plan_id: null, estado: "ninguna", periodo_fin: null };
  }
  const s = raw as Record<string, unknown>;
  const inner =
    s.suscripcion && typeof s.suscripcion === "object"
      ? (s.suscripcion as Record<string, unknown>)
      : s;

  const planId = inner.plan_id ?? inner.planId ?? inner.plan;
  const estadoRaw = String(inner.estado ?? inner.status ?? "ninguna") as SuscripcionEstado;
  const estado = VALID_ESTADOS.includes(estadoRaw) ? estadoRaw : "ninguna";
  const fin = inner.periodo_fin ?? inner.periodoFin ?? inner.current_period_end;

  return {
    plan_id: planId != null && String(planId).trim() !== "" ? String(planId) : null,
    estado,
    periodo_fin: fin != null && String(fin).trim() !== "" ? String(fin) : null,
    cancela_al_fin: Boolean(inner.cancela_al_fin ?? inner.cancel_at_period_end ?? false),
  };
}

// ---------------------------------------------------------------------------
// Persistencia local (fallback mientras no haya backend).
// TODO backend: cuando exista la suscripción server-side, esto deja de usarse.
// ---------------------------------------------------------------------------
const LOCAL_KEY = "e2d.plan.suscripcion";

export function getLocalSuscripcion(): Suscripcion {
  if (typeof window === "undefined") {
    return { plan_id: null, estado: "ninguna", periodo_fin: null };
  }
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY);
    if (!raw) return { plan_id: null, estado: "ninguna", periodo_fin: null };
    return normalizeSuscripcion(JSON.parse(raw));
  } catch {
    return { plan_id: null, estado: "ninguna", periodo_fin: null };
  }
}

// ---------------------------------------------------------------------------
// Lectura resiliente.
// ---------------------------------------------------------------------------

/** Trae el catálogo de planes. Cae a MOCK_PLANES si el backend no responde. */
export async function getPlanes(): Promise<Plan[]> {
  // TODO backend: reemplazar el mock cuando exista GET /api/planes.
  try {
    const res = await apiFetch("/api/planes");
    if (res.ok) {
      const planes = normalizePlanesList(await res.json());
      if (planes.length > 0) return planes;
    }
  } catch {
    /* red/endpoint no disponible → mock */
  }
  return MOCK_PLANES;
}

/** Resultado de leer la suscripción, con la marca de si vino de un fallback. */
export interface SuscripcionFetch {
  suscripcion: Suscripcion;
  /** true si se resolvió localmente (backend no disponible). */
  unavailable: boolean;
}

/** Suscripción vigente del usuario. Cae a localStorage si el backend no responde. */
export async function getMiSuscripcion(token: string): Promise<SuscripcionFetch> {
  // TODO backend: GET /api/users/me/suscripcion.
  try {
    const res = await apiFetch("/api/users/me/suscripcion", {}, { token });
    if (res.ok) {
      return { suscripcion: normalizeSuscripcion(await res.json()), unavailable: false };
    }
    // 404 → el endpoint aún no existe; degradar a local sin romper.
  } catch {
    /* red → local */
  }
  return { suscripcion: getLocalSuscripcion(), unavailable: true };
}

// ---------------------------------------------------------------------------
// Escritura (requiere backend; los errores se propagan, NO se ocultan).
// ---------------------------------------------------------------------------

export type SeleccionarPlanOptions = {
  cuponCodigo?: string;
  /** Pago único ya aprobado (Wallet Brick). Activa el plan sin preapproval. */
  mpPaymentId?: string;
  /** Bypass de desarrollo (MP_BYPASS_KEY del backend). */
  bypassKey?: string;
};

/**
 * Selecciona/cambia el plan.
 * - Plan gratis / cupón → `kind:"activa"`.
 * - Con `mpPaymentId` / `bypassKey` → activa plan pago.
 * - Plan pago sin pago → puede devolver `checkout_url` (preapproval legacy).
 */
export async function seleccionarPlan(
  token: string,
  plan: Plan,
  options?: SeleccionarPlanOptions,
): Promise<SeleccionPlanResult> {
  const payload: Record<string, string | number> = {
    plan_id: resolvePlanNumericId(plan),
  };
  const cuponCodigo = options?.cuponCodigo?.trim().toUpperCase();
  if (cuponCodigo) {
    payload.cupon_codigo = cuponCodigo;
  }
  if (options?.mpPaymentId?.trim()) {
    payload.mp_payment_id = options.mpPaymentId.trim();
  }
  if (options?.bypassKey?.trim()) {
    payload.bypass_key = options.bypassKey.trim();
  }

  const res = await apiFetch(
    "/api/users/me/suscripcion",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    { token },
  );

  if (!res.ok) {
    await parseApiError(res, "No se pudo procesar el plan");
  }

  const data = (await res.json()) as Record<string, unknown>;
  const checkout = data.checkout_url ?? data.checkoutUrl ?? data.init_point;
  if (typeof checkout === "string" && checkout.trim() !== "") {
    return { kind: "checkout", url: checkout };
  }
  return { kind: "activa", suscripcion: normalizeSuscripcion(data) };
}

/** Cancela la suscripción (al fin del período). Tira con el `detail` ante error. */
export async function cancelarSuscripcion(token: string): Promise<Suscripcion> {
  const res = await apiFetch(
    "/api/users/me/suscripcion",
    { method: "DELETE" },
    { token },
  );

  if (!res.ok) {
    await parseApiError(res, "No se pudo cancelar el plan");
  }

  return normalizeSuscripcion(await res.json());
}
