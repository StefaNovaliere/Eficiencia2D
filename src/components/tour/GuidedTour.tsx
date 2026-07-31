"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight } from "lucide-react";
import {
  computeTooltipPosition,
  resolveTourSteps,
  tourTargetSelector,
  unionRects,
  type Rect,
  type TourStep,
} from "@/core/guided-tour";

const CARD_W = 300;
const CARD_H = 170;
const SPOT_PAD = 6;

function toRect(r: DOMRect): Rect {
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height
  );
}

/** Caja inflada por el margen del spotlight, en coordenadas de viewport. */
function padded(r: Rect) {
  return {
    left: r.left - SPOT_PAD,
    top: r.top - SPOT_PAD,
    width: r.width + SPOT_PAD * 2,
    height: r.height + SPOT_PAD * 2,
  };
}

export interface GuidedTourProps {
  steps: TourStep[];
  /** `completed` true si llegó al final; false si lo saltó/cerró. */
  onClose: (completed: boolean) => void;
}

/**
 * Overlay de tour guiado (coach marks): oscurece la pantalla, recorta un
 * spotlight sobre el ancla del paso (`data-tour`) y muestra una tarjeta con la
 * explicación y navegación Anterior/Siguiente. Portal al <body> para quedar por
 * encima de cualquier stacking context (sidebar, barra inferior, modales).
 *
 * El oscurecido es sólo visual (`pointer-events-none`): la app sigue siendo
 * usable durante el tour para poder probar lo que cada paso explica (orbitar el
 * visor, abrir capas, seleccionar componentes…). El tour no se cierra por
 * interactuar: sólo con «Salir del tour» o «Terminar».
 */
export default function GuidedTour({ steps, onClose }: GuidedTourProps) {
  // Anclas ausentes (p.ej. sidebar plegado) se saltan al iniciar.
  const activeSteps = useMemo(
    () => (typeof document === "undefined" ? steps : resolveTourSteps(steps, document)),
    [steps],
  );
  const [index, setIndex] = useState(0);
  /**
   * `anchor` es lo que lleva el aro (el elemento exacto del paso); `box` suma
   * los acompañantes abiertos y define qué queda iluminado y dónde NO puede ir
   * la tarjeta. Separarlos evita que un panel abierto disuelva el resaltado.
   */
  const [spot, setSpot] = useState<{ anchor: Rect | null; box: Rect | null }>({
    anchor: null,
    box: null,
  });
  const rafRef = useRef(0);

  const step = activeSteps[index] ?? null;
  const total = activeSteps.length;

  // Seguir a los elementos en vivo (scroll, resize, layout async del canvas).
  useEffect(() => {
    if (!step) return;
    const companions = step.companions ?? [];
    const measure = () => {
      const anchorEl = document.querySelector(tourTargetSelector(step.target));
      const anchor = anchorEl ? toRect(anchorEl.getBoundingClientRect()) : null;
      const rects = anchor ? [anchor] : [];
      for (const c of companions) {
        const el = document.querySelector(tourTargetSelector(c));
        if (el) rects.push(toRect(el.getBoundingClientRect()));
      }
      const box = unionRects(rects);
      setSpot((prev) =>
        sameRect(prev.anchor, anchor) && sameRect(prev.box, box) ? prev : { anchor, box },
      );
      rafRef.current = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(rafRef.current);
  }, [step]);

  const finish = useCallback(
    (completed: boolean) => onClose(completed),
    [onClose],
  );

  const next = useCallback(() => {
    setIndex((i) => {
      if (i + 1 >= total) {
        finish(true);
        return i;
      }
      return i + 1;
    });
  }, [total, finish]);

  const prev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  // Teclado: ←/→ navegan sólo con el foco dentro de la tarjeta, para no pisar
  // los atajos del visor mientras el usuario prueba lo que el paso explica.
  const onCardKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") next();
    else if (e.key === "ArrowLeft") prev();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  if (!step || total === 0) return null;
  if (typeof document === "undefined") return null;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const pos = spot.box
    ? computeTooltipPosition(
        spot.box,
        { width: CARD_W, height: CARD_H },
        { width: vw, height: vh },
        step.placement,
      )
    : { left: vw / 2 - CARD_W / 2, top: vh / 2 - CARD_H / 2, placement: "bottom" as const };

  const isLast = index === total - 1;

  return createPortal(
    <div
      className="fixed inset-0 z-[400] pointer-events-none"
      role="dialog"
      aria-label="Tour guiado"
    >
      {spot.box ? (
        <div
          className="absolute rounded-xl transition-all duration-200 ease-out"
          style={{ ...padded(spot.box), boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)" }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/45" />
      )}

      {/* El aro marca sólo el elemento del paso, aunque el panel que abrió
          quede iluminado alrededor. */}
      {spot.anchor && (
        <div
          className="absolute rounded-xl ring-2 ring-primary shadow-[0_0_0_4px_rgba(0,0,0,0.25)] transition-all duration-200 ease-out"
          style={padded(spot.anchor)}
        />
      )}

      {/* Tarjeta del paso — única capa que captura el mouse. */}
      <div
        className="absolute pointer-events-auto rounded-2xl border border-base-300/60 bg-base-100 shadow-2xl p-4 flex flex-col gap-2 animate-[fadeIn_0.15s_ease]"
        style={{ left: pos.left, top: pos.top, width: CARD_W }}
        onKeyDown={onCardKeyDown}
      >
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-bold text-base-content leading-tight pr-2">
            {step.title}
          </h3>
          <span className="font-mono text-[10px] text-base-content/40 tabular-nums shrink-0 pt-0.5">
            {index + 1} / {total}
          </span>
        </div>
        <p className="text-xs leading-relaxed text-base-content/70">{step.body}</p>
        <div className="flex items-center justify-between pt-1 gap-2">
          <button
            type="button"
            onClick={() => finish(false)}
            className="btn btn-ghost btn-xs rounded-lg text-base-content/50 px-1.5"
          >
            Salir del tour
          </button>
          <div className="flex items-center gap-1.5 shrink-0">
            {index > 0 && (
              <button
                type="button"
                onClick={prev}
                className="btn btn-ghost btn-xs rounded-lg gap-1"
              >
                <ArrowLeft size={12} />
                Anterior
              </button>
            )}
            <button
              type="button"
              onClick={next}
              className="btn btn-primary btn-xs rounded-lg gap-1"
            >
              {isLast ? "Terminar" : "Siguiente"}
              {!isLast && <ArrowRight size={12} />}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
