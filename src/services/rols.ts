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

function parseRolId(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function defaultRolLabel(rolId: number): string {
  return rolId === ADMIN_ROL_ID ? "admin" : "estudiante";
}

/** Extrae rol_id y nombre desde la respuesta del backend. Admin = rol_id 2. */
export function parseUserRol(raw: unknown): ParsedUserRol {
  const u = raw as Record<string, unknown>;

  const directRolId = parseRolId(u.rol_id);
  if (directRolId != null) {
    return {
      rol_id: directRolId,
      rol: extractRolName(u.rol) ?? defaultRolLabel(directRolId),
    };
  }

  if (u.rol != null && typeof u.rol === "object") {
    const nested = u.rol as Record<string, unknown>;
    const nestedRolId = parseRolId(nested.rol_id ?? nested.id);
    if (nestedRolId != null) {
      return {
        rol_id: nestedRolId,
        rol: String(nested.rol ?? defaultRolLabel(nestedRolId)),
      };
    }
  }

  if (typeof u.rol === "string" && u.rol !== "") {
    // Sin rol_id no inferimos permisos desde el nombre del rol.
    return { rol_id: 1, rol: u.rol };
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
