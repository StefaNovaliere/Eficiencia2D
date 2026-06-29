"use client";

import { useCallback } from "react";
import { getBaseThemeId, useTheme } from "@/context/ThemeContext";

/** Neón = emblema IdeasHaus. Apagado → vuelve al tema oscuro base (u otro elegido en Configuración). */
export default function NeonThemeSwitch({ className = "" }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const isNeon = theme === "neon";

  const handleChange = useCallback(
    (checked: boolean) => {
      setTheme(checked ? "neon" : getBaseThemeId());
    },
    [setTheme],
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
