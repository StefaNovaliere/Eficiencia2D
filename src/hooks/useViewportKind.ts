"use client";

import { useEffect, useState } from "react";
import {
  isCompactViewport,
  shouldPromptRotate,
  type ViewportInfo,
} from "@/core/mobile-layout";

export interface ViewportKind {
  /** Pantalla chica: el layout de escritorio no entra. */
  compact: boolean;
  /** Celular táctil en vertical: conviene pedir que lo gire. */
  promptRotate: boolean;
}

const SSR: ViewportKind = { compact: false, promptRotate: false };

function read(): ViewportKind {
  const v: ViewportInfo = {
    width: window.innerWidth,
    height: window.innerHeight,
    coarsePointer: window.matchMedia?.("(pointer: coarse)").matches ?? false,
  };
  return { compact: isCompactViewport(v), promptRotate: shouldPromptRotate(v) };
}

/**
 * Clasifica el viewport actual y se actualiza al girar el celular.
 *
 * Devuelve el valor de escritorio en el primer render (SSR y la hidratación no
 * conocen el tamaño real): recién en el efecto se corrige. Así no hay mismatch
 * de hidratación.
 */
export function useViewportKind(): ViewportKind {
  const [kind, setKind] = useState<ViewportKind>(SSR);

  useEffect(() => {
    const update = () => {
      setKind((prev) => {
        const next = read();
        return prev.compact === next.compact && prev.promptRotate === next.promptRotate
          ? prev
          : next;
      });
    };
    update();
    window.addEventListener("resize", update);
    // `orientationchange` llega antes de que `innerWidth/Height` se actualicen
    // en algunos navegadores móviles, de ahí el reintento diferido.
    const onOrientation = () => {
      update();
      setTimeout(update, 250);
    };
    window.addEventListener("orientationchange", onOrientation);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", onOrientation);
    };
  }, []);

  return kind;
}

export default useViewportKind;
