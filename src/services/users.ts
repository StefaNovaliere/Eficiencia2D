import { apiFetch } from "@/services/api";
import { parseApiError } from "@/services/api-errors";
import {
  NOMBRE_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  type UserEstado,
  type UserRol,
} from "@/services/auth";

export interface UserProfile {
  id: string;
  email: string;
  nombre: string | null;
  estado: UserEstado;
  rol?: UserRol;
  fecha_creacion: string;
  email_verified_at: string | null;
  total_proyectos: number;
}

export interface ChangePasswordResponse {
  message: string;
}

export async function fetchUserProfile(token: string): Promise<UserProfile> {
  const res = await apiFetch("/api/users/me", { method: "GET" }, { token });

  if (!res.ok) {
    await parseApiError(res, "No se pudo cargar el perfil");
  }

  return res.json();
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

  return res.json();
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

export { PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH, NOMBRE_MAX_LENGTH };
