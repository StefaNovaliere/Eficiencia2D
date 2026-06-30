import { apiFetch } from "@/services/api";

/** Id del rol administrador en el backend. */
export const ADMIN_ROL_ID = 2;

export interface Rol {
  id: number;
  rol: string;
}

export interface ParsedUserRol {
  rol_id: number;
  rol: string;
}

/** Extrae rol_id y nombre desde distintos formatos del backend. */
export function parseUserRol(raw: unknown): ParsedUserRol {
  const u = raw as Record<string, unknown>;

  if (typeof u.rol_id === "number") {
    return {
      rol_id: u.rol_id,
      rol: extractRolName(u.rol) ?? (u.rol_id === ADMIN_ROL_ID ? "admin" : "estudiante"),
    };
  }

  if (u.rol != null && typeof u.rol === "object") {
    const nested = u.rol as Record<string, unknown>;
    const rolId = Number(nested.id);
    return {
      rol_id: Number.isFinite(rolId) ? rolId : 1,
      rol: String(nested.rol ?? "estudiante"),
    };
  }

  if (typeof u.rol === "string") {
    const name = u.rol;
    return {
      rol_id: name === "admin" ? ADMIN_ROL_ID : 1,
      rol: name,
    };
  }

  return { rol_id: 1, rol: "estudiante" };
}

function extractRolName(value: unknown): string | null {
  if (typeof value === "string" && value !== "") return value;
  if (value != null && typeof value === "object" && "rol" in value) {
    const name = (value as Record<string, unknown>).rol;
    return typeof name === "string" && name !== "" ? name : null;
  }
  return null;
}

export function isAdminRolId(rolId: number | null | undefined): boolean {
  return rolId === ADMIN_ROL_ID;
}

function normalizeRol(raw: unknown): Rol | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = r.id ?? r.rol_id;
  const name = r.rol ?? r.nombre ?? r.name;
  if (id == null || name == null || name === "") return null;

  return {
    id: Number(id),
    rol: String(name),
  };
}

function normalizeRolsList(raw: unknown): Rol[] {
  if (Array.isArray(raw)) {
    return raw.map(normalizeRol).filter((item): item is Rol => item != null);
  }

  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const list = o.rols ?? o.items ?? o.data;
    if (Array.isArray(list)) {
      return list.map(normalizeRol).filter((item): item is Rol => item != null);
    }
  }

  return [];
}

export async function getRols(): Promise<Rol[]> {
  const response = await apiFetch("/api/rols");
  return normalizeRolsList(await response.json());
}

export async function getRolByUserId(id: number): Promise<Rol> {
  const response = await apiFetch(`/api/rols/user/${id}`);
  const raw = await response.json();
  const rol = normalizeRol(raw);
  if (!rol) {
    throw new Error("No se pudo interpretar el rol del usuario");
  }
  return rol;
}
