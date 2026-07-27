import { useCallback, useRef, useState } from "react";
import type { FaceCategory } from "@/core/group-classifier";
import type { UserCut } from "@/core/user-cuts";
import type { MarkLine } from "@/core/mark-lines";
import type { UserMeasure } from "@/core/measure-tool";
import type { UserAngleMeasure } from "@/core/angle-measure";
import type { Rib, Column } from "@/core/reinforcements";
import type { GroupNote } from "@/core/group-notes";
import type { FlexSpec } from "@/core/flex-bending";

// Se versiona TODO el estado de edición client-side, así CUALQUIER herramienta
// habilita el deshacer (antes sólo categorías/ocultos/uniones/cortes, por eso
// la flecha se activaba "a veces"). Eje/área/merges/splits viven en el backend.
export interface ReviewHistoryState {
  overrides: Map<number, FaceCategory>;
  hiddenGroupIds: Set<number>;
  wallWallDecisions: Map<number, number>;
  userCuts: UserCut[];
  markLines: MarkLine[];
  measures: UserMeasure[];
  angleMeasures: UserAngleMeasure[];
  ribs: Rib[];
  columns: Column[];
  notes: GroupNote[];
  flex: FlexSpec[];
  markGroupIds: Set<number>;
}

interface SerializedSnapshot {
  overrides: [number, FaceCategory][];
  hiddenGroupIds: number[];
  wallWallDecisions: [number, number][];
  userCuts: UserCut[];
  markLines: MarkLine[];
  measures: UserMeasure[];
  angleMeasures: UserAngleMeasure[];
  ribs: Rib[];
  columns: Column[];
  notes: GroupNote[];
  flex: FlexSpec[];
  markGroupIds: number[];
}

const MAX_HISTORY = 50;

function serialize(state: ReviewHistoryState): string {
  const payload: SerializedSnapshot = {
    overrides: Array.from(state.overrides.entries()),
    hiddenGroupIds: Array.from(state.hiddenGroupIds),
    wallWallDecisions: Array.from(state.wallWallDecisions.entries()),
    userCuts: state.userCuts,
    markLines: state.markLines,
    measures: state.measures,
    angleMeasures: state.angleMeasures,
    ribs: state.ribs,
    columns: state.columns,
    notes: state.notes,
    flex: state.flex,
    markGroupIds: Array.from(state.markGroupIds),
  };
  return JSON.stringify(payload);
}

function deserialize(raw: string): ReviewHistoryState {
  const payload = JSON.parse(raw) as SerializedSnapshot;
  return {
    overrides: new Map(payload.overrides),
    hiddenGroupIds: new Set(payload.hiddenGroupIds),
    wallWallDecisions: new Map(payload.wallWallDecisions),
    userCuts: payload.userCuts ?? [],
    markLines: payload.markLines ?? [],
    measures: payload.measures ?? [],
    angleMeasures: payload.angleMeasures ?? [],
    ribs: payload.ribs ?? [],
    columns: payload.columns ?? [],
    notes: payload.notes ?? [],
    flex: payload.flex ?? [],
    markGroupIds: new Set(payload.markGroupIds ?? []),
  };
}

export function useReviewHistory(initial: ReviewHistoryState) {
  const pastRef = useRef<string[]>([]);
  const futureRef = useRef<string[]>([]);
  const stateRef = useRef(initial);
  stateRef.current = initial;
  const [revision, setRevision] = useState(0);

  const bump = useCallback(() => setRevision((n) => n + 1), []);

  const pushHistory = useCallback(() => {
    const snap = serialize(stateRef.current);
    const next = [...pastRef.current, snap];
    if (next.length > MAX_HISTORY) next.shift();
    pastRef.current = next;
    futureRef.current = [];
    bump();
  }, [bump]);

  const undo = useCallback((): ReviewHistoryState | null => {
    if (pastRef.current.length === 0) return null;
    const snap = pastRef.current[pastRef.current.length - 1];
    pastRef.current = pastRef.current.slice(0, -1);
    futureRef.current = [serialize(stateRef.current), ...futureRef.current];
    bump();
    return deserialize(snap);
  }, [bump]);

  const redo = useCallback((): ReviewHistoryState | null => {
    if (futureRef.current.length === 0) return null;
    const [snap, ...rest] = futureRef.current;
    futureRef.current = rest;
    pastRef.current = [...pastRef.current, serialize(stateRef.current)];
    bump();
    return deserialize(snap);
  }, [bump]);

  return {
    canUndo: pastRef.current.length > 0,
    canRedo: futureRef.current.length > 0,
    revision,
    pushHistory,
    undo,
    redo,
  };
}
