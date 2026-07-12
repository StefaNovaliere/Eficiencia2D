"use client";

import { Search } from "lucide-react";
import { useUIStore } from "@/stores/uiStore";

/**
 * Entrada VISIBLE al Command Palette. Su razón de ser es que el usuario encuentre
 * rápido lo que necesita — no puede estar escondido detrás de ⌘K. Pill fijo,
 * siempre presente en el flujo; ⌘K queda como acelerador.
 */
export default function CommandBar() {
  const openPalette = useUIStore((s) => s.openPalette);
  const isMac =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <button
      type="button"
      onClick={openPalette}
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 inline-flex items-center gap-2 rounded-full border border-base-300/60 bg-base-100/90 backdrop-blur-md shadow-lg px-4 py-2 text-sm text-base-content/60 hover:text-base-content hover:border-primary/40 transition-colors"
      aria-label="Buscar herramienta o acción"
      title="Buscar herramienta o acción"
    >
      <Search size={15} className="text-primary/70" />
      <span className="hidden sm:inline">Buscar herramienta o acción…</span>
      <span className="sm:hidden">Buscar…</span>
      <kbd className="kbd kbd-xs ml-1">{isMac ? "⌘" : "Ctrl"} K</kbd>
    </button>
  );
}
