import { apiFetch } from "@/services/api";
import type { ThemeId } from "@/context/ThemeContext";

export interface PreferenciasInterfaz {
  vista_defecto?: string;
  mostrar_grid?: boolean;
  unidades?: string;
  [key: string]: unknown;
}

export interface UserSettings {
  tema_color: string;
  idioma: string;
  notificaciones_email: boolean;
  preferencias_interfaz: PreferenciasInterfaz | null;
}

export type SettingsPatch = Partial<UserSettings>;

export const VALID_THEME_IDS = new Set<string>([
  "neon",
  "light",
  "dark",
  "aqua",
  "valentine",
  "sunset",
  "halloween",
]);

export const DEFAULT_USER_SETTINGS: UserSettings = {
  tema_color: "neon",
  idioma: "es",
  notificaciones_email: true,
  preferencias_interfaz: null,
};

function authHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
}

async function parseApiError(res: Response, fallback: string): Promise<never> {
  if (res.status === 404) {
    throw new Error("El endpoint de configuración no está disponible en el servidor (404).");
  }

  if (res.status === 401) {
    throw new Error("Sesión inválida. Volvé a iniciar sesión.");
  }

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

/** Convierte `tema_color` del backend al ThemeId del visor (incluye valores legacy). */
export function parseTemaColorToThemeId(value: string): ThemeId {
  if (VALID_THEME_IDS.has(value)) {
    return value as ThemeId;
  }

  switch (value) {
    case "oscuro":
      return "dark";
    case "claro":
      return "light";
    case "sistema":
      if (typeof window !== "undefined") {
        return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      }
      return "neon";
    default:
      return "neon";
  }
}

export async function fetchUserSettings(token: string): Promise<UserSettings> {
  const res = await apiFetch("/api/settings/me", {
    method: "GET",
    headers: authHeaders(token),
  });

  if (!res.ok) {
    await parseApiError(res, "No se pudo cargar la configuración");
  }

  return res.json();
}

export async function patchUserSettings(
  token: string,
  patch: SettingsPatch,
): Promise<UserSettings> {
  const res = await apiFetch("/api/settings/me", {
    method: "PATCH",
    headers: {
      ...authHeaders(token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patch),
  });

  if (!res.ok) {
    await parseApiError(res, "No se pudo guardar la configuración");
  }

  return res.json();
}
