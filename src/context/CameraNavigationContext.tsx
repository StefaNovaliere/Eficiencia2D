"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/context/AuthContext";
import { useSettings } from "@/context/SettingsContext";
import {
  applyCameraNavigationToControls,
  CAMERA_NAVIGATION_STORAGE_KEY,
  DEFAULT_CAMERA_NAVIGATION_STYLE,
  getStoredCameraNavigationStyle,
  isCameraNavigationStyle,
  type CameraNavigationStyle,
  type OrbitControlsLike,
} from "@/core/camera-navigation";

interface CameraNavigationContextType {
  navigationStyle: CameraNavigationStyle;
  handleChange: (style: CameraNavigationStyle) => Promise<void>;
  applyToControls: (controls: OrbitControlsLike) => void;
  isSaving: boolean;
}

const CameraNavigationContext = createContext<
  CameraNavigationContextType | undefined
>(undefined);

function readStyleFromSettings(
  preferencias: Record<string, unknown> | null | undefined,
): CameraNavigationStyle | null {
  const raw = preferencias?.navegacion_camara;
  return isCameraNavigationStyle(raw) ? raw : null;
}

export function CameraNavigationProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const { settings, updateSettings } = useSettings();
  const [navigationStyle, setNavigationStyle] = useState<CameraNavigationStyle>(
    DEFAULT_CAMERA_NAVIGATION_STYLE,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Hidratar desde localStorage (invitados) o preferencias de cuenta.
  useEffect(() => {
    const fromAccount = readStyleFromSettings(
      settings?.preferencias_interfaz as Record<string, unknown> | null | undefined,
    );
    setNavigationStyle(fromAccount ?? getStoredCameraNavigationStyle());
    setHydrated(true);
  }, [settings?.preferencias_interfaz]);

  const applyToControls = useCallback(
    (controls: OrbitControlsLike) => {
      applyCameraNavigationToControls(controls, navigationStyle);
    },
    [navigationStyle],
  );

  const handleChange = useCallback(
    async (style: CameraNavigationStyle) => {
      if (style === navigationStyle) return;

      setNavigationStyle(style);

      try {
        localStorage.setItem(CAMERA_NAVIGATION_STORAGE_KEY, style);
      } catch {
        /* quota / private mode */
      }

      // TODO: Guardar preferencia en Supabase
      // UPDATE configuraciones_usuario
      // SET preferencias_interfaz = jsonb_set(
      //   COALESCE(preferencias_interfaz, '{}'::jsonb),
      //   '{navegacion_camara}',
      //   to_jsonb(:style::text),
      //   true
      // )
      // WHERE user_id = auth.uid();
      //
      // En el cliente (REST /api/settings/me):
      // await updateSettings({
      //   preferencias_interfaz: {
      //     ...settings?.preferencias_interfaz,
      //     navegacion_camara: style,
      //   },
      // });

      if (!isAuthenticated) return;

      setIsSaving(true);
      try {
        await updateSettings({
          preferencias_interfaz: {
            ...(settings?.preferencias_interfaz ?? {}),
            navegacion_camara: style,
          },
        });
      } catch {
        // localStorage ya guardó el fallback para este dispositivo
      } finally {
        setIsSaving(false);
      }
    },
    [navigationStyle, isAuthenticated, settings?.preferencias_interfaz, updateSettings],
  );

  const value = useMemo(
    () => ({
      navigationStyle: hydrated ? navigationStyle : DEFAULT_CAMERA_NAVIGATION_STYLE,
      handleChange,
      applyToControls,
      isSaving,
    }),
    [hydrated, navigationStyle, handleChange, applyToControls, isSaving],
  );

  return (
    <CameraNavigationContext.Provider value={value}>
      {children}
    </CameraNavigationContext.Provider>
  );
}

export function useCameraNavigation() {
  const ctx = useContext(CameraNavigationContext);
  if (!ctx) {
    throw new Error(
      "useCameraNavigation debe usarse dentro de CameraNavigationProvider",
    );
  }
  return ctx;
}
