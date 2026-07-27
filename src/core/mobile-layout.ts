/**
 * Reglas de layout para pantallas chicas (celulares).
 *
 * El visor 3D necesita ANCHO: la revisión es un lienzo con un panel lateral
 * fijo, y en un celular vertical (~390px) el panel se come la pantalla entera.
 * En vez de inventar un layout vertical distinto —que dejaría el modelo en una
 * franja inservible— asumimos el celular ACOSTADO como modo de uso, y en
 * vertical mostramos un aviso para que lo gire.
 *
 * Todo acá es puro para poder testearlo sin DOM.
 */

export interface ViewportInfo {
  width: number;
  height: number;
  /** `(pointer: coarse)`: dedo en vez de mouse. Distingue celular de ventana chica. */
  coarsePointer: boolean;
}

/**
 * Umbral del lado MENOR del viewport. Un celular mide ~360-430px en su lado
 * corto en cualquiera de las dos orientaciones; una tablet arranca en ~740px.
 */
export const COMPACT_MIN_SIDE = 560;

/**
 * ¿Pantalla chica? Se mide por el lado MENOR, así vale igual en vertical que en
 * horizontal. No exige `coarsePointer` a propósito: una ventana de escritorio
 * angosta también se beneficia del layout compacto.
 */
export function isCompactViewport(v: Pick<ViewportInfo, "width" | "height">): boolean {
  return Math.min(v.width, v.height) <= COMPACT_MIN_SIDE;
}

/** Orientación vertical (alto > ancho). */
export function isPortrait(v: Pick<ViewportInfo, "width" | "height">): boolean {
  return v.height > v.width;
}

/**
 * ¿Corresponde pedirle al usuario que gire el celular?
 *
 * Sólo en un dispositivo táctil chico y en vertical. En una ventana de
 * escritorio angosta el aviso no tendría sentido (no hay cómo "girar"), y en
 * horizontal ya se puede trabajar.
 */
export function shouldPromptRotate(v: ViewportInfo): boolean {
  return v.coarsePointer && isCompactViewport(v) && isPortrait(v);
}

/**
 * Medidas del panel lateral (en px) para `react-resizable-panels`.
 *
 * En compacto se achica: con el celular acostado (~844px) un panel de 350px
 * dejaba el visor en menos de 500px. Además arranca oculto, para que el lienzo
 * ocupe todo y el panel se abra sólo cuando hace falta.
 */
export function sidebarSizing(compact: boolean): {
  defaultSize: number;
  minSize: number;
  maxSize: number;
  startsHidden: boolean;
} {
  if (compact) {
    return { defaultSize: 280, minSize: 220, maxSize: 340, startsHidden: true };
  }
  return { defaultSize: 350, minSize: 250, maxSize: 500, startsHidden: false };
}
