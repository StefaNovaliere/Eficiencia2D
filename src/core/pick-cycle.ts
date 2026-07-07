/**
 * Lógica pura del "click cíclico": al clickear repetidas veces ~en el mismo píxel
 * sobre componentes superpuestos, se va rotando entre los candidatos (de adelante
 * hacia atrás). El extractor de groupIds desde el raycast vive en el visor.
 */

export interface ClickCycleState {
  x: number;
  y: number;
  /** Candidatos ordenados por distancia (frontal primero), únicos. */
  ids: number[];
  index: number;
}

/** Lista de ids únicos preservando el orden (frontal→fondo). */
export function uniqueOrdered(ids: number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

export function sameIdSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Decide el próximo estado del ciclo:
 * - Si el click es ~mismo píxel y mismo set que el anterior ⇒ avanza el índice (wrap).
 * - Si no ⇒ arranca en `defaultIndex` (el pick "inteligente" del primer click).
 */
export function advanceCycle(
  prev: ClickCycleState | null,
  x: number,
  y: number,
  ids: number[],
  defaultIndex: number,
  tolPx = 6,
): ClickCycleState {
  if (
    prev &&
    Math.hypot(x - prev.x, y - prev.y) <= tolPx &&
    sameIdSet(prev.ids, ids)
  ) {
    return { x, y, ids, index: (prev.index + 1) % ids.length };
  }
  const index = defaultIndex >= 0 && defaultIndex < ids.length ? defaultIndex : 0;
  return { x, y, ids, index };
}
