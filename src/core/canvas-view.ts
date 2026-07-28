/**
 * Zoom + desplazamiento de un lienzo 2D (vista previa de planchas).
 * Puro y sin dependencias del DOM para poder testear el anclaje del zoom.
 *
 * Las coordenadas van en px de CSS del propio lienzo, con el origen arriba a la
 * izquierda. `zoom: 1` es el encuadre que ya calcula el lienzo para que entre
 * todo, así que nunca se puede alejar más allá de ver el dibujo completo.
 */

export interface CanvasView {
  zoom: number;
  panX: number;
  panY: number;
}

export interface CanvasSize {
  w: number;
  h: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;
export const IDENTITY_VIEW: CanvasView = { zoom: 1, panX: 0, panY: 0 };

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function isZoomed(view: CanvasView): boolean {
  return view.zoom > MIN_ZOOM;
}

/**
 * Impide sacar el dibujo del encuadre: a zoom 1 queda fijo donde estaba, y con
 * más zoom los bordes del contenido nunca entran dentro de la vista.
 */
export function clampPan(view: CanvasView, size: CanvasSize): CanvasView {
  const minX = Math.min(size.w * (1 - view.zoom), 0);
  const minY = Math.min(size.h * (1 - view.zoom), 0);
  return {
    zoom: view.zoom,
    panX: clamp(view.panX, minX, 0),
    panY: clamp(view.panY, minY, 0),
  };
}

/**
 * Zoom anclado en un punto: lo que está bajo el cursor se queda donde está.
 * Devuelve la MISMA vista (por identidad) si el zoom ya estaba en el tope, para
 * que quien llama pueda dejar pasar el evento en vez de secuestrarlo.
 */
export function zoomAt(
  view: CanvasView,
  factor: number,
  cx: number,
  cy: number,
  size: CanvasSize,
): CanvasView {
  const zoom = clamp(view.zoom * factor, MIN_ZOOM, MAX_ZOOM);
  if (zoom === view.zoom) return view;

  const k = zoom / view.zoom;
  return clampPan(
    { zoom, panX: cx - (cx - view.panX) * k, panY: cy - (cy - view.panY) * k },
    size,
  );
}

/** Arrastre: mueve la vista `dx`/`dy` px de pantalla. */
export function panBy(
  view: CanvasView,
  dx: number,
  dy: number,
  size: CanvasSize,
): CanvasView {
  return clampPan({ ...view, panX: view.panX + dx, panY: view.panY + dy }, size);
}

/** Encuadre de dibujo: `dibujo → pantalla` es `v * scale + offset`. */
export interface CanvasFrame {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/**
 * Mete el zoom DENTRO de la escala y el origen del encuadre, en vez de
 * aplicarlo como transformación del contexto 2D. Así el grosor de las líneas y
 * los umbrales de tamaño de texto quedan en px de pantalla: acercarse revela
 * detalle en lugar de engordar el trazo, y las etiquetas de pieza aparecen
 * recién cuando entran.
 */
export function applyView(fit: CanvasFrame, view: CanvasView): CanvasFrame {
  return {
    scale: fit.scale * view.zoom,
    offsetX: fit.offsetX * view.zoom + view.panX,
    offsetY: fit.offsetY * view.zoom + view.panY,
  };
}

/**
 * Factor de zoom para un evento de rueda. Normaliza `deltaMode` (Firefox
 * reporta líneas, no px) y acota el paso para que el envión de un trackpad no
 * salte de un extremo al otro.
 */
export function wheelZoomFactor(deltaY: number, deltaMode = 0): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.exp(-clamp(px, -240, 240) * 0.0015);
}
