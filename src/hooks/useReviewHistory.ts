import { useCallback, useRef, useState } from "react";
import type { FaceCategory } from "@/core/group-classifier";
import type { Phase1Result } from "@/core/pipeline";
import type { UserCut } from "@/core/user-cuts";

export interface ReviewHistoryState {
  overrides: Map<number, FaceCategory>;
  merges: number[][];
  hiddenGroupIds: Set<number>;
  wallWallDecisions: Map<number, number>;
  manualPhase1: Phase1Result | null;
  userCuts: UserCut[];
}

interface SerializedSnapshot {
  overrides: [number, FaceCategory][];
  merges: number[][];
  hiddenGroupIds: number[];
  wallWallDecisions: [number, number][];
  manualPhase1: Phase1Result | null;
  userCuts: UserCut[];
}

const MAX_HISTORY = 50;

function serialize(state: ReviewHistoryState): string {
  const payload: SerializedSnapshot = {
    overrides: Array.from(state.overrides.entries()),
    merges: state.merges,
    hiddenGroupIds: Array.from(state.hiddenGroupIds),
    wallWallDecisions: Array.from(state.wallWallDecisions.entries()),
    manualPhase1: state.manualPhase1,
    userCuts: state.userCuts,
  };
  return JSON.stringify(payload);
}

function deserialize(raw: string): ReviewHistoryState {
  const payload = JSON.parse(raw) as SerializedSnapshot;
  return {
    overrides: new Map(payload.overrides),
    merges: payload.merges,
    hiddenGroupIds: new Set(payload.hiddenGroupIds),
    wallWallDecisions: new Map(payload.wallWallDecisions),
    manualPhase1: payload.manualPhase1,
    userCuts: payload.userCuts ?? [],
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
