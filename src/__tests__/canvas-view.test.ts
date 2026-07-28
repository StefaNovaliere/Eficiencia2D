import { describe, expect, it } from "vitest";
import {
  type CanvasView,
  IDENTITY_VIEW,
  MAX_ZOOM,
  MIN_ZOOM,
  applyView,
  clampPan,
  isZoomed,
  panBy,
  wheelZoomFactor,
  zoomAt,
} from "@/core/canvas-view";

const SIZE = { w: 600, h: 300 };

/** Punto del lienzo → punto en pantalla, con la vista aplicada. */
function project(view: CanvasView, x: number, y: number) {
  return { x: x * view.zoom + view.panX, y: y * view.zoom + view.panY };
}

describe("zoom con la rueda", () => {
  it("acercar deja quieto lo que está bajo el cursor", () => {
    // Es lo que hace que el zoom se sienta natural: apuntás a una pieza,
    // girás la ruedita y la pieza no se te escapa de abajo del mouse.
    const cursor = { x: 420, y: 90 };
    let view = IDENTITY_VIEW;
    for (let i = 0; i < 5; i++) {
      view = zoomAt(view, 1.25, cursor.x, cursor.y, SIZE);
    }

    // El punto del dibujo que estaba bajo el cursor sigue estándolo.
    const enDibujo = { x: cursor.x, y: cursor.y }; // a zoom 1 coinciden
    const proyectado = project(view, enDibujo.x, enDibujo.y);
    expect(proyectado.x).toBeCloseTo(cursor.x, 6);
    expect(proyectado.y).toBeCloseTo(cursor.y, 6);
    expect(view.zoom).toBeGreaterThan(1);
  });

  it("acercar y alejar en el mismo punto vuelve al encuadre original", () => {
    const acercada = zoomAt(IDENTITY_VIEW, 2, 150, 200, SIZE);
    const vuelta = zoomAt(acercada, 0.5, 150, 200, SIZE);
    expect(vuelta.zoom).toBeCloseTo(1, 6);
    expect(vuelta.panX).toBeCloseTo(0, 6);
    expect(vuelta.panY).toBeCloseTo(0, 6);
  });

  it("no se aleja más allá de ver el dibujo entero", () => {
    const view = zoomAt(IDENTITY_VIEW, 0.2, 300, 150, SIZE);
    expect(view.zoom).toBe(MIN_ZOOM);
  });

  it("tiene un tope de acercamiento", () => {
    let view = IDENTITY_VIEW;
    for (let i = 0; i < 40; i++) view = zoomAt(view, 1.5, 300, 150, SIZE);
    expect(view.zoom).toBe(MAX_ZOOM);
  });

  /**
   * Cuando el zoom ya está en el tope devolvemos la MISMA vista para que el
   * componente pueda no llamar a preventDefault y la rueda siga scrolleando la
   * página. Si no, el lienzo se comería el scroll sin hacer nada.
   */
  it("avisa por identidad que el zoom no cambió, para no secuestrar la rueda", () => {
    expect(zoomAt(IDENTITY_VIEW, 0.5, 300, 150, SIZE)).toBe(IDENTITY_VIEW);

    const tope = { zoom: MAX_ZOOM, panX: 0, panY: 0 };
    expect(zoomAt(tope, 2, 300, 150, SIZE)).toBe(tope);
    // Pero acercar desde el encuadre completo sí cambia la vista.
    expect(zoomAt(IDENTITY_VIEW, 1.5, 300, 150, SIZE)).not.toBe(IDENTITY_VIEW);
  });

  it("la rueda acerca hacia arriba y aleja hacia abajo", () => {
    expect(wheelZoomFactor(-100)).toBeGreaterThan(1);
    expect(wheelZoomFactor(100)).toBeLessThan(1);
    expect(wheelZoomFactor(0)).toBe(1);
  });

  it("normaliza la rueda por líneas de Firefox y acota el envión del trackpad", () => {
    // deltaMode 1 = líneas: un clic de rueda son ~3 líneas, no 3 px.
    expect(wheelZoomFactor(-3, 1)).toBeGreaterThan(wheelZoomFactor(-3, 0));
    // Un envión enorme no salta de un extremo al otro.
    expect(wheelZoomFactor(-99999)).toBe(wheelZoomFactor(-240));
  });
});

describe("encuadre de dibujo", () => {
  // Encuadre típico del lienzo de planchas: 1.2 m entran en 520 px útiles.
  const FIT = { scale: 433, offsetX: 40, offsetY: 40 };
  const toScreen = (f: typeof FIT, m: number) => ({
    x: f.offsetX + m * f.scale,
    y: f.offsetY + m * f.scale,
  });

  it("sin zoom no toca el encuadre", () => {
    expect(applyView(FIT, IDENTITY_VIEW)).toEqual(FIT);
  });

  it("la pieza bajo el cursor no se mueve al acercarse", () => {
    // El invariante que se siente al usarlo: se mira una pieza, se gira la
    // ruedita encima y esa pieza se queda donde está.
    const cursor = { x: 320, y: 180 };
    // Qué punto del dibujo (en metros) cae bajo el cursor antes del zoom.
    const metros = (cursor.x - FIT.offsetX) / FIT.scale;

    const view = zoomAt(IDENTITY_VIEW, 2.5, cursor.x, cursor.y, SIZE);
    const despues = toScreen(applyView(FIT, view), metros);

    expect(despues.x).toBeCloseTo(cursor.x, 6);
  });

  it("acercar agranda el dibujo alrededor del punto anclado", () => {
    const view = zoomAt(IDENTITY_VIEW, 3, 300, 150, SIZE);
    const conZoom = applyView(FIT, view);
    // Una plancha de 1 m pasa a medir el triple en pantalla.
    expect(conZoom.scale).toBeCloseTo(FIT.scale * 3, 6);
  });
});

describe("desplazamiento", () => {
  it("sin zoom no hay nada que desplazar", () => {
    expect(panBy(IDENTITY_VIEW, 120, 80, SIZE)).toEqual(IDENTITY_VIEW);
  });

  it("con zoom el arrastre mueve la vista", () => {
    const view = panBy({ zoom: 2, panX: -100, panY: -50 }, 40, 20, SIZE);
    expect(view.panX).toBe(-60);
    expect(view.panY).toBe(-30);
  });

  it("no deja sacar el dibujo del recuadro", () => {
    const zoom = 2;
    // Arrastrar muy lejos en las dos direcciones queda pegado a los bordes.
    expect(panBy({ zoom, panX: 0, panY: 0 }, 9999, 9999, SIZE)).toEqual({
      zoom,
      panX: 0,
      panY: 0,
    });
    expect(panBy({ zoom, panX: 0, panY: 0 }, -9999, -9999, SIZE)).toEqual({
      zoom,
      panX: -SIZE.w,
      panY: -SIZE.h,
    });
  });

  it("al alejar del todo el encuadre vuelve a quedar pegado al origen", () => {
    expect(clampPan({ zoom: 1, panX: -240, panY: -80 }, SIZE)).toEqual(IDENTITY_VIEW);
  });

  it("isZoomed distingue el encuadre completo del acercamiento", () => {
    expect(isZoomed(IDENTITY_VIEW)).toBe(false);
    expect(isZoomed({ zoom: 1.2, panX: 0, panY: 0 })).toBe(true);
  });
});
