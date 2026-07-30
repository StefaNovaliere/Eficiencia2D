import { apiFetch } from "@/services/api";
import { parseApiError } from "@/services/api-errors";
import {
  NOMBRE_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  type UserEstado,
} from "@/services/auth";
import { parseUserRol } from "@/services/rols";

export interface UserProfile {
  id: string;
  email: string;
  nombre: string | null;
  estado: UserEstado;
  rol_id: number;
  rol: string;
  fecha_creacion: string;
  email_verified_at: string | null;
  total_proyectos: number;
}

function normalizeUserProfile(raw: unknown): UserProfile {
  const u = raw as Record<string, unknown>;
  const { rol_id, rol } = parseUserRol(raw);
  return {
    id: String(u.id ?? ""),
    email: String(u.email ?? ""),
    nombre: u.nombre != null && u.nombre !== "" ? String(u.nombre) : null,
    estado: (u.estado as UserEstado) ?? "activo",
    rol_id,
    rol,
    fecha_creacion: String(u.fecha_creacion ?? ""),
    email_verified_at:
      u.email_verified_at != null && u.email_verified_at !== ""
        ? String(u.email_verified_at)
        : null,
    total_proyectos: Number(u.total_proyectos ?? 0),
  };
}

export interface ChangePasswordResponse {
  message: string;
}

export async function fetchUserProfile(token: string): Promise<UserProfile> {
  const res = await apiFetch("/api/users/me", { method: "GET" }, { token });

  if (!res.ok) {
    await parseApiError(res, "No se pudo cargar el perfil");
  }

  return normalizeUserProfile(await res.json());
}

export async function updateUserProfile(
  token: string,
  patch: { nombre: string },
): Promise<UserProfile> {
  const trimmed = patch.nombre.trim().slice(0, NOMBRE_MAX_LENGTH);

  const res = await apiFetch(
    "/api/users/me",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre: trimmed }),
    },
    { token },
  );

  if (!res.ok) {
    await parseApiError(res, "No se pudo actualizar el nombre");
  }

  return normalizeUserProfile(await res.json());
}

export async function changeUserPassword(
  token: string,
  currentPassword: string,
  newPassword: string,
): Promise<ChangePasswordResponse> {
  const res = await apiFetch(
    "/api/users/me/password",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword,
      }),
    },
    { token },
  );

  if (!res.ok) {
    await parseApiError(res, "No se pudo cambiar la contraseña");
  }

  return res.json();
}

/** Persiste la aceptación de términos en el usuario autenticado. */
export async function aceptarTerminos(token: string): Promise<{ message: string; acepto_terminos_at: string }> {
  const res = await apiFetch(
    "/api/users/me/aceptar-terminos",
    { method: "POST" },
    { token },
  );

  if (!res.ok) {
    await parseApiError(res, "No se pudo registrar la aceptación de términos");
  }

  return res.json();
}

/** ¿El usuario aún no completó el onboarding / tour del visor? */
export async function fetchFirstTime(token: string): Promise<{ first_time: boolean }> {
  const res = await apiFetch("/api/users/me/first-time", { method: "GET" }, { token });

  if (!res.ok) {
    await parseApiError(res, "No se pudo consultar el estado de primera vez");
  }

  const data = (await res.json()) as { first_time?: unknown };
  return { first_time: Boolean(data.first_time) };
}

/** Marca el onboarding / tour como visto (`first_time = false`). */
export async function completarFirstTime(token: string): Promise<{ first_time: boolean }> {
  const res = await apiFetch(
    "/api/users/me/first-time",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ first_time: false }),
    },
    { token },
  );

  if (!res.ok) {
    await parseApiError(res, "No se pudo registrar el fin del recorrido");
  }

  // Algunos backends responden 204 sin cuerpo.
  if (res.status === 204) return { first_time: false };

  const text = await res.text();
  if (!text) return { first_time: false };

  const data = JSON.parse(text) as { first_time?: unknown };
  return { first_time: data.first_time === undefined ? false : Boolean(data.first_time) };
}

export { PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH, NOMBRE_MAX_LENGTH };
