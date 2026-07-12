"use client";

import { useEffect } from "react";
import { useUIStore, type FlowNav } from "@/stores/uiStore";

/**
 * La página del flujo "registra" su navegación (Atrás/Continuar) para que la
 * barra constante del shell la muestre en una posición FIJA. Los botones no se
 * mueven entre pasos; sólo cambian label/handler que aporta cada página.
 *
 * Se re-registra en cada render para mantener frescos los handlers/estado (busy,
 * canNext); se limpia al desmontar.
 */
export function useRegisterFlowNav(nav: FlowNav): void {
  const register = useUIStore((s) => s.registerFlowNav);
  const clear = useUIStore((s) => s.clearFlowNav);

  useEffect(() => {
    register(nav);
  });

  useEffect(() => () => clear(), [clear]);
}
