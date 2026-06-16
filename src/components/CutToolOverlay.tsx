"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ActiveCutShapeKind,
  type CutDragState,
  type UserCut,
  createUserCutId,
  cutDimensionsLabel,
  hitTestCut,
  resolveCutDrag,
  translateCut,
} from "@/core/user-cuts";
import type { PanelProjection } from "@/core/cut-preview";
import type { ModelViewerHandle } from "@/components/ModelViewer";

/** Cached panel plane — used for O(1) ray-plane intersections during drag. */
interface PlaneCache {
  scenePoint: { x: number; y: number; z: number };
  projection: PanelProjection;
}

type DragMode =
  | { type: "create"; groupId: number; u0: number; v0: number; plane: PlaneCache }
  | { type: "move"; startU: number; startV: number; original: UserCut; latest: UserCut; plane: PlaneCache };

interface CutToolOverlayProps {
  active: boolean;
  shapeKind: ActiveCutShapeKind;
  userCuts: UserCut[];
  viewerRef: React.RefObject<ModelViewerHandle | null>;
  /** Throttled (rAF) — drives the 3D preview for both create and move. */
  onDraftChange: (draft: CutDragState | null) => void;
  /** Which cut is currently being moved (show it hidden at its old position). */
  onMovingCutId: (id: string | null) => void;
  /** Called once on pointer-up: new cut. */
  onCommitCut: (cut: UserCut) => void;
  /** Called once on pointer-up: moved cut. */
  onCommitMove: (cut: UserCut) => void;
}

// ── helpers ────────────────────────────────────────────────────────────────

function userCutToDraft(cut: UserCut): CutDragState {
  return {
    groupId: cut.groupId,
    kind: cut.kind,
    u0: cut.u0,
    v0: cut.v0,
    u1: cut.u1,
    v1: cut.v1,
    shiftKey: false,
  };
}

function minSize(
  kind: ActiveCutShapeKind,
  r: Pick<UserCut, "u0" | "v0" | "u1" | "v1">,
): number {
  if (kind === "line") return Math.hypot(r.u1 - r.u0, r.v1 - r.v0);
  return Math.min(Math.abs(r.u1 - r.u0), Math.abs(r.v1 - r.v0));
}

// ── component ──────────────────────────────────────────────────────────────

export default function CutToolOverlay({
  active,
  shapeKind,
  userCuts,
  viewerRef,
  onDraftChange,
  onMovingCutId,
  onCommitCut,
  onCommitMove,
}: CutToolOverlayProps) {
  // drag state stored in a ref — no re-renders during drag
  const dragRef = useRef<{ active: boolean; mode: DragMode } | null>(null);

  // rAF throttle for expensive parent updates
  const rafRef = useRef<number | null>(null);
  const latestDraftRef = useRef<CutDragState | null>(null);

  // Only used for label + cursor style — tiny component re-renders
  const [labelInfo, setLabelInfo] = useState<{
    cut: Pick<UserCut, "kind" | "u0" | "v0" | "u1" | "v1"> & { groupId: number };
    x: number;
    y: number;
    isMove: boolean;
  } | null>(null);

  // Flush draft to ModelViewer at most once per animation frame
  const scheduleDraft = useCallback(
    (draft: CutDragState | null) => {
      latestDraftRef.current = draft;
      if (draft === null) {
        if (rafRef.current != null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        onDraftChange(null);
        return;
      }
      if (rafRef.current != null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        onDraftChange(latestDraftRef.current);
      });
    },
    [onDraftChange],
  );

  // Cancel rAF on deactivation
  useEffect(() => {
    if (!active) {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      scheduleDraft(null);
      onMovingCutId(null);
      setLabelInfo(null);
    }
  }, [active, scheduleDraft, onMovingCutId]);

  // Hit-test existing cuts
  const findCutAt = useCallback(
    (groupId: number, u: number, v: number): UserCut | null => {
      const ps = viewerRef.current?.getPanelSize(groupId);
      if (!ps) return null;
      const onGroup = userCuts.filter((c) => c.groupId === groupId);
      for (let i = onGroup.length - 1; i >= 0; i--) {
        if (hitTestCut(onGroup[i], u, v, ps.widthM, ps.heightM)) return onGroup[i];
      }
      return null;
    },
    [userCuts, viewerRef],
  );

  // ── pointer down ──────────────────────────────────────────────────────────
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!active || e.button !== 0) return;
      if (document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-viewer-chrome]")) return;

      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);

      // Full raycast once — subsequent moves use cheap plane intersection
      const hit = viewerRef.current?.raycastPanelFull(e.clientX, e.clientY);
      if (!hit) return;

      const plane: PlaneCache = {
        scenePoint: hit.scenePoint,
        projection: hit.projection,
      };

      const existing = findCutAt(hit.groupId, hit.u, hit.v);

      if (existing) {
        // START MOVE — hide original, show draft at same position
        onMovingCutId(existing.id);
        scheduleDraft(userCutToDraft(existing));
        dragRef.current = {
          active: true,
          mode: { type: "move", startU: hit.u, startV: hit.v, original: existing, latest: existing, plane },
        };
        setLabelInfo({ cut: existing, x: e.clientX, y: e.clientY, isMove: true });
        return;
      }

      // START CREATE
      const initDraft: CutDragState = {
        groupId: hit.groupId,
        kind: shapeKind,
        u0: hit.u, v0: hit.v,
        u1: hit.u, v1: hit.v,
        shiftKey: e.shiftKey,
      };
      dragRef.current = {
        active: true,
        mode: { type: "create", groupId: hit.groupId, u0: hit.u, v0: hit.v, plane },
      };
      scheduleDraft(initDraft);
      setLabelInfo({
        cut: { ...initDraft, ...resolveCutDrag(initDraft) },
        x: e.clientX,
        y: e.clientY,
        isMove: false,
      });
    },
    [active, shapeKind, viewerRef, findCutAt, scheduleDraft, onMovingCutId],
  );

  // ── pointer move ──────────────────────────────────────────────────────────
  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current?.active) return;
      const mode = dragRef.current.mode;

      // O(1) plane intersection — no scene traversal during drag
      const uv = viewerRef.current?.getUVFromMouseOnPlane(
        e.clientX,
        e.clientY,
        mode.plane.scenePoint,
        mode.plane.projection,
      );

      if (mode.type === "move") {
        const u = uv ? uv.u : mode.startU;
        const v = uv ? uv.v : mode.startV;

        const moved = translateCut(mode.original, u - mode.startU, v - mode.startV);

        setLabelInfo({ cut: moved, x: e.clientX, y: e.clientY, isMove: true });
        scheduleDraft(userCutToDraft(moved));

        dragRef.current = {
          active: true,
          mode: { ...mode, latest: moved },
        };
        return;
      }

      // CREATE mode
      const u1 = uv ? uv.u : (latestDraftRef.current?.u1 ?? mode.u0);
      const v1 = uv ? uv.v : (latestDraftRef.current?.v1 ?? mode.v0);

      const draft: CutDragState = {
        groupId: mode.groupId,
        kind: shapeKind,
        u0: mode.u0, v0: mode.v0,
        u1, v1,
        shiftKey: e.shiftKey,
      };
      scheduleDraft(draft);
      setLabelInfo({
        cut: { ...draft, ...resolveCutDrag(draft) },
        x: e.clientX,
        y: e.clientY,
        isMove: false,
      });
    },
    [shapeKind, viewerRef, scheduleDraft],
  );

  // ── pointer up ────────────────────────────────────────────────────────────
  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current?.active) return;
      const mode = dragRef.current.mode;
      dragRef.current.active = false;

      // Capture draft BEFORE scheduleDraft(null) wipes latestDraftRef
      const committedDraft = latestDraftRef.current;

      setLabelInfo(null);
      scheduleDraft(null);

      if (mode.type === "move") {
        onMovingCutId(null);
        onCommitMove(mode.latest);
        return;
      }

      // CREATE — use the captured value
      if (!committedDraft) return;

      const resolved = resolveCutDrag({ ...committedDraft, shiftKey: e.shiftKey });
      if (minSize(shapeKind, resolved) < 0.05) return;

      onCommitCut({
        id: createUserCutId(),
        groupId: committedDraft.groupId,
        kind: shapeKind,
        ...resolved,
      });
    },
    [shapeKind, onCommitCut, onCommitMove, onMovingCutId, scheduleDraft],
  );

  // ── cursor: show "move" pointer when hovering over a committed cut ─────────
  // (no expensive raycast on hover — just show crosshair always, upgrade on drag)
  const isDraggingMove = dragRef.current?.active && dragRef.current.mode.type === "move";

  if (!active) return null;

  const panelSize =
    labelInfo != null
      ? viewerRef.current?.getPanelSize(labelInfo.cut.groupId) ?? undefined
      : undefined;

  const label = labelInfo ? cutDimensionsLabel(labelInfo.cut, panelSize) : null;

  return (
    <>
      <div
        className="absolute inset-0 z-20"
        style={{ cursor: isDraggingMove ? "grabbing" : "crosshair" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
      {label && labelInfo && (
        <div
          className="fixed z-30 pointer-events-none px-2.5 py-1.5 rounded-xl bg-base-100/96 border border-warning/50 shadow-lg text-sm font-mono text-warning max-w-xs leading-snug"
          style={{ left: labelInfo.x + 16, top: labelInfo.y + 16 }}
        >
          {label}
          {labelInfo.isMove && (
            <span className="block text-[11px] text-base-content/50 mt-0.5 font-sans">
              Soltá para confirmar · Ctrl+Z deshace
            </span>
          )}
        </div>
      )}
    </>
  );
}
