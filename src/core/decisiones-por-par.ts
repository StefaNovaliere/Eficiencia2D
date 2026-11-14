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

/**
 * Decisiones guardadas → sólo las del usuario.
 *
 * Hasta acá el front guardaba en el mismo mapa las sugerencias del backend y
 * las elecciones del usuario, y las mandaba todas como decisiones. Los
 * proyectos guardados así traen una decisión por junta. Una entrada igual a la
 * sugerencia no se distingue de la sugerencia sembrada, así que se descarta:
 * la sugerencia vuelve a ser el valor por defecto y el backend recupera la
 * libertad de resolver esa unión. El costo es que una elección explícita igual
 * a la sugerencia deja de estar fija — el caso raro, contra el resolvedor
 * apagado en todos los proyectos guardados.
 */
export function soloDecisionesDelUsuario(
  guardadas: Decisiones | undefined,
  juntas: WallWallJoint[],
): Decisiones {
  const sugerida = new Map(juntas.map((j) => [j.jointIndex, j.suggestedYieldGroupId]));
  const out: Decisiones = new Map();
  for (const [indice, cede] of guardadas ?? []) {
    if (sugerida.get(indice) !== cede) out.set(indice, cede);
  }
  return out;
}

/** Índice de `decisiones_automaticas` por par de grupos. */
export function automaticasPorPar(lista: DecisionPorPar[]): Map<string, number> {
  return new Map(lista.map((d) => [clavePar(d.group_a, d.group_b), d.yield_group_id]));
}

/**
 * Lo que se corta en una junta (CONTRATO_verificacion §4.1): la decisión del
 * usuario si la hay; si no, la que tomó el backend; si no, la sugerida.
 * `automatica` marca cuando lo que se corta lo decidió el backend contra la
 * sugerencia, para que se entienda por qué no coinciden.
 */
export function cedeEfectivo(
  junta: Pick<WallWallJoint, "jointIndex" | "groupA" | "groupB" | "suggestedYieldGroupId">,
  decisiones: Decisiones,
  automaticas: Map<string, number>,
): { cede: number | undefined; automatica: boolean } {
  const delUsuario = decisiones.get(junta.jointIndex);
  if (delUsuario != null) return { cede: delUsuario, automatica: false };
  const auto = automaticas.get(clavePar(junta.groupA, junta.groupB));
  if (auto != null) return { cede: auto, automatica: auto !== junta.suggestedYieldGroupId };
  return { cede: junta.suggestedYieldGroupId, automatica: false };
}
