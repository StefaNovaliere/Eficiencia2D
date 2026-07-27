import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useReviewHistory, type ReviewHistoryState } from "@/hooks/useReviewHistory";

/**
 * El deshacer debe habilitarse ante CUALQUIER cambio de CUALQUIER herramienta.
 * Antes el snapshot sólo versionaba categorías/ocultos/uniones/cortes, así que
 * marcas rojas, medidas, refuerzos, notas, etc. no habilitaban la flecha.
 */
const empty = (): ReviewHistoryState => ({
  overrides: new Map(),
  hiddenGroupIds: new Set(),
  wallWallDecisions: new Map(),
  userCuts: [],
  markLines: [],
  measures: [],
  angleMeasures: [],
  ribs: [],
  columns: [],
  notes: [],
  flex: [],
  markGroupIds: new Set(),
});

/** Un cambio por herramienta: si el snapshot lo versiona, undo lo revierte. */
const CAMBIOS: { nombre: string; aplicar: (s: ReviewHistoryState) => ReviewHistoryState }[] = [
  { nombre: "marca roja", aplicar: (s) => ({ ...s, markLines: [{ id: "m1", groupId: 1, points: [{ u: 0, v: 0 }, { u: 1, v: 0 }] }] }) },
  { nombre: "medición", aplicar: (s) => ({ ...s, measures: [{ id: "me1" } as never] }) },
  { nombre: "transportador", aplicar: (s) => ({ ...s, angleMeasures: [{ id: "a1" } as never] }) },
  { nombre: "nervio", aplicar: (s) => ({ ...s, ribs: [{ id: "r1" } as never] }) },
  { nombre: "columna", aplicar: (s) => ({ ...s, columns: [{ id: "c1" } as never] }) },
  { nombre: "nota", aplicar: (s) => ({ ...s, notes: [{ id: "n1" } as never] }) },
  { nombre: "curvado", aplicar: (s) => ({ ...s, flex: [{ groupId: 1 } as never] }) },
  { nombre: "marcar abertura", aplicar: (s) => ({ ...s, markGroupIds: new Set([7]) }) },
  { nombre: "corte", aplicar: (s) => ({ ...s, userCuts: [{ id: "c1", groupId: 1, kind: "rect", u0: 0, v0: 0, u1: 1, v1: 1 }] }) },
];

describe("useReviewHistory — cobertura por herramienta", () => {
  for (const { nombre, aplicar } of CAMBIOS) {
    it(`deshacer revierte un cambio de: ${nombre}`, () => {
      let state = empty();
      const { result, rerender } = renderHook(() => useReviewHistory(state));

      expect(result.current.canUndo).toBe(false);

      // La herramienta registra el estado ANTERIOR y luego muta.
      act(() => result.current.pushHistory());
      state = aplicar(state);
      rerender();

      expect(result.current.canUndo).toBe(true);

      let snap: ReturnType<typeof result.current.undo> | undefined;
      act(() => {
        snap = result.current.undo();
      });
      expect(snap).toBeDefined();
      // El snapshot devuelto es el estado previo (vacío) para esa herramienta.
      expect(JSON.stringify(snap)).toBe(JSON.stringify(empty()));
    });
  }

  it("rehacer vuelve a aplicar el cambio", () => {
    let state = empty();
    const { result, rerender } = renderHook(() => useReviewHistory(state));

    act(() => result.current.pushHistory());
    state = { ...state, markLines: [{ id: "m1", groupId: 1, points: [{ u: 0, v: 0 }, { u: 1, v: 0 }] }] };
    rerender();

    act(() => {
      result.current.undo();
    });
    expect(result.current.canRedo).toBe(true);

    let redone: ReturnType<typeof result.current.redo>;
    act(() => {
      redone = result.current.redo();
    });
    expect(redone!.markLines).toHaveLength(1);
  });
});
