import { useCallback, useRef, useState } from "react";
import type { FaceCategory } from "@/core/group-classifier";

// Sólo se versiona el estado de etiquetado client-side (categorías, ocultos,
// decisiones de unión). Eje/área/merges/splits viven en el backend (recompute).
export interface ReviewHistoryState {
  overrides: Map<number, FaceCategory>;
  hiddenGroupIds: Set<number>;
  wallWallDecisions: Map<number, number>;
}

interface SerializedSnapshot {
  overrides: [number, FaceCategory][];
  hiddenGroupIds: number[];
  wallWallDecisions: [number, number][];
}

const MAX_HISTORY = 50;

function serialize(state: ReviewHistoryState): string {
  const payload: SerializedSnapshot = {
    overrides: Array.from(state.overrides.entries()),
    hiddenGroupIds: Array.from(state.hiddenGroupIds),
    wallWallDecisions: Array.from(state.wallWallDecisions.entries()),
  };
  return JSON.stringify(payload);
}

function deserialize(raw: string): ReviewHistoryState {
  const payload = JSON.parse(raw) as SerializedSnapshot;
  return {
    overrides: new Map(payload.overrides),
    hiddenGroupIds: new Set(payload.hiddenGroupIds),
    wallWallDecisions: new Map(payload.wallWallDecisions),
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
