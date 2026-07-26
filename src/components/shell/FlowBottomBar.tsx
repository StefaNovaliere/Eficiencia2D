"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { ArrowLeft, ArrowRight, BookOpen, ChevronUp, Search } from "lucide-react";
import { useUIStore } from "@/stores/uiStore";
import CameraNavigationSelect from "@/components/CameraNavigationSelect";

/** Alto de la barra; se publica como CSS var para que el contenido lo compense. */
const BAR_H = "3.5rem";

/**
 * Barra de navegación del flujo.
 *
 * - Atrás / Continuar: en todo el flujo (review, nesting, payment).
 * - Navegación de cámara, buscador e instructivo: sólo en /review, donde el
 *   modelo es editable y están las herramientas.
 * - Oculta por completo con el instructivo de armado abierto.
 */
export default function FlowBottomBar() {
  const pathname = usePathname() ?? "";
  const isEditablePreview = pathname.startsWith("/review");

  const nav = useUIStore((s) => s.flowNav);
  const openPalette = useUIStore((s) => s.openPalette);
  const collapsed = useUIStore((s) => s.flowBarCollapsed);
  const toggleFlowBar = useUIStore((s) => s.toggleFlowBar);
  const instructivoOpen = useUIStore((s) => s.instructivoOpen);
  const isMac =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

  const hidden = instructivoOpen || collapsed;

  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty("--flow-bar-h", hidden ? "0rem" : BAR_H);
    return () => root.setProperty("--flow-bar-h", BAR_H);
  }, [hidden]);

  if (instructivoOpen) return null;

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={toggleFlowBar}
        aria-label="Mostrar barra de navegación"
        title="Mostrar barra"
        className="fixed bottom-0 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1.5 rounded-t-xl border border-b-0 border-base-300/50 bg-base-100/95 px-3 py-1 text-xs text-base-content/60 shadow-lg backdrop-blur-md transition-colors hover:text-base-content"
      >
        <ChevronUp size={13} />
        <span className="hidden sm:inline">Mostrar barra</span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 h-14 border-t border-base-300/50 bg-base-100/95 backdrop-blur-md e2d-cyber-panel flex items-center justify-between gap-3 px-3 sm:px-4">
      <button
        type="button"
        onClick={toggleFlowBar}
        aria-label="Ocultar barra de navegación"
        title="Ocultar barra"
        className="absolute -top-6 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-t-lg border border-b-0 border-base-300/50 bg-base-100/95 px-2.5 py-1 text-[11px] text-base-content/50 shadow-sm backdrop-blur-md transition-colors hover:text-base-content"
      >
        <ChevronUp size={12} className="rotate-180" />
      </button>

      <div className="flex-1 flex gap-10 justify-start min-w-0">
        {nav.onBack && (
          <button
            type="button"
            onClick={nav.onBack}
            disabled={nav.nextBusy || nav.backBusy}
            className="btn btn-ghost btn-sm rounded-xl gap-1.5 border border-base-300/40"
          >
            {nav.backBusy ? (
              <>
                <span className="loading loading-spinner loading-xs" />
                <span className="hidden sm:inline">Guardando…</span>
              </>
            ) : (
              <>
                <ArrowLeft size={15} />
                <span className="hidden sm:inline">{nav.backLabel ?? "Atrás"}</span>
              </>
            )}
          </button>
        )}
        {isEditablePreview && (
          <CameraNavigationSelect variant="toolbar-bottom" className="hidden sm:flex" />
        )}
      </div>

      <div className="flex items-center gap-2 min-w-0">
        {isEditablePreview && (
          <button
            type="button"
            onClick={openPalette}
            data-tour="command-search"
            className="inline-flex items-center gap-2 rounded-full border border-base-300/60 bg-base-200/50 hover:border-primary/40 px-3.5 py-1.5 text-sm text-base-content/60 hover:text-base-content transition-colors"
            aria-label="Buscar herramienta o acción"
          >
            <Search size={14} className="text-primary/70" />
            <span className="hidden sm:inline">Buscar herramienta o acción…</span>
            <span className="sm:hidden">Buscar…</span>
            <kbd className="kbd kbd-xs ml-0.5">{isMac ? "⌘" : "Ctrl"} K</kbd>
          </button>
        )}
      </div>

      <div className="flex-1 flex justify-end items-center gap-2 min-w-0">
        {isEditablePreview && nav.onInstructivo && (
          <button
            type="button"
            onClick={nav.onInstructivo}
            className="btn btn-ghost btn-sm rounded-xl gap-1.5 border border-base-300/40"
            title="Ver instructivo de armado"
          >
            <BookOpen size={15} />
            <span className="hidden sm:inline">Instructivo</span>
          </button>
        )}
        {nav.onNext && (
          <button
            type="button"
            onClick={nav.onNext}
            data-tour="flow-next"
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
