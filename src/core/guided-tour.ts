/**
 * Tour guiado del visor de Revisión (coach marks / clicks guiados).
 *
 * La primera vez que el usuario entra a /review se le ofrece un recorrido por
 * los puntos clave de la pantalla; cada paso ancla a un elemento real del DOM
 * vía atributos `data-tour="…"`, lo destaca con un spotlight y explica qué se
 * hace ahí. Este módulo es puro (pasos, storage y matemática de posición) para
 * poder testearlo aislado; el overlay React vive en components/tour/.
 */

export type TourPlacement = "top" | "bottom" | "left" | "right";

export interface TourStep {
  id: string;
  /** Valor del atributo `data-tour` del elemento a destacar. */
  target: string;
  title: string;
  body: string;
  /** Lado preferido para la tarjeta (se ajusta si no entra en pantalla). */
  placement?: TourPlacement;
  /**
   * Otros `data-tour` que forman parte del paso cuando están en pantalla (el
   * ribbon que abre una pestaña, el modal del buscador…). Se suman al área
   * destacada para que la tarjeta no se les monte encima.
   */
  companions?: string[];
}

/** Selector CSS del ancla de un paso. */
export function tourTargetSelector(target: string): string {
  return `[data-tour="${target}"]`;
}

// ---------------------------------------------------------------------------
// Pasos del tour de Revisión
// ---------------------------------------------------------------------------

export const REVIEW_TOUR_STEPS: TourStep[] = [
  {
    id: "viewer",
    target: "viewer-3d",
    title: "El visor 3D",
    body: "Acá vive tu modelo. Hacé clic sobre cualquier pared o piso para seleccionarlo; con Ctrl+clic sumás varios. La rueda acerca y el botón derecho orbita.",
    placement: "left",
  },
  {
    id: "toolbar-capas",
    target: "toolbar-visibility",
    title: "Capas",
    body: "Filtrá qué se ve: paredes, pisos o descartados. Si un componente te tapa, desde acá lo ocultás.",
    placement: "bottom",
    companions: ["toolbar-ribbon"],
  },
  {
    id: "toolbar-camara",
    target: "toolbar-nav",
    title: "Cámara",
    body: "Encuadrá la selección o todo el modelo, activá el modo caminar para recorrer el interior, o rotá el eje si el modelo quedó de costado.",
    placement: "bottom",
    companions: ["toolbar-ribbon"],
  },
  {
    id: "toolbar-visualizacion",
    target: "toolbar-visualizacion",
    title: "Visualización",
    body: "Cambiá cómo se ve el modelo: vista maciza, rayos X para ver a través, plano de corte y ejes de referencia.",
    placement: "bottom",
    companions: ["toolbar-ribbon"],
  },
  {
    id: "toolbar-herramientas",
    target: "toolbar-tools",
    title: "Herramientas de edición",
    body: "Cortar aberturas, medir, marcar en rojo para grabar, transportador y más. Cada herramienta tiene su atajo de teclado.",
    placement: "bottom",
    companions: ["toolbar-ribbon"],
  },
  {
    id: "toolbar-config",
    target: "toolbar-config",
    title: "Configuraciones",
    body: "Acá ajustás el descarte automático de capas chicas, los colores del modelo y si preferís dejar varias pestañas abiertas a la vez.",
    placement: "bottom",
    companions: ["toolbar-config-menu"],
  },
  {
    id: "inspector",
    target: "inspector",
    title: "El inspector",
    body: "Al seleccionar un componente, acá aparecen sus propiedades y acciones: notas, uniones, refuerzos, cortes. Abajo, «Explorar componentes» lista todo el modelo.",
    placement: "right",
  },
  {
    id: "command-search",
    target: "command-search",
    title: "Buscador de acciones",
    body: "¿No encontrás algo? Con Ctrl+K buscás cualquier herramienta o acción por nombre, sin recorrer menús.",
    placement: "top",
    companions: ["command-palette"],
  },
  {
    id: "continue",
    target: "flow-next",
    title: "Continuar",
    body: "Cuando el modelo esté revisado, seguí al paso de planchas: ahí ves cómo se acomodan las piezas para el corte.",
    placement: "top",
  },
];

// ---------------------------------------------------------------------------
// Persistencia (primera visita)
// ---------------------------------------------------------------------------

export const REVIEW_TOUR_SEEN_KEY = "e2dReviewTourSeen";

export function hasSeenReviewTour(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(REVIEW_TOUR_SEEN_KEY) === "1";
  } catch {
    return true;
  }
}

export function markReviewTourSeen(): void {
  try {
    localStorage.setItem(REVIEW_TOUR_SEEN_KEY, "1");
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Resolución de pasos contra el DOM
// ---------------------------------------------------------------------------

/**
 * Filtra los pasos cuyo ancla existe en el documento. Un ancla ausente (p.ej.
 * sidebar oculto) no rompe el tour: ese paso simplemente se salta.
 */
export function resolveTourSteps(steps: TourStep[], root: Document): TourStep[] {
  return steps.filter((s) => root.querySelector(tourTargetSelector(s.target)) != null);
}

// ---------------------------------------------------------------------------
// Posición de la tarjeta (pura, clampada al viewport)
// ---------------------------------------------------------------------------

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface TooltipPosition {
  left: number;
  top: number;
  placement: TourPlacement;
}

/**
 * Caja que contiene a todos los rectángulos dados (ancla + acompañantes
 * visibles). Ignora los degenerados: un panel cerrado mide 0×0 y no debe
 * estirar el spotlight hasta la esquina de la pantalla.
 */
export function unionRects(rects: Rect[]): Rect | null {
  const real = rects.filter((r) => r.width > 0 && r.height > 0);
  if (real.length === 0) return null;
  const left = Math.min(...real.map((r) => r.left));
  const top = Math.min(...real.map((r) => r.top));
  const right = Math.max(...real.map((r) => r.left + r.width));
  const bottom = Math.max(...real.map((r) => r.top + r.height));
  return { left, top, width: right - left, height: bottom - top };
}

const GAP = 14;
const MARGIN = 8;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Ubica la tarjeta al lado `placement` del ancla; si no entra en el viewport,
 * prueba el lado opuesto y clampa a los márgenes. Determinista y testeable.
 */
export function computeTooltipPosition(
  target: Rect,
  card: { width: number; height: number },
  viewport: { width: number; height: number },
  placement: TourPlacement = "bottom",
): TooltipPosition {
  const fits = (p: TourPlacement): boolean => {
    switch (p) {
      case "top":
        return target.top - GAP - card.height >= MARGIN;
      case "bottom":
        return target.top + target.height + GAP + card.height <= viewport.height - MARGIN;
      case "left":
        return target.left - GAP - card.width >= MARGIN;
      case "right":
        return target.left + target.width + GAP + card.width <= viewport.width - MARGIN;
    }
  };

  const opposite: Record<TourPlacement, TourPlacement> = {
    top: "bottom",
    bottom: "top",
    left: "right",
    right: "left",
  };

  let chosen = placement;
  if (!fits(chosen) && fits(opposite[chosen])) chosen = opposite[chosen];

  let left: number;
  let top: number;
  switch (chosen) {
    case "top":
      left = target.left + target.width / 2 - card.width / 2;
      top = target.top - GAP - card.height;
      break;
    case "bottom":
      left = target.left + target.width / 2 - card.width / 2;
      top = target.top + target.height + GAP;
      break;
    case "left":
      left = target.left - GAP - card.width;
      top = target.top + target.height / 2 - card.height / 2;
      break;
    case "right":
      left = target.left + target.width + GAP;
      top = target.top + target.height / 2 - card.height / 2;
      break;
  }

  return {
    left: clamp(left, MARGIN, Math.max(MARGIN, viewport.width - card.width - MARGIN)),
    top: clamp(top, MARGIN, Math.max(MARGIN, viewport.height - card.height - MARGIN)),
    placement: chosen,
  };
}
