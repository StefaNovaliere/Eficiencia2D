import { apiFetch } from "@/services/api";

export interface AuthUser {
  id: string;
  email: string;
  nombre: string | null;
  estado: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: AuthUser;
}

const AUTH_STORAGE_KEY = "e2d_auth";

export interface StoredAuth {
  token: string;
  user: AuthUser;
}

async function parseApiError(res: Response, fallback: string): Promise<never> {
  const errorData = await res.json().catch(() => null);
  const detail = errorData?.detail;

  if (typeof detail === "string") {
    throw new Error(detail);
  }

  if (Array.isArray(detail) && detail.length > 0) {
    const first = detail[0];
    if (typeof first?.msg === "string") {
      throw new Error(first.msg);
    }
  }

  throw new Error(fallback);
}

export function loadStoredAuth(): StoredAuth | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredAuth;
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

export async function registerUser(
  email: string,
  password: string,
  nombre?: string,
): Promise<AuthResponse> {
  const res = await apiFetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, nombre: nombre || null }),
  });

  if (!res.ok) {
    await parseApiError(res, "No se pudo crear la cuenta");
  }

  return res.json();
}

export async function loginUser(email: string, password: string): Promise<AuthResponse> {
  const res = await apiFetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    await parseApiError(res, "No se pudo iniciar sesión");
  }

  return res.json();
}

export async function fetchCurrentUser(token: string): Promise<AuthUser> {
  const res = await apiFetch("/api/auth/me", {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    await parseApiError(res, "Sesión inválida");
  }

  return res.json();
}
