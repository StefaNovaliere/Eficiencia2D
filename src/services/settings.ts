import { apiFetch } from "@/services/api";
import { parseApiError } from "@/services/api-errors";
import type { ThemeId } from "@/context/ThemeContext";

/** Valores canónicos de `tema_color` en el backend. */
export const BACKEND_TEMA_OSCURO = "oscuro";
export const BACKEND_TEMA_CLARO = "claro";
export const BACKEND_TEMA_SISTEMA = "sistema";

export interface AtajosPreferencias {
  guardar?: string;
  [key: string]: string | undefined;
}

export interface PreferenciasInterfaz {
  atajos?: AtajosPreferencias;
  vista_defecto?: string;
  mostrar_grid?: boolean;
  unidades?: string;
  /** Preset de navegación 3D: blender | cad | touchpad | tinkercad | revit */
  navegacion_camara?: string;
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
  tema_color: BACKEND_TEMA_OSCURO,
  idioma: "es",
  notificaciones_email: true,
  preferencias_interfaz: null,
};

async function parseSettingsError(res: Response, fallback: string): Promise<never> {
  if (res.status === 404) {
    throw new Error("El endpoint de configuración no está disponible en el servidor (404).");
  }

  if (res.status === 401) {
    throw new Error("Sesión inválida. Volvé a iniciar sesión.");
  }

  return parseApiError(res, fallback);
}

/** Solo campos presentes — el backend espera PATCH parcial. */
function compactSettingsPatch(patch: SettingsPatch): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  );
}

/** Convierte `tema_color` del backend al ThemeId del visor. */
export function parseTemaColorToThemeId(value: string): ThemeId {
  if (VALID_THEME_IDS.has(value)) {
    return value as ThemeId;
  }

  switch (value) {
    case BACKEND_TEMA_OSCURO:
      return "dark";
    case BACKEND_TEMA_CLARO:
      return "light";
    case BACKEND_TEMA_SISTEMA:
      if (typeof window !== "undefined") {
        return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      }
      return "neon";
    default:
      return "neon";
  }
}

/** Convierte ThemeId del visor al `tema_color` que persiste el backend. */
export function themeIdToTemaColor(themeId: ThemeId): string {
  switch (themeId) {
    case "light":
      return BACKEND_TEMA_CLARO;
    case "dark":
      return BACKEND_TEMA_OSCURO;
    default:
      return themeId;
  }
}

export async function fetchUserSettings(token: string): Promise<UserSettings> {
  const res = await apiFetch("/api/settings/me", { method: "GET" }, { token });

  if (!res.ok) {
    await parseSettingsError(res, "No se pudo cargar la configuración");
  }

  return res.json();
}

export async function patchUserSettings(
  token: string,
  patch: SettingsPatch,
): Promise<UserSettings> {
  const body = compactSettingsPatch(patch);
  if (Object.keys(body).length === 0) {
    throw new Error("No hay cambios para guardar");
  }

  const res = await apiFetch(
    "/api/settings/me",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    { token },
  );

  if (!res.ok) {
    await parseSettingsError(res, "No se pudo guardar la configuración");
  }

  return res.json();
}

/** Actualiza solo `preferencias_interfaz` (merge superficial en el cliente tras respuesta). */
export async function patchPreferenciasInterfaz(
  token: string,
  preferencias: PreferenciasInterfaz,
): Promise<UserSettings> {
  return patchUserSettings(token, { preferencias_interfaz: preferencias });
}
