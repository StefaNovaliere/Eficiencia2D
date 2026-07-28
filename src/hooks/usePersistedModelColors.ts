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

/**
 * Espera de inactividad antes de mandar los colores al backend. Arrastrar la
 * rueda emite un color por cada `pointermove` (~60-120 por segundo): sin este
 * colchón cada gesto disparaba decenas de PATCH y el visor se trababa.
 */
const PERSIST_DEBOUNCE_MS = 600;

/** Colores del modelo con persistencia en cuenta (settings) + localStorage para invitados. */
export function usePersistedModelColors() {
  const { token, isLoadingAuth } = useAuth();
  const { settings, updateSettings, isLoadingSettings } = useSettings();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const updateSettingsRef = useRef(updateSettings);
  updateSettingsRef.current = updateSettings;

  const {
    modelColors,
    setModelColor: setLocalModelColor,
    resetModelColors: resetLocalModelColors,
    hydrateModelColors,
  } = useTheme();

  const modelColorsRef = useRef(modelColors);
  modelColorsRef.current = modelColors;

  /**
   * Los colores de la cuenta se cargan UNA sola vez por token. Rehidratar con
   * cada respuesta del backend hacía que la respuesta de un PATCH del arrastre
   * volviera tarde y pisara la manija en pleno movimiento (las respuestas no
   * llegan necesariamente en orden): se veía como saltos erráticos.
   */
  const hydratedTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (isLoadingAuth || isLoadingSettings) return;

    if (!token) {
      hydratedTokenRef.current = null;
      return;
    }
    if (hydratedTokenRef.current === token) return;
    if (!settings?.preferencias_interfaz) return;

    const prefs = settings.preferencias_interfaz;
    if (!("colores_modelo" in prefs)) return;

    hydratedTokenRef.current = token;
    const parsed = parseColoresModeloFromSettings(prefs.colores_modelo);
    if (parsed) hydrateModelColors(parsed);
  }, [
    token,
    settings?.preferencias_interfaz,
    isLoadingAuth,
    isLoadingSettings,
    hydrateModelColors,
  ]);

  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<ModelColorOverrides | null>(null);

  /** Manda el último color pendiente (si hay) y cancela el temporizador. */
  const flushPersist = useCallback(() => {
    if (persistTimerRef.current !== null) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    const colors = pendingRef.current;
    pendingRef.current = null;
    if (!colors || !tokenRef.current) return;

    void updateSettingsRef
      .current({
        preferencias_interfaz: {
          ...(settingsRef.current?.preferencias_interfaz ?? {}),
          colores_modelo: coloresModeloFromOverrides(colors),
        },
      })
      .catch(() => {
        /* localStorage ya guardó el fallback en este dispositivo */
      });
  }, []);

  /** Agenda el guardado en cuenta: del gesto entero viaja sólo el color final. */
  const schedulePersist = useCallback(
    (colors: ModelColorOverrides) => {
      if (!tokenRef.current) return;
      pendingRef.current = colors;
      if (persistTimerRef.current !== null) clearTimeout(persistTimerRef.current);
      persistTimerRef.current = setTimeout(flushPersist, PERSIST_DEBOUNCE_MS);
    },
    [flushPersist],
  );

  // Al desmontar (cerrar el panel) no se pierde el último cambio del gesto.
  useEffect(() => () => flushPersist(), [flushPersist]);

  const setModelColor = useCallback(
    (kind: ModelColorChannel, hex: string | null) => {
      const next = { ...modelColorsRef.current, [kind]: hex };
      modelColorsRef.current = next;
      setLocalModelColor(kind, hex);
      schedulePersist(next);
    },
    [setLocalModelColor, schedulePersist],
  );

  const resetModelColors = useCallback(() => {
    const cleared = { wall: null, floor: null, background: null };
    modelColorsRef.current = cleared;
    resetLocalModelColors();
    schedulePersist(cleared);
    flushPersist(); // acción puntual: no tiene sentido esperar el debounce
  }, [resetLocalModelColors, schedulePersist, flushPersist]);

  return {
    modelColors,
    setModelColor,
    resetModelColors,
  };
}
