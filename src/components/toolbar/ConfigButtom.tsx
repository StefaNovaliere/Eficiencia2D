"use client";

import { ChevronDown, Palette, Settings2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ModelColorWheel from "@/components/ModelColorWheel";

export interface ConfigButtomProps {
  minAreaM2: number;
  onMinAreaChange: (v: number) => void;
  minAreaOptions: number[];
  formatMinAreaOption: (v: number) => string;
  isRecomputing: boolean;
  isGenerating: boolean;
  pinTools: boolean;
  onPinToolsChange: (pin: boolean) => void;
}

export default function ConfigButtom({
  minAreaM2,
  onMinAreaChange,
  minAreaOptions,
  formatMinAreaOption,
  isRecomputing,
  isGenerating,
  pinTools,
  onPinToolsChange,
}: ConfigButtomProps) {
  const [configOpen, setConfigOpen] = useState(false);
  const [colorsOpen, setColorsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!configOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setConfigOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfigOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [configOpen]);

  return (
    <div ref={rootRef} className={`relative shrink-0 ${configOpen ? "z-[80]" : "z-10"}`}>
      <button
        type="button"
        data-tour="toolbar-config"
        className={`inline-flex shrink-0 items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-medium transition-colors select-none ${
          configOpen
            ? "bg-primary/15 text-primary"
            : "text-base-content/65 hover:bg-base-200/70 hover:text-base-content"
        }`}
        aria-label="Configuración"
        aria-expanded={configOpen}
        aria-haspopup="menu"
        onClick={() => setConfigOpen((v) => !v)}
      >
        <Settings2 size={14} />
        <span className="hidden sm:inline">Configuraciones</span>
        <ChevronDown
          size={11}
          className={`opacity-40 transition-transform duration-150 ${configOpen ? "rotate-180" : ""}`}
        />
      </button>

      {configOpen && (
        <div
          data-tour="toolbar-config-menu"
          role="menu"
          className="absolute right-0 top-full mt-1.5 z-[80] w-72 rounded-2xl border border-base-300/60 bg-base-100 p-2 shadow-2xl"
        >
          <div className="pt-0.5">
            <p className="text-[12px] font-semibold text-base-content/40 uppercase tracking-wider px-1 mb-1">
              Descarte automático
            </p>
            <div className="flex items-center gap-2 px-2">
              <span className="text-xs text-base-content/50 shrink-0">Descartar capas &lt;</span>
              <select
                className="select select-bordered select-xs h-8 min-h-8 w-[6.25rem] bg-base-100 font-mono text-[11px] rounded-lg"
                value={minAreaM2}
                disabled={isRecomputing || isGenerating}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => onMinAreaChange(Number(e.target.value))}
              >
                {minAreaOptions.map((a) => (
                  <option key={a} value={a}>{formatMinAreaOption(a)}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="divider my-2" />
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-xl px-1 py-1.5 text-left transition-colors hover:bg-base-200/60"
            aria-expanded={colorsOpen}
            onClick={() => setColorsOpen((v) => !v)}
          >
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
              <Palette size={14} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-semibold text-base-content/70">
                Colores del modelo
              </span>
              <span className="block text-[11px] leading-tight text-base-content/40">
                Color de paredes, pisos y fondo del visor
              </span>
            </span>
            <ChevronDown
              size={13}
              className={`opacity-40 transition-transform duration-150 ${colorsOpen ? "rotate-180" : ""}`}
            />
          </button>
          {colorsOpen && (
            <div className="pb-1 pt-2">
              <ModelColorWheel />
            </div>
          )}

          <div className="divider my-2" />
          <p className="text-[12px] font-semibold text-base-content/40 uppercase tracking-wider px-1 mb-1">
            Personalizar barra de herramientas
          </p>
          <label className="flex items-center gap-2 px-1 py-1.5 cursor-pointer">
            <input
              type="checkbox"
              className="toggle toggle-sm toggle-primary"
              checked={pinTools}
              onChange={(e) => onPinToolsChange(e.target.checked)}
            />
            <span className="text-xs text-base-content/50 shrink-0">Fijar herramientas</span>
          </label>
        </div>
      )}
    </div>
  );
}
