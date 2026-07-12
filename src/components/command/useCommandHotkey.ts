"use client";

import { useEffect } from "react";
import { useUIStore } from "@/stores/uiStore";

/**
 * Listener global ÚNICO para ⌘K / Ctrl+K (abre/cierra la palette) y Esc (cierra).
 * ⌘K funciona incluso dentro de inputs; el resto de atajos no se tocan acá.
 */
export function useCommandHotkey(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        useUIStore.getState().togglePalette();
        return;
      }
      if (e.key === "Escape" && useUIStore.getState().paletteOpen) {
        e.preventDefault();
        useUIStore.getState().closePalette();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
