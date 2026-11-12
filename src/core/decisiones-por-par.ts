// ============================================================================
// Decisiones de quién cede, por PAR de grupos.
//
// La revisión guarda "en la junta j cede el grupo g" por índice de junta. Ese
// índice es posicional: cada fusión, división o cambio de escala re-deriva la
// lista de juntas y la decisión queda apuntando a otra junta — o a ninguna.
//
// El backend acepta ahora `wall_wall_decisions_by_pair`, que identifica la
// junta por sus dos grupos y gana sobre el índice si llegan las dos. Acá:
//   - se deriva el par de cada decisión con las juntas a las que se refiere;
//   - cuando cambian las juntas, se re-mapean las decisiones por par a los
//     índices nuevos, en vez de dejarlas apuntando a juntas que se corrieron;
//   - se aplica una decisión que llega por par (acción `invertir_cede`).
//
// Ver CONTRATO_verificacion.md §4.
// ============================================================================

import type { WallWallJoint } from "./assembly-adjuster";
import type { DecisionPorPar } from "./verificacion";

type Decisiones = Map<number, number>;

function clavePar(a: number, b: number): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Cada decisión por índice, expresada con los dos grupos de su junta. */
export function decisionesPorPar(
  decisiones: Decisiones,
  juntas: WallWallJoint[],
): DecisionPorPar[] {
  const porIndice = new Map(juntas.map((j) => [j.jointIndex, j]));
  const out: DecisionPorPar[] = [];
  for (const [indice, cede] of decisiones) {
    const j = porIndice.get(indice);
    // Una decisión que no corresponde a ninguna de las dos piezas de su junta
    // no se puede traducir con certeza: no se manda un par inventado.
    if (!j || (cede !== j.groupA && cede !== j.groupB)) continue;
    out.push({ group_a: j.groupA, group_b: j.groupB, yield_group_id: cede });
  }
  return out;
}

/**
 * Traslada las decisiones de una lista de juntas a otra, por par de grupos.
 * Las que ya no tienen junta con ese par se pierden: el backend avisaría que
 * no corresponden a ninguna unión.
 */
export function remapearDecisiones(
  decisiones: Decisiones,
  juntasViejas: WallWallJoint[],
  juntasNuevas: WallWallJoint[],
): Decisiones {
  const nuevaPorPar = new Map(juntasNuevas.map((j) => [clavePar(j.groupA, j.groupB), j]));
  const out: Decisiones = new Map();
  for (const d of decisionesPorPar(decisiones, juntasViejas)) {
    const j = nuevaPorPar.get(clavePar(d.group_a, d.group_b));
    if (j) out.set(j.jointIndex, d.yield_group_id);
  }
  return out;
}

/**
 * Aplica decisiones que llegan por par. Devuelve el mapa por índice actualizado
 * y las que no tienen junta en la lista actual — ésas se siguen mandando por
 * par, que es justamente para lo que existe.
 */
export function aplicarDecisionesPorPar(
  decisiones: Decisiones,
  juntas: WallWallJoint[],
  nuevas: DecisionPorPar[],
): { decisiones: Decisiones; sinJunta: DecisionPorPar[] } {
  const porPar = new Map(juntas.map((j) => [clavePar(j.groupA, j.groupB), j]));
  const out: Decisiones = new Map(decisiones);
  const sinJunta: DecisionPorPar[] = [];
  for (const d of nuevas) {
    const j = porPar.get(clavePar(d.group_a, d.group_b));
    if (j) out.set(j.jointIndex, d.yield_group_id);
    else sinJunta.push(d);
  }
  return { decisiones: out, sinJunta };
}
