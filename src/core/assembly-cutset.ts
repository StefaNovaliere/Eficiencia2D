// ============================================================================
// Set de corte — la ÚNICA fuente del instructivo.
//
// El instructivo tiene que mostrar la maqueta que sale de cortar el DXF, y el
// DXF sale de `/nesting-preview`. Hasta acá el instructivo armaba su lista de
// piezas desde la TOPOLOGÍA y después buscaba la geometría por etiqueta. Eso
// falla por una razón concreta, medida sobre `demo.obj`:
//
//   - la topología numera los grupos no descartados (52 piezas, A1…A47);
//   - el set de corte descarta algunos de esos grupos y RENUMERA el resto
//     (50 piezas): todo lo que viene después del primer descartado se corre un
//     número. El grupo 26 es "A14" en la topología y "A13" en la plancha.
//
// En `demo.obj` 33 de 50 piezas tenían una etiqueta en el visor y otra en el
// DXF; en un modelo real de 403 piezas, 196. Cruzar por etiqueta le pegaba a un
// marco el contorno de OTRA pieza, decía "colocá A14" por la pieza que en la
// plancha se llama A13, pintaba de rojo los choques sobre piezas equivocadas, y
// dibujaba los grupos que no se cortan con la malla cruda del modelo.
//
// Acá la identidad de una pieza es su `group_id` (estable entre endpoints) y su
// nombre es el que figura en la plancha. Las piezas son exactamente las del set
// de corte: ni una más, ni una menos.
// ============================================================================

import type { Phase1Result } from "./pipeline";
import type { NestingPlacement } from "./final-pieces";

/**
 * Topología con las etiquetas del SET DE CORTE en lugar de las propias.
 *
 * Todo el instructivo cruza piezas por etiqueta (pasos, lista lateral, choques,
 * geometría), así que alcanza con que la etiqueta de cada grupo sea la de la
 * plancha para que todos esos cruces queden alineados con el DXF. Los grupos
 * que no están en el set de corte quedan SIN etiqueta de backend.
 */
export function conEtiquetasDeCorte(
  phase1: Phase1Result,
  setDeCorte: Map<number, NestingPlacement>,
): Phase1Result {
  const panelIdByGroup: Record<number, string> = {};
  for (const [groupId, pl] of setDeCorte) {
    if (pl.panelId) panelIdByGroup[groupId] = pl.panelId;
  }
  return { ...phase1, panelIdByGroup };
}

/** Ids de los grupos que efectivamente se cortan. */
export function gruposDelSetDeCorte(setDeCorte: Map<number, NestingPlacement>): Set<number> {
  return new Set(setDeCorte.keys());
}
