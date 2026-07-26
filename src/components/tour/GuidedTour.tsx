"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import {
  computeTooltipPosition,
  resolveTourSteps,
  tourTargetSelector,
  type TourStep,
} from "@/core/guided-tour";

const CARD_W = 300;
const CARD_H = 170;

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
 */
export default function GuidedTour({ steps, onClose }: GuidedTourProps) {
  // Anclas ausentes (p.ej. sidebar plegado) se saltan al iniciar.
  const activeSteps = useMemo(
    () => (typeof document === "undefined" ? steps : resolveTourSteps(steps, document)),
    [steps],
  );
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const rafRef = useRef(0);

  const step = activeSteps[index] ?? null;
  const total = activeSteps.length;

  // Seguir al ancla en vivo (scroll, resize, layout async del canvas).
  useEffect(() => {
    if (!step) return;
    const measure = () => {
      const el = document.querySelector(tourTargetSelector(step.target));
      setRect(el ? el.getBoundingClientRect() : null);
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

  // Teclado: ←/→ navegan, Esc cierra.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish(false);
      else if (e.key === "ArrowRight" || e.key === "Enter") next();
      else if (e.key === "ArrowLeft") prev();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [finish, next, prev]);

  if (!step || total === 0) return null;
  if (typeof document === "undefined") return null;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const pos = rect
    ? computeTooltipPosition(
        { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        { width: CARD_W, height: CARD_H },
        { width: vw, height: vh },
        step.placement,
      )
    : { left: vw / 2 - CARD_W / 2, top: vh / 2 - CARD_H / 2, placement: "bottom" as const };

  const isLast = index === total - 1;

  return createPortal(
    <div className="fixed inset-0 z-[400]" role="dialog" aria-label="Tour guiado">
      {/* Fondo clickeable (cerrar) — el spotlight recorta el ancla con box-shadow */}
      <div className="absolute inset-0" onClick={() => finish(false)} />
      {rect && (
        <div
          className="absolute rounded-xl ring-2 ring-primary/80 transition-all duration-200 ease-out pointer-events-none"
          style={{
            left: rect.left - 6,
            top: rect.top - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
          }}
        />
      )}
      {!rect && (
        <div className="absolute inset-0 bg-black/55 pointer-events-none" />
      )}

      {/* Tarjeta del paso */}
      <div
        className="absolute rounded-2xl border border-base-300/60 bg-base-100 shadow-2xl p-4 flex flex-col gap-2 animate-[fadeIn_0.15s_ease]"
        style={{ left: pos.left, top: pos.top, width: CARD_W }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-bold text-base-content leading-tight">
            {step.title}
          </h3>
          <button
            type="button"
            onClick={() => finish(false)}
            aria-label="Cerrar tour"
            className="btn btn-ghost btn-xs btn-circle -mt-1 -mr-1 text-base-content/50"
          >
            <X size={13} />
          </button>
        </div>
        <p className="text-xs leading-relaxed text-base-content/70">{step.body}</p>
        <div className="flex items-center justify-between pt-1">
          <span className="font-mono text-[10px] text-base-content/40 tabular-nums">
            {index + 1} / {total}
          </span>
          <div className="flex items-center gap-1.5">
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
