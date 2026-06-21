"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ActiveCutShapeKind,
  type CutDragState,
  type UserCut,
  createUserCutId,
  cutDimensionsLabel,
  findCutAtPoint,
  panelEdgeSnapHints,
  resolveCutDrag,
  snapCutDragToPanelEdges,
  snapPointToPanelEdges,
  translateCut,
  MIN_CUT_COMMIT_SIZE_M,
} from "@/core/user-cuts";
import type { PanelProjection } from "@/core/cut-preview";
import type { ModelViewerHandle } from "@/components/ModelViewer";

/** Cached panel plane — used for O(1) ray-plane intersections during drag. */
interface PlaneCache {
  scenePoint: { x: number; y: number; z: number };
  projection: PanelProjection;
  surfaceNormal: { x: number; y: number; z: number };
  surfaceOffset: number;
}

type DragMode =
  | { type: "create"; groupId: number; u0: number; v0: number; plane: PlaneCache }
  | { type: "move"; startU: number; startV: number; original: UserCut; latest: UserCut; plane: PlaneCache };

interface CutToolOverlayProps {
  active: boolean;
  shapeKind: ActiveCutShapeKind;
  /** Sticky snap to panel edges (full-width / full-height cuts). Alt temporarily disables. */
  edgeSnapEnabled: boolean;
  userCuts: UserCut[];
  selectedCutId: string | null;
  onSelectedCutIdChange: (id: string | null) => void;
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
    surfaceNormal: cut.surfaceNormal,
    surfaceOffset: cut.surfaceOffset,
  };
}

function minSize(
  kind: ActiveCutShapeKind,
  r: Pick<UserCut, "u0" | "v0" | "u1" | "v1">,
): number {
  if (kind === "line") return Math.hypot(r.u1 - r.u0, r.v1 - r.v0);
  return Math.min(Math.abs(r.u1 - r.u0), Math.abs(r.v1 - r.v0));
}

const MIN_COMMIT_SIZE_M = MIN_CUT_COMMIT_SIZE_M;

// ── component ──────────────────────────────────────────────────────────────

export default function CutToolOverlay({
  active,
  shapeKind,
  edgeSnapEnabled,
  userCuts,
  selectedCutId,
  onSelectedCutIdChange,
  viewerRef,
  onDraftChange,
  onMovingCutId,
  onCommitCut,
  onCommitMove,
}: CutToolOverlayProps) {
  // drag state stored in a ref — no re-renders during drag
  const dragRef = useRef<{ active: boolean; mode: DragMode } | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // rAF throttle for expensive parent updates
  const rafRef = useRef<number | null>(null);
  const latestDraftRef = useRef<CutDragState | null>(null);

  // Only used for label + cursor style — tiny component re-renders
  const [labelInfo, setLabelInfo] = useState<{
    cut: Pick<UserCut, "kind" | "u0" | "v0" | "u1" | "v1"> & { groupId: number };
    x: number;
    y: number;
    isMove: boolean;
    hoverOnly: boolean;
    snapActive: boolean;
    edgeHints: { left: boolean; right: boolean; bottom: boolean; top: boolean } | null;
  } | null>(null);

  const [altHeld, setAltHeld] = useState(false);
  const [hoverCutId, setHoverCutId] = useState<string | null>(null);
  const hoverRafRef = useRef<number | null>(null);

  const snapActive = edgeSnapEnabled && !altHeld;

  useEffect(() => {
    if (!active) {
      setAltHeld(false);
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Alt") setAltHeld(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Alt") setAltHeld(false);
    };
    const onBlur = () => setAltHeld(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [active]);

  const snapDraft = useCallback(
    (draft: CutDragState): CutDragState => {
      const ps = viewerRef.current?.getPanelSize(draft.groupId);
      if (!ps) return draft;
      return snapCutDragToPanelEdges(draft, ps, snapActive);
    },
    [viewerRef, snapActive],
  );

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
      if (hoverRafRef.current != null) {
        cancelAnimationFrame(hoverRafRef.current);
        hoverRafRef.current = null;
      }
      scheduleDraft(null);
      onMovingCutId(null);
      setLabelInfo(null);
      setHoverCutId(null);
    }
  }, [active, scheduleDraft, onMovingCutId]);

  const findCutAt = useCallback(
    (groupId: number, u: number, v: number, forceCreate: boolean): UserCut | null => {
      const ps = viewerRef.current?.getPanelSize(groupId);
      if (!ps) return null;
      return findCutAtPoint(userCuts, groupId, u, v, ps.widthM, ps.heightM, {
        forceCreate,
        preferredId: selectedCutId,
      });
    },
    [userCuts, viewerRef, selectedCutId],
  );

  // ── middle mouse: forward to canvas so CameraControls can pan/dolly ──────
  const handleMiddleMouse = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const overlay = overlayRef.current;
      if (!overlay) return;

      // Disable pointer events so subsequent pointermove/up reach the canvas
      overlay.style.pointerEvents = "none";

      // Find the Three.js canvas and dispatch a synthetic pointerdown to it
      const canvas = overlay.parentElement?.querySelector("canvas");
      if (canvas) {
        canvas.dispatchEvent(
          new PointerEvent("pointerdown", {
            pointerId: e.nativeEvent.pointerId,
            clientX: e.clientX,
            clientY: e.clientY,
            screenX: e.nativeEvent.screenX,
            screenY: e.nativeEvent.screenY,
            button: 1,
            buttons: 4,
            bubbles: true,
            cancelable: true,
            pressure: e.nativeEvent.pressure,
            pointerType: e.nativeEvent.pointerType,
            isPrimary: e.nativeEvent.isPrimary,
          }),
        );
      }

      // Restore pointer events once the middle button is released
      const restore = () => {
        overlay.style.pointerEvents = "";
        window.removeEventListener("pointerup", restore);
      };
      window.addEventListener("pointerup", restore, { once: true });
    },
    [],
  );

  // ── pointer down ──────────────────────────────────────────────────────────
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!active) return;
      if (e.button === 1) { handleMiddleMouse(e); return; }
      if (e.button !== 0) return;
      if (document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-viewer-chrome]")) return;

      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);

      // Full raycast once — subsequent moves use cheap plane intersection
      const hit = viewerRef.current?.raycastPanelFull(e.clientX, e.clientY);
      if (!hit) return;

      const plane: PlaneCache = {
        scenePoint: hit.scenePoint,
        projection: hit.projection,
        surfaceNormal: hit.surfaceNormal,
        surfaceOffset: hit.surfaceOffset,
      };

      const forceCreate = altHeld;
      const existing = findCutAt(hit.groupId, hit.u, hit.v, forceCreate);

      const panelSize = viewerRef.current?.getPanelSize(hit.groupId);
      const startUv =
        panelSize != null
          ? snapPointToPanelEdges(hit.u, hit.v, panelSize, snapActive)
          : { u: hit.u, v: hit.v };

      if (existing) {
        // START MOVE — hide original, show draft at same position
        onSelectedCutIdChange(existing.id);
        onMovingCutId(existing.id);
        scheduleDraft(userCutToDraft(existing));
        dragRef.current = {
          active: true,
          mode: {
            type: "move",
            startU: startUv.u,
            startV: startUv.v,
            original: existing,
            latest: existing,
            plane: {
              scenePoint: hit.scenePoint,
              projection: hit.projection,
              surfaceNormal: existing.surfaceNormal ?? hit.surfaceNormal,
              surfaceOffset: existing.surfaceOffset ?? hit.surfaceOffset,
            },
          },
        };
        setLabelInfo({
          cut: existing,
          x: e.clientX,
          y: e.clientY,
          isMove: true,
          hoverOnly: false,
          snapActive,
          edgeHints: panelSize ? panelEdgeSnapHints(startUv.u, startUv.v, panelSize) : null,
        });
        return;
      }

      // START CREATE
      onSelectedCutIdChange(null);
      const initDraft: CutDragState = snapDraft({
        groupId: hit.groupId,
        kind: shapeKind,
        u0: startUv.u,
        v0: startUv.v,
        u1: startUv.u,
        v1: startUv.v,
        shiftKey: e.shiftKey,
        surfaceNormal: hit.surfaceNormal,
        surfaceOffset: hit.surfaceOffset,
      });
      dragRef.current = {
        active: true,
        mode: { type: "create", groupId: hit.groupId, u0: startUv.u, v0: startUv.v, plane },
      };
      scheduleDraft(initDraft);
      setLabelInfo({
        cut: { ...initDraft, ...resolveCutDrag(initDraft) },
        x: e.clientX,
        y: e.clientY,
        isMove: false,
        hoverOnly: false,
        snapActive,
        edgeHints: panelSize ? panelEdgeSnapHints(startUv.u, startUv.v, panelSize) : null,
      });
    },
    [active, shapeKind, viewerRef, findCutAt, scheduleDraft, onMovingCutId, onSelectedCutIdChange, handleMiddleMouse, snapActive, snapDraft, altHeld],
  );

  // ── pointer move ──────────────────────────────────────────────────────────
  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current?.active) {
        if (!active) return;
        if (document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-viewer-chrome]")) {
          setLabelInfo(null);
          return;
        }
        if (hoverRafRef.current != null) return;
        hoverRafRef.current = requestAnimationFrame(() => {
          hoverRafRef.current = null;
          const hit = viewerRef.current?.raycastPanelFull(e.clientX, e.clientY);
          if (!hit) {
            setLabelInfo(null);
            setHoverCutId(null);
            return;
          }
          const ps = viewerRef.current?.getPanelSize(hit.groupId);
          if (!ps) {
            setLabelInfo(null);
            setHoverCutId(null);
            return;
          }
          const snapped = snapPointToPanelEdges(hit.u, hit.v, ps, snapActive);
          const hoverCut = findCutAt(hit.groupId, snapped.u, snapped.v, altHeld);
          setHoverCutId(hoverCut?.id ?? null);

          if (hoverCut) {
            setLabelInfo({
              cut: hoverCut,
              x: e.clientX,
              y: e.clientY,
              isMove: true,
              hoverOnly: true,
              snapActive,
              edgeHints: null,
            });
            return;
          }

          const hints = panelEdgeSnapHints(snapped.u, snapped.v, ps);
          const nearEdge = hints.left || hints.right || hints.bottom || hints.top;
          if (!nearEdge && !snapActive) {
            setLabelInfo(null);
            return;
          }
          setLabelInfo({
            cut: {
              groupId: hit.groupId,
              kind: shapeKind,
              u0: snapped.u,
              v0: snapped.v,
              u1: snapped.u,
              v1: snapped.v,
            },
            x: e.clientX,
            y: e.clientY,
            isMove: false,
            hoverOnly: true,
            snapActive,
            edgeHints: nearEdge ? hints : null,
          });
        });
        return;
      }

      const mode = dragRef.current.mode;

      // O(1) plane intersection — no scene traversal during drag
      const uv = viewerRef.current?.getUVFromMouseOnPlane(
        e.clientX,
        e.clientY,
        mode.plane.scenePoint,
        mode.plane.projection,
        mode.plane.surfaceNormal,
      );

      const ps = viewerRef.current?.getPanelSize(
        mode.type === "move" ? mode.original.groupId : mode.groupId,
      );

      if (mode.type === "move") {
        const u = uv ? uv.u : mode.startU;
        const v = uv ? uv.v : mode.startV;

        const moved = translateCut(mode.original, u - mode.startU, v - mode.startV);
        const snapped = snapDraft(userCutToDraft(moved));

        setLabelInfo({
          cut: snapped,
          x: e.clientX,
          y: e.clientY,
          isMove: true,
          hoverOnly: false,
          snapActive,
          edgeHints: ps ? panelEdgeSnapHints(snapped.u0, snapped.v0, ps) : null,
        });
        scheduleDraft(snapped);

        dragRef.current = {
          active: true,
          mode: { ...mode, latest: { ...moved, ...snapped } },
        };
        return;
      }

      // CREATE mode
      const u1 = uv ? uv.u : (latestDraftRef.current?.u1 ?? mode.u0);
      const v1 = uv ? uv.v : (latestDraftRef.current?.v1 ?? mode.v0);

      const draft = snapDraft({
        groupId: mode.groupId,
        kind: shapeKind,
        u0: mode.u0,
        v0: mode.v0,
        u1,
        v1,
        shiftKey: e.shiftKey,
        surfaceNormal: mode.plane.surfaceNormal,
        surfaceOffset: mode.plane.surfaceOffset,
      });
      scheduleDraft(draft);
      const resolved = resolveCutDrag(draft);
      setLabelInfo({
        cut: { ...draft, ...resolved },
        x: e.clientX,
        y: e.clientY,
        isMove: false,
        hoverOnly: false,
        snapActive,
        edgeHints: ps
          ? panelEdgeSnapHints(resolved.u1, resolved.v1, ps)
          : null,
      });
    },
    [active, shapeKind, viewerRef, scheduleDraft, snapActive, snapDraft, findCutAt, altHeld],
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
        const orig = mode.original;
        const latest = mode.latest;
        const moved =
          latest.u0 !== orig.u0 ||
          latest.v0 !== orig.v0 ||
          latest.u1 !== orig.u1 ||
          latest.v1 !== orig.v1;
        if (moved) {
          onCommitMove(latest);
        }
        onSelectedCutIdChange(latest.id);
        return;
      }

      // CREATE — use the captured value
      if (!committedDraft) return;

      const snapped = snapDraft({ ...committedDraft, shiftKey: e.shiftKey });
      const resolved = resolveCutDrag({ ...snapped, shiftKey: e.shiftKey });
      if (minSize(shapeKind, resolved) < MIN_COMMIT_SIZE_M) return;

      onCommitCut({
        id: createUserCutId(),
        groupId: snapped.groupId,
        kind: shapeKind,
        ...resolved,
        surfaceNormal: snapped.surfaceNormal,
        surfaceOffset: snapped.surfaceOffset,
      });
    },
    [shapeKind, onCommitCut, onCommitMove, onMovingCutId, onSelectedCutIdChange, scheduleDraft, snapDraft],
  );

  const isDraggingMove = dragRef.current?.active && dragRef.current.mode.type === "move";
  const isHoveringCut = hoverCutId != null && !isDraggingMove;
  const nearEdgeHover =
    labelInfo?.edgeHints != null &&
    (labelInfo.edgeHints.left ||
      labelInfo.edgeHints.right ||
      labelInfo.edgeHints.bottom ||
      labelInfo.edgeHints.top);

  if (!active) return null;

  const panelSize =
    labelInfo != null
      ? viewerRef.current?.getPanelSize(labelInfo.cut.groupId) ?? undefined
      : undefined;

  const label = labelInfo ? cutDimensionsLabel(labelInfo.cut, panelSize) : null;
  const isHoverOnly = labelInfo != null && labelInfo.hoverOnly;

  const edgeHintLabel = (() => {
    const h = labelInfo?.edgeHints;
    if (!h) return null;
    const parts: string[] = [];
    if (h.left) parts.push("izq");
    if (h.right) parts.push("der");
    if (h.bottom) parts.push("abajo");
    if (h.top) parts.push("arriba");
    return parts.length > 0 ? parts.join(" · ") : null;
  })();

  return (
    <>
      <div
        ref={overlayRef}
        className="absolute inset-0 z-20"
        style={{
          cursor: isDraggingMove
            ? "grabbing"
            : isHoveringCut
              ? "grab"
              : nearEdgeHover && snapActive
                ? "cell"
                : "crosshair",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => {
          if (!dragRef.current?.active) {
            setLabelInfo(null);
            setHoverCutId(null);
          }
        }}
      />
      {label && labelInfo && (
        <div
          className={`fixed z-30 pointer-events-none px-2.5 py-1.5 rounded-xl bg-base-100/96 border shadow-lg text-sm font-mono max-w-xs leading-snug ${
            snapActive ? "border-warning/50 text-warning" : "border-base-300/60 text-base-content/80"
          }`}
          style={{ left: labelInfo.x + 16, top: labelInfo.y + 16 }}
        >
          {isHoverOnly ? (
            <span className="text-[11px] font-sans text-base-content/70">
              {labelInfo.isMove
                ? "Arrastrá para mover el corte · Alt+clic para dibujar encima"
                : snapActive
                  ? edgeHintLabel
                    ? `Borde ${edgeHintLabel} — soltá acá para cortar completo`
                    : "Acercate a un borde para guiar el corte"
                  : "Modo libre — el corte no pegará a los bordes"}
            </span>
          ) : (
            label
          )}
          {labelInfo.isMove && !isHoverOnly && (
            <span className="block text-[11px] text-base-content/50 mt-0.5 font-sans">
              Soltá para confirmar · Alt+clic dibuja encima · Ctrl+Z deshace
            </span>
          )}
          {!labelInfo.isMove && !isHoverOnly && snapActive && edgeHintLabel && (
            <span className="block text-[11px] text-warning/70 mt-0.5 font-sans">
              Pegado a {edgeHintLabel}
            </span>
          )}
          {!labelInfo.isMove && !isHoverOnly && altHeld && (
            <span className="block text-[11px] text-base-content/50 mt-0.5 font-sans">
              Alt — corte libre (puerta / ventana)
            </span>
          )}
        </div>
      )}
    </>
  );
}
