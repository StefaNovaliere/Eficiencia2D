"use client";

import Link from "next/link";
import { useState } from "react";
import { Bell, Check, Keyboard, Loader2, Palette } from "lucide-react";
import UserAccountSection from "@/components/UserAccountSection";
import UserProjectsSection from "@/components/UserProjectsSection";
import { useAuth } from "@/context/AuthContext";
import { useSettings } from "@/context/SettingsContext";
import { THEMES, useTheme, type ThemeId } from "@/context/ThemeContext";
import { parseTemaColorToThemeId, themeIdToTemaColor } from "@/services/settings";

export default function UserSettingsForm() {
  const { isAuthenticated } = useAuth();
  const {
    settings,
    isLoadingSettings,
    settingsError,
    settingsUnavailable,
    updateSettings,
    clearSettingsError,
  } = useSettings();
  const { theme, setTheme } = useTheme();
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  const activeThemeId =
    isAuthenticated && settings
      ? parseTemaColorToThemeId(settings.tema_color)
      : theme;

  async function handleThemeChange(next: ThemeId) {
    if (activeThemeId === next) return;

    setTheme(next);
    setSaveError(null);
    setSaveNotice(null);
    clearSettingsError();

    if (!isAuthenticated) {
      setSaveNotice("Tema aplicado en este dispositivo.");
      return;
    }

    setIsSaving(true);

    try {
      await updateSettings({ tema_color: themeIdToTemaColor(next) });
      setSaveNotice("Tema guardado en tu cuenta.");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "No se pudo guardar el tema");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleEmailNotificationsChange(checked: boolean) {
    if (!settings || settings.notificaciones_email === checked) return;

    setIsSaving(true);
    setSaveError(null);
    setSaveNotice(null);
    clearSettingsError();

    try {
      await updateSettings({ notificaciones_email: checked });
      setSaveNotice("Preferencia de notificaciones guardada.");
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "No se pudo guardar las notificaciones",
      );
    } finally {
      setIsSaving(false);
    }
  }

  const showAccountLoading = isAuthenticated && isLoadingSettings;
  const displayError = saveError || (settingsUnavailable ? null : settingsError);

  return (
    <div className="space-y-6">
      {isAuthenticated && <UserAccountSection />}
      {isAuthenticated && <UserProjectsSection />}

      {isAuthenticated && settingsUnavailable && settingsError && (
        <div className="alert alert-warning rounded-xl text-sm">
          <span>
            {settingsError} Podés cambiar el tema acá; se guardará en el servidor cuando
            el endpoint esté disponible.
          </span>
        </div>
      )}

      <section className="space-y-3">
        <div className="flex items-start gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10 text-primary shrink-0">
            <Keyboard size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-base-content">Atajos de teclado</h2>
            <p className="text-xs text-base-content/55 mt-1">
              Consultá las combinaciones de teclas del visor 3D y la pantalla de revisión.
            </p>
          </div>
          <Link
            href="/settings/shortcuts"
            className="btn btn-outline btn-sm rounded-xl border-base-300 gap-2 shrink-0"
          >
            <Keyboard size={16} />
            Ver atajos
          </Link>
        </div>
      </section>

      <section className="space-y-3 pt-2 border-t border-base-300/40">
        <div className="flex items-start gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10 text-primary shrink-0">
            <Palette size={18} />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-base-content">Tema</h2>
            <p className="text-xs text-base-content/55 mt-1">
              {isAuthenticated
                ? "Elegí el estilo visual. Se guarda en tu cuenta."
                : "Elegí el estilo visual. Se aplica solo en este dispositivo."}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {THEMES.map((item) => {
            const active = activeThemeId === item.id;
            return (
              <button
                key={item.id}
                type="button"
                disabled={isSaving || showAccountLoading}
                onClick={() => handleThemeChange(item.id)}
                className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-colors ${
                  active
                    ? "border-primary/40 bg-primary/5 ring-1 ring-primary/20"
                    : "border-base-300/60 bg-base-100 hover:bg-base-200/40"
                }`}
              >
                <span
                  className="w-5 h-5 rounded-full border border-base-content/15 shrink-0"
                  style={{ backgroundColor: item.swatch }}
                  title={item.label}
                />
                <span className={`flex-1 text-sm ${active ? "font-semibold" : ""}`}>
                  {item.label}
                </span>
                {active && <Check className="h-4 w-4 text-primary shrink-0" />}
              </button>
            );
          })}
        </div>
      </section>

      {isAuthenticated && (
        <>
          {showAccountLoading ? (
            <div className="flex items-center gap-2 text-sm text-base-content/50 py-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Cargando preferencias de cuenta…
            </div>
          ) : settings ? (
            <section className="space-y-3 pt-2 border-t border-base-300/40">
              <div className="flex items-start gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10 text-primary shrink-0">
                  <Bell size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-sm font-semibold text-base-content">
                    Notificaciones por email
                  </h2>
                  <p className="text-xs text-base-content/55 mt-1">
                    Recibí avisos importantes sobre tus proyectos y novedades del servicio.
                  </p>
                </div>
                <input
                  type="checkbox"
                  className="toggle toggle-primary mt-1"
                  checked={settings.notificaciones_email}
                  disabled={isSaving || settingsUnavailable}
                  onChange={(e) => handleEmailNotificationsChange(e.target.checked)}
                  aria-label="Activar notificaciones por email"
                />
              </div>
            </section>
          ) : null}
        </>
      )}

      {!isAuthenticated && (
        <section className="pt-2 border-t border-base-300/40">
          <p className="text-sm text-base-content/60">
            ¿Querés guardar el tema y otras preferencias en tu cuenta?{" "}
            <Link href="/login" className="text-primary font-medium hover:underline">
              Iniciá sesión
            </Link>{" "}
            o{" "}
            <Link href="/register" className="text-primary font-medium hover:underline">
              registrate
            </Link>
            .
          </p>
        </section>
      )}

      {displayError && (
        <div className="alert alert-error rounded-xl">
          <span>{displayError}</span>
        </div>
      )}

      {saveNotice && !displayError && (
        <div className="alert alert-success rounded-xl">
          <span>{saveNotice}</span>
        </div>
      )}

      {isSaving && (
        <p className="text-xs text-base-content/45 flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Guardando…
        </p>
      )}
    </div>
  );
}
