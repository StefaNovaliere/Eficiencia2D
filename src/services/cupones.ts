import { apiFetch } from "@/services/api";
import { parseApiError } from "@/services/api-errors";

export interface Cupon {
  id: string;
  codigo: string;
  descripcion: string | null;
  limite_usos: number | null;
  limite_usos_por_usuario: number | null;
  descuento_porcentaje: number;
  fecha_inicio: string | null;
  fecha_expiracion: string | null;
  activo: boolean;
  usos_actuales?: number;
  fecha_creacion?: string;
}

export interface CreateCuponPayload {
  codigo: string;
  descripcion?: string;
  limite_usos?: number;
  limite_usos_por_usuario?: number;
  descuento_porcentaje: number;
  fecha_inicio?: string;
  fecha_expiracion?: string;
  activo?: boolean;
}

export interface CuponesListResult {
  cupones: Cupon[];
  total: number;
}

function normalizeCupon(raw: unknown): Cupon | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  const id = c.id ?? c.cupon_id;
  const codigo = c.codigo;
  if (id == null || id === "" || codigo == null || codigo === "") return null;

  return {
    id: String(id),
    codigo: String(codigo).toUpperCase(),
    descripcion: c.descripcion != null ? String(c.descripcion) : null,
    limite_usos: c.limite_usos != null ? Number(c.limite_usos) : null,
    limite_usos_por_usuario:
      c.limite_usos_por_usuario != null ? Number(c.limite_usos_por_usuario) : null,
    descuento_porcentaje: Number(c.descuento_porcentaje ?? 0),
    fecha_inicio: c.fecha_inicio != null ? String(c.fecha_inicio) : null,
    fecha_expiracion: c.fecha_expiracion != null ? String(c.fecha_expiracion) : null,
    activo: Boolean(c.activo ?? true),
    usos_actuales: c.usos_actuales != null ? Number(c.usos_actuales) : undefined,
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
    descuento_porcentaje: payload.descuento_porcentaje,
    activo: payload.activo ?? true,
  };

  const descripcion = payload.descripcion?.trim();
  if (descripcion) body.descripcion = descripcion;
  if (payload.limite_usos != null) body.limite_usos = payload.limite_usos;
  if (payload.limite_usos_por_usuario != null) {
    body.limite_usos_por_usuario = payload.limite_usos_por_usuario;
  }
  if (payload.fecha_inicio) body.fecha_inicio = payload.fecha_inicio;
  if (payload.fecha_expiracion) body.fecha_expiracion = payload.fecha_expiracion;

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
