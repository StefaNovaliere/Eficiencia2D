import { apiFetch } from "@/services/api";
import { parseApiError } from "@/services/api-errors";

export type CuponTipo = "descuento" | "plan";

export interface CuponPlanInfo {
  id: number;
  slug: string;
  nombre: string;
  precio_mensual: number;
  moneda: string;
}

export interface Cupon {
  id: string;
  codigo: string;
  descripcion: string | null;
  tipo: CuponTipo;
  plan_id: number | null;
  plan: CuponPlanInfo | null;
  descuento_porcentaje: number | null;
  descuento_monto: number | null;
  limite_usos: number | null;
  limite_usos_por_usuario: number | null;
  fecha_inicio: string | null;
  fecha_expiracion: string | null;
  activo: boolean;
  usos_actuales?: number;
  usos_totales?: number;
  fecha_creacion?: string;
}

export type CreateCuponPayload =
  | {
      codigo: string;
      descripcion: string;
      limite_usos: number;
      limite_usos_por_usuario?: number;
      descuento_porcentaje: number;
      fecha_inicio?: string;
      fecha_expiracion?: string;
      activo?: boolean;
    }
  | {
      codigo: string;
      descripcion: string;
      limite_usos: number;
      limite_usos_por_usuario?: number;
      descuento_monto: number;
      fecha_inicio?: string;
      fecha_expiracion?: string;
      activo?: boolean;
    }
  | {
      codigo: string;
      descripcion: string;
      limite_usos: number;
      limite_usos_por_usuario?: number;
      plan_id: number;
      fecha_inicio?: string;
      fecha_expiracion?: string;
      activo?: boolean;
    };

export interface CuponesListResult {
  cupones: Cupon[];
  total: number;
}

export interface ValidarCuponResult {
  tipo: CuponTipo;
  message: string;
  precio_original: number | null;
  precio_final: number | null;
  cupon: Cupon;
}

function normalizeCuponPlan(raw: unknown): CuponPlanInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const id = Number(p.id);
  if (!Number.isFinite(id)) return null;
  return {
    id,
    slug: String(p.slug ?? ""),
    nombre: String(p.nombre ?? ""),
    precio_mensual: Number(p.precio_mensual ?? 0),
    moneda: String(p.moneda ?? "ARS"),
  };
}

function inferCuponTipo(c: Record<string, unknown>): CuponTipo {
  const tipo = c.tipo;
  if (tipo === "plan" || tipo === "descuento") return tipo;
  if (c.plan_id != null || c.plan != null) return "plan";
  return "descuento";
}

export function normalizeCupon(raw: unknown): Cupon | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  const id = c.id ?? c.cupon_id;
  const codigo = c.codigo;
  if (id == null || id === "" || codigo == null || codigo === "") return null;

  const tipo = inferCuponTipo(c);
  const planIdRaw = c.plan_id ?? (c.plan as Record<string, unknown> | undefined)?.id;
  const planId =
    planIdRaw != null && planIdRaw !== "" && Number.isFinite(Number(planIdRaw))
      ? Number(planIdRaw)
      : null;

  const descPct = c.descuento_porcentaje;
  const descMonto = c.descuento_monto;

  return {
    id: String(id),
    codigo: String(codigo).toUpperCase(),
    descripcion: c.descripcion != null ? String(c.descripcion) : null,
    tipo,
    plan_id: planId,
    plan: normalizeCuponPlan(c.plan),
    descuento_porcentaje:
      descPct != null && descPct !== "" ? Number(descPct) : null,
    descuento_monto:
      descMonto != null && descMonto !== "" ? Number(descMonto) : null,
    limite_usos: c.limite_usos != null ? Number(c.limite_usos) : null,
    limite_usos_por_usuario:
      c.limite_usos_por_usuario != null ? Number(c.limite_usos_por_usuario) : null,
    fecha_inicio: c.fecha_inicio != null ? String(c.fecha_inicio) : null,
    fecha_expiracion: c.fecha_expiracion != null ? String(c.fecha_expiracion) : null,
    activo: Boolean(c.activo ?? true),
    usos_actuales:
      c.usos_actuales != null
        ? Number(c.usos_actuales)
        : c.usos_totales != null
          ? Number(c.usos_totales)
          : undefined,
    usos_totales: c.usos_totales != null ? Number(c.usos_totales) : undefined,
    fecha_creacion: c.fecha_creacion != null ? String(c.fecha_creacion) : undefined,
  };
}

function normalizeCuponesListResponse(raw: unknown): CuponesListResult {
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;

    if (Array.isArray(o.cupones)) {
      const cupones = o.cupones
        .map(normalizeCupon)
        .filter((item): item is Cupon => item != null);
      return { cupones, total: Number(o.total ?? cupones.length) };
    }

    const legacyList = o.items ?? o.data;
    if (Array.isArray(legacyList)) {
      const cupones = legacyList
        .map(normalizeCupon)
        .filter((item): item is Cupon => item != null);
      return { cupones, total: cupones.length };
    }
  }

  if (Array.isArray(raw)) {
    const cupones = raw.map(normalizeCupon).filter((item): item is Cupon => item != null);
    return { cupones, total: cupones.length };
  }

  return { cupones: [], total: 0 };
}

function normalizeValidarCuponResponse(raw: unknown): ValidarCuponResult {
  const o = raw as Record<string, unknown>;
  const cupon = normalizeCupon(o.cupon ?? o);
  if (!cupon) {
    throw new Error("Respuesta de cupón inválida");
  }

  const tipoRaw = o.tipo ?? cupon.tipo;
  const tipo: CuponTipo = tipoRaw === "plan" ? "plan" : "descuento";

  return {
    tipo,
    message: String(o.message ?? "Cupón válido"),
    precio_original:
      o.precio_original != null && o.precio_original !== ""
        ? Number(o.precio_original)
        : null,
    precio_final:
      o.precio_final != null && o.precio_final !== "" ? Number(o.precio_final) : null,
    cupon: { ...cupon, tipo },
  };
}

export async function listCupones(token: string): Promise<CuponesListResult> {
  const res = await apiFetch("/api/cupones", { method: "GET" }, { token });

  if (!res.ok) {
    await parseApiError(res, "No se pudieron cargar los cupones");
  }

  return normalizeCuponesListResponse(await res.json());
}

export async function fetchCupon(token: string, cuponId: string): Promise<Cupon> {
  const res = await apiFetch(`/api/cupones/${cuponId}`, { method: "GET" }, { token });

  if (!res.ok) {
    await parseApiError(res, "No se pudo cargar el cupón");
  }

  const cupon = normalizeCupon(await res.json());
  if (!cupon) {
    throw new Error("Respuesta de cupón inválida");
  }

  return cupon;
}

export async function createCupon(token: string, payload: CreateCuponPayload): Promise<Cupon> {
  const body: Record<string, unknown> = {
    codigo: payload.codigo.trim().toUpperCase(),
    descripcion: payload.descripcion.trim(),
    limite_usos: payload.limite_usos,
    activo: payload.activo ?? true,
  };

  if (payload.limite_usos_por_usuario != null) {
    body.limite_usos_por_usuario = payload.limite_usos_por_usuario;
  }
  if (payload.fecha_inicio) body.fecha_inicio = payload.fecha_inicio;
  if (payload.fecha_expiracion) body.fecha_expiracion = payload.fecha_expiracion;

  if ("descuento_porcentaje" in payload) {
    body.descuento_porcentaje = payload.descuento_porcentaje;
  } else if ("descuento_monto" in payload) {
    body.descuento_monto = payload.descuento_monto;
  } else if ("plan_id" in payload) {
    body.plan_id = payload.plan_id;
  }

  const res = await apiFetch(
    "/api/cupones",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    { token },
  );

  if (!res.ok) {
    await parseApiError(res, "No se pudo crear el cupón");
  }

  const cupon = normalizeCupon(await res.json());
  if (!cupon) {
    throw new Error("Respuesta de cupón inválida");
  }

  return cupon;
}

/** Valida un cupón. planId es opcional: sin él confirma vigencia y tipo; con él calcula el precio final. */
export async function validarCuponPorCodigo(
  codigo: string,
  options?: { planId?: number; token?: string | null },
): Promise<ValidarCuponResult> {
  const normalized = codigo.trim().toUpperCase();
  if (!normalized) {
    throw new Error("Ingresá un código de cupón");
  }

  const body: Record<string, unknown> = { codigo: normalized };
  if (options?.planId != null && Number.isFinite(options.planId)) {
    body.plan_id = options.planId;
  }

  const res = await apiFetch(
    "/api/cupones/validar",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    options?.token ? { token: options.token } : undefined,
  );

  if (!res.ok) {
    await parseApiError(res, "Cupón inválido o expirado");
  }

  const result = normalizeValidarCuponResponse(await res.json());
  if (!isCuponActive(result.cupon)) {
    throw new Error("Este cupón ya no está vigente");
  }
  return result;
}

export function isCuponActive(cupon: Cupon, now = new Date()): boolean {
  if (!cupon.activo) return false;

  if (cupon.fecha_inicio) {
    const start = new Date(cupon.fecha_inicio);
    if (!Number.isNaN(start.getTime()) && now < start) return false;
  }

  if (cupon.fecha_expiracion) {
    const end = new Date(cupon.fecha_expiracion);
    if (!Number.isNaN(end.getTime()) && now > end) return false;
  }

  if (cupon.limite_usos != null && cupon.usos_actuales != null) {
    if (cupon.usos_actuales >= cupon.limite_usos) return false;
  }

  return true;
}

export function formatCuponBeneficio(cupon: Cupon): string {
  if (cupon.tipo === "plan") {
    const planName = cupon.plan?.nombre ?? `plan #${cupon.plan_id ?? "?"}`;
    return `Acceso a ${planName}`;
  }
  if (cupon.descuento_porcentaje != null) {
    return `${cupon.descuento_porcentaje}% off`;
  }
  if (cupon.descuento_monto != null) {
    return `$${cupon.descuento_monto.toLocaleString("es-AR")} off`;
  }
  return "Descuento";
}

/** Calcula el precio final localmente a partir del cupón de descuento. */
export function calcularPrecioFinalConDescuento(
  precioOriginal: number,
  cupon: Cupon,
): number | null {
  if (cupon.tipo !== "descuento" || precioOriginal <= 0) return null;

  if (cupon.descuento_porcentaje != null) {
    const pct = cupon.descuento_porcentaje;
    if (!Number.isFinite(pct) || pct <= 0) return null;
    return Math.max(0, Math.round(precioOriginal * (1 - pct / 100)));
  }

  if (cupon.descuento_monto != null) {
    const monto = cupon.descuento_monto;
    if (!Number.isFinite(monto) || monto <= 0) return null;
    return Math.max(0, precioOriginal - monto);
  }

  return null;
}

/** Prefiere precio_final del backend; si no viene, calcula en el cliente. */
export function resolverPrecioFinalDescuento(
  precioOriginal: number,
  cupon: Cupon,
  validacion?: Pick<ValidarCuponResult, "precio_final"> | null,
): number | null {
  if (precioOriginal <= 0 || cupon.tipo !== "descuento") return null;

  if (validacion?.precio_final != null && Number.isFinite(validacion.precio_final)) {
    return validacion.precio_final;
  }

  return calcularPrecioFinalConDescuento(precioOriginal, cupon);
}

export function formatCuponDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("es-AR", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/** Convierte valor de `<input type="datetime-local">` a ISO UTC. */
export function datetimeLocalToIso(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}
