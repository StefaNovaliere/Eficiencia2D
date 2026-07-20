"use client";

import { useCallback, useEffect, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { useSettings } from "@/context/SettingsContext";
import {
  type ModelColorChannel,
  type ModelColorOverrides,
  useTheme,
} from "@/context/ThemeContext";
import {
  coloresModeloFromOverrides,
  parseColoresModeloFromSettings,
} from "@/services/settings";

/** Colores del modelo con persistencia en cuenta (settings) + localStorage para invitados. */
export function usePersistedModelColors() {
  const { token, isLoadingAuth } = useAuth();
  const { settings, updateSettings, isLoadingSettings } = useSettings();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const {
    modelColors,
    setModelColor: setLocalModelColor,
    resetModelColors: resetLocalModelColors,
    hydrateModelColors,
  } = useTheme();

  const modelColorsRef = useRef(modelColors);
  modelColorsRef.current = modelColors;

  useEffect(() => {
    if (isLoadingAuth || isLoadingSettings) return;
    if (!token || !settings?.preferencias_interfaz) return;

    const prefs = settings.preferencias_interfaz;
    if (!("colores_modelo" in prefs)) return;

    const parsed = parseColoresModeloFromSettings(prefs.colores_modelo);
    if (parsed) hydrateModelColors(parsed);
  }, [
    token,
    settings?.preferencias_interfaz,
    isLoadingAuth,
    isLoadingSettings,
    hydrateModelColors,
  ]);

  const persistModelColors = useCallback(
    async (colors: ModelColorOverrides) => {
      if (!token) return;
      try {
        await updateSettings({
          preferencias_interfaz: {
            ...(settingsRef.current?.preferencias_interfaz ?? {}),
            colores_modelo: coloresModeloFromOverrides(colors),
          },
        });
      } catch {
        /* localStorage ya guardó el fallback en este dispositivo */
      }
    },
    [token, updateSettings],
  );

  const setModelColor = useCallback(
    (kind: ModelColorChannel, hex: string | null) => {
      const next = { ...modelColorsRef.current, [kind]: hex };
      setLocalModelColor(kind, hex);
      void persistModelColors(next);
    },
    [setLocalModelColor, persistModelColors],
  );

  const resetModelColors = useCallback(() => {
    const cleared = { wall: null, floor: null, background: null };
    resetLocalModelColors();
    void persistModelColors(cleared);
  }, [resetLocalModelColors, persistModelColors]);

  return {
    modelColors,
    setModelColor,
    resetModelColors,
  };
}
