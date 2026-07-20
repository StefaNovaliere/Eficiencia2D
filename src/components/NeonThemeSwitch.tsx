"use client";

import { useCallback } from "react";
import { getBaseThemeId, useTheme } from "@/context/ThemeContext";
import { useSettings } from "@/context/SettingsContext";
import { themeIdToTemaColor } from "@/services/settings";

/** Neón = emblema IdeasHaus. Apagado → vuelve al tema oscuro base (u otro elegido en Configuración). */
export default function NeonThemeSwitch({ className = "" }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const { updateSettings, settings } = useSettings();
  const isNeon = theme === "neon";

  const handleChange = useCallback(
    (checked: boolean) => {
      const next = checked ? "neon" : getBaseThemeId();
      setTheme(next);
      // Persistir para que SettingsThemeSync / F5 no vuelvan a "oscuro".
      if (settings) {
        void updateSettings({ tema_color: themeIdToTemaColor(next) }).catch(() => {
          /* el tema local ya quedó aplicado */
        });
      }
    },
    [setTheme, updateSettings, settings],
  );

  return (
    <label
      className={`e2d-neon-switch flex items-center gap-2 cursor-pointer select-none shrink-0 ${className}`}
      title={isNeon ? "Desactivar emblema Neón IdeasHaus" : "Activar emblema Neón IdeasHaus"}
    >
      <span className="text-xs font-medium text-base-content/75">Neón</span>
      <input
        type="checkbox"
        className="toggle toggle-sm toggle-primary e2d-neon-switch-input"
        checked={isNeon}
        onChange={(e) => handleChange(e.target.checked)}
        aria-label="Tema Neón IdeasHaus"
      />
    </label>
  );
}
