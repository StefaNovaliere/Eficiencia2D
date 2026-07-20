"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/context/AuthContext";
import {
  DEFAULT_USER_SETTINGS,
  fetchUserSettings,
  parseTemaColorToThemeId,
  patchUserSettings,
  themeIdToTemaColor,
  type SettingsPatch,
  type UserSettings,
} from "@/services/settings";
import { getStoredThemeId, useTheme } from "@/context/ThemeContext";

interface SettingsContextType {
  settings: UserSettings | null;
  isLoadingSettings: boolean;
  settingsError: string | null;
  settingsUnavailable: boolean;
  updateSettings: (patch: SettingsPatch) => Promise<UserSettings>;
  clearSettingsError: () => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { token, isLoadingAuth } = useAuth();
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [isLoadingSettings, setIsLoadingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsUnavailable, setSettingsUnavailable] = useState(false);

  useEffect(() => {
    if (isLoadingAuth) return;

    if (!token) {
      setSettings(null);
      setSettingsError(null);
      setSettingsUnavailable(false);
      return;
    }

    let cancelled = false;
    setIsLoadingSettings(true);
    setSettingsError(null);
    setSettingsUnavailable(false);

    fetchUserSettings(token)
      .then((data) => {
        if (!cancelled) setSettings(data);
      })
      .catch((err) => {
        if (cancelled) return;

        const message =
          err instanceof Error ? err.message : "No se pudo cargar la configuración";
        const unavailable = message.includes("404");

        setSettings({
          ...DEFAULT_USER_SETTINGS,
          tema_color: themeIdToTemaColor(getStoredThemeId()),
        });
        setSettingsError(message);
        setSettingsUnavailable(unavailable);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingSettings(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, isLoadingAuth]);

  const updateSettings = useCallback(
    async (patch: SettingsPatch) => {
      if (!token) {
        throw new Error("Tenés que iniciar sesión para guardar la configuración");
      }

      setSettingsError(null);

      if (settingsUnavailable) {
        const merged = { ...(settings ?? DEFAULT_USER_SETTINGS), ...patch };
        setSettings(merged);
        return merged;
      }

      const updated = await patchUserSettings(token, patch);
      setSettings(updated);
      return updated;
    },
    [token, settingsUnavailable, settings],
  );

  const clearSettingsError = useCallback(() => {
    setSettingsError(null);
  }, []);

  return (
    <SettingsContext.Provider
      value={{
        settings,
        isLoadingSettings,
        settingsError,
        settingsUnavailable,
        updateSettings,
        clearSettingsError,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

/** Aplica tema: prioriza localStorage (elección en este navegador) para no pisar Neón al recargar. */
export function SettingsThemeSync() {
  const { settings, isLoadingSettings } = useSettings();
  const { isLoadingAuth } = useAuth();
  const { setTheme } = useTheme();

  useEffect(() => {
    if (isLoadingAuth || isLoadingSettings) return;

    if (!settings) {
      setTheme(getStoredThemeId());
      return;
    }

    // Si el usuario ya eligió un tema en esta máquina (p. ej. Neón), respetarlo.
    // El form de Configuración y el switch Neón escriben localStorage + backend.
    try {
      const saved = localStorage.getItem("theme");
      if (saved === "neon" || saved === "light" || saved === "dark" || saved === "aqua" || saved === "valentine" || saved === "sunset" || saved === "halloween") {
        setTheme(saved);
        return;
      }
    } catch {
      /* ignore */
    }

    setTheme(parseTemaColorToThemeId(settings.tema_color));
  }, [settings, isLoadingAuth, isLoadingSettings, setTheme]);

  return null;
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettings debe usarse dentro de SettingsProvider");
  }
  return context;
}
