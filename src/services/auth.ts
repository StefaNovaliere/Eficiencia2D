import { apiFetch } from "@/services/api";
import { parseApiError } from "@/services/api-errors";
import { ADMIN_ROL_ID, parseUserRol } from "@/services/rols";

export type UserEstado = "pendiente_verificacion" | "activo" | "inactivo" | (string & {});

export interface AuthUser {
  id: string;
  email: string;
  nombre: string | null;
  estado: UserEstado;
  rol_id: number;
  /** Nombre legible del rol (p. ej. "admin", "estudiante"). */
  rol: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: AuthUser;
}

/** Respuesta de registro — sin JWT, usuario en `pendiente_verificacion`. */
export interface RegisterResponse {
  message: string;
  email: string;
  verification_email_scheduled: boolean;
  user: AuthUser;
}

const AUTH_STORAGE_KEY = "e2d_auth";

export const PASSWORD_MIN_LENGTH = 6;
export const PASSWORD_MAX_LENGTH = 128;
export const NOMBRE_MAX_LENGTH = 120;

export interface StoredAuth {
  token: string;
  user: AuthUser;
}

export function isActiveUser(user: AuthUser | null | undefined): boolean {
  return user?.estado === "activo";
}

export function isAdminUser(user: AuthUser | null | undefined): boolean {
  return user?.rol_id === ADMIN_ROL_ID;
}

export function normalizeAuthUser(raw: unknown): AuthUser {
  const u = raw as Record<string, unknown>;
  const { rol_id, rol } = parseUserRol(raw);
  return {
    id: String(u.id ?? ""),
    email: String(u.email ?? ""),
    nombre: u.nombre != null && u.nombre !== "" ? String(u.nombre) : null,
    estado: (u.estado as UserEstado) ?? "activo",
    rol_id,
    rol,
  };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeRegisterResponse(raw: Record<string, unknown>): RegisterResponse {
  const scheduled =
    typeof raw.verification_email_scheduled === "boolean"
      ? raw.verification_email_scheduled
      : typeof raw.verification_email_sent === "boolean"
        ? raw.verification_email_sent
        : false;

  return {
    message: String(raw.message ?? ""),
    email: String(raw.email ?? ""),
    verification_email_scheduled: scheduled,
    user: normalizeAuthUser(raw.user),
  };
}

function assertActiveSession(user: AuthUser): void {
  if (!isActiveUser(user)) {
    throw new Error("Tu cuenta no está activa. Contactá soporte si el problema persiste.");
  }
}

export function loadStoredAuth(): StoredAuth | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredAuth;
    return {
      ...parsed,
      user: normalizeAuthUser(parsed.user),
    };
  } catch {
    return null;
  }
}

export function saveStoredAuth(auth: StoredAuth): void {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
}

export function clearStoredAuth(): void {
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

/** Crea la cuenta — devuelve mensaje de verificación, NO devuelve JWT. */
export async function registerUser(
  email: string,
  password: string,
  rolId: number,
  nombre?: string,
  aceptoTerminos = false,
): Promise<RegisterResponse> {
  const trimmedNombre = nombre?.trim();
  const body: Record<string, string | number | boolean> = {
    email: normalizeEmail(email),
    password,
    rol_id: rolId,
    acepto_terminos: aceptoTerminos,
  };
  if (trimmedNombre) {
    body.nombre = trimmedNombre.slice(0, NOMBRE_MAX_LENGTH);
  }

  const res = await apiFetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    await parseApiError(res, "No se pudo crear la cuenta");
  }

  return normalizeRegisterResponse(await res.json());
}

export async function loginUser(email: string, password: string): Promise<AuthResponse> {
  const res = await apiFetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: normalizeEmail(email), password }),
  });

  if (!res.ok) {
    const fallback =
      res.status === 403
        ? "Debes verificar tu correo electrónico antes de iniciar sesión"
        : res.status === 401
          ? "Email o contraseña incorrectos"
          : "No se pudo iniciar sesión";
    await parseApiError(res, fallback);
  }

  const data = (await res.json()) as AuthResponse;
  data.user = normalizeAuthUser(data.user);
  assertActiveSession(data.user);
  return data;
}

/**
 * Valida el JWT (credential / id_token) de Google Sign-In en el backend
 * y devuelve la sesión de la app (mismo shape que login/verify-email).
 */
export async function loginWithGoogle(credential: string): Promise<AuthResponse> {
  const res = await apiFetch("/api/auth/google", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credential }),
  });

  if (!res.ok) {
    const fallback =
      res.status === 401 || res.status === 403
        ? "No se pudo validar la cuenta de Google"
        : "No se pudo iniciar sesión con Google";
    await parseApiError(res, fallback);
  }

  const data = (await res.json()) as AuthResponse;
  data.user = normalizeAuthUser(data.user);
  assertActiveSession(data.user);
  return data;
}

/** Alias explícito: envía el token JWT de Google al backend. */
export const loginConBackend = loginWithGoogle;

/** Verifica el email con el token del link y devuelve el JWT. */
export async function verifyEmailToken(token: string): Promise<AuthResponse> {
  const res = await apiFetch("/api/auth/verify-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: token.trim() }),
  });

  if (!res.ok) {
    await parseApiError(res, "El enlace de verificación es inválido o expiró");
  }

  const data = (await res.json()) as AuthResponse;
  data.user = normalizeAuthUser(data.user);
  assertActiveSession(data.user);
  return data;
}

export async function fetchCurrentUser(token: string): Promise<AuthUser> {
  const res = await apiFetch("/api/auth/me", {}, { token });

  if (!res.ok) {
    await parseApiError(res, "Sesión inválida");
  }

  const user = normalizeAuthUser(await res.json());
  assertActiveSession(user);
  return user;
}

export interface AuthMessageResponse {
  message: string;
}

/** Solicita enlace de recuperación — respuesta genérica por seguridad. */
export async function requestPasswordReset(email: string): Promise<AuthMessageResponse> {
  const res = await apiFetch("/api/auth/forgot-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: normalizeEmail(email) }),
  });

  if (!res.ok) {
    await parseApiError(res, "No se pudo enviar la solicitud");
  }

  return res.json();
}

/** Restablece contraseña con el token del correo (sin JWT). */
export async function resetPasswordWithToken(
  token: string,
  newPassword: string,
): Promise<AuthMessageResponse> {
  const res = await apiFetch("/api/auth/reset-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: token.trim(), new_password: newPassword }),
  });

  if (!res.ok) {
    await parseApiError(res, "Error al restablecer la contraseña");
  }

  return res.json();
}
