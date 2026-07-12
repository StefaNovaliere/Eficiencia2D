"use client";

import { ArrowLeft, ArrowRight, Search } from "lucide-react";
import { useUIStore } from "@/stores/uiStore";

/**
 * Barra de navegación CONSTANTE del flujo. Atrás (izquierda) y Continuar
 * (derecha) quedan SIEMPRE en la misma posición en todos los pasos; sólo cambian
 * label/handler que registra la página (`useRegisterFlowNav`). En el centro, la
 * entrada VISIBLE al Command Palette. Posición fija abajo (h-14).
 */
export default function FlowBottomBar() {
  const nav = useUIStore((s) => s.flowNav);
  const openPalette = useUIStore((s) => s.openPalette);
  const isMac =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 h-14 border-t border-base-300/50 bg-base-100/95 backdrop-blur-md flex items-center justify-between gap-3 px-3 sm:px-4">
      {/* Izquierda: Atrás (posición fija) */}
      <div className="flex-1 flex justify-start min-w-0">
        {nav.onBack && (
          <button
            type="button"
            onClick={nav.onBack}
            disabled={nav.nextBusy}
            className="btn btn-ghost btn-sm rounded-xl gap-1.5 border border-base-300/40"
          >
            <ArrowLeft size={15} />
            <span className="hidden sm:inline">{nav.backLabel ?? "Atrás"}</span>
          </button>
        )}
      </div>

      {/* Centro: entrada visible al palette + hint contextual */}
      <div className="flex items-center gap-2 min-w-0">
        {nav.hint && (
          <span className="hidden md:inline text-[11px] text-warning/80 truncate max-w-[16rem]">
            {nav.hint}
          </span>
        )}
        <button
          type="button"
          onClick={openPalette}
          className="inline-flex items-center gap-2 rounded-full border border-base-300/60 bg-base-200/50 hover:border-primary/40 px-3.5 py-1.5 text-sm text-base-content/60 hover:text-base-content transition-colors"
          aria-label="Buscar herramienta o acción"
        >
          <Search size={14} className="text-primary/70" />
          <span className="hidden sm:inline">Buscar herramienta o acción…</span>
          <span className="sm:hidden">Buscar…</span>
          <kbd className="kbd kbd-xs ml-0.5">{isMac ? "⌘" : "Ctrl"} K</kbd>
        </button>
      </div>

      {/* Derecha: Continuar / Exportar (posición fija) */}
      <div className="flex-1 flex justify-end min-w-0">
        {nav.onNext && (
          <button
            type="button"
            onClick={nav.onNext}
            disabled={nav.canNext === false || nav.nextBusy}
            className="btn btn-primary btn-sm rounded-xl gap-1.5 shadow-md shadow-primary/20"
          >
            {nav.nextBusy ? (
              <>
                <span className="loading loading-spinner loading-xs" />
                <span className="hidden sm:inline">Generando…</span>
              </>
            ) : (
              <>
                <span className="hidden sm:inline">{nav.nextLabel ?? "Continuar"}</span>
                <span className="sm:hidden">{nav.nextLabel ?? "Continuar"}</span>
                <ArrowRight size={15} />
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
