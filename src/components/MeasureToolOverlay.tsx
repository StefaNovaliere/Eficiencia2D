"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  createMeasureId,
  minMeasureSize,
  resolveMeasureDrag,
  type MeasureDragState,
  type MeasureShapeKind,
  type UserMeasure,
} from "@/core/measure-tool";
import type { PanelProjection } from "@/core/cut-preview";
import {
  snapCutDragToPanelEdges,
  snapPointToPanelEdges,
  type CutDragState,
} from "@/core/user-cuts";
import type { ModelViewerHandle } from "@/components/ModelViewer";

interface PlaneCache {
  scenePoint: { x: number; y: number; z: number };
  projection: PanelProjection;
}

interface MeasureToolOverlayProps {
  active: boolean;
  shapeKind: MeasureShapeKind;
  edgeSnapEnabled: boolean;
  viewerRef: React.RefObject<ModelViewerHandle | null>;
  onDraftChange: (draft: MeasureDragState | null) => void;
  onCommitMeasure: (measure: UserMeasure) => void;
}

function measureToCutDraft(state: MeasureDragState): CutDragState {
  return {
    groupId: state.groupId,
    kind: state.kind,
    u0: state.u0,
    v0: state.v0,
    u1: state.u1,
    v1: state.v1,
    shiftKey: state.shiftKey,
  };
}

export default function MeasureToolOverlay({
  active,
  shapeKind,
  edgeSnapEnabled,
  viewerRef,
  onDraftChange,
  onCommitMeasure,
}: MeasureToolOverlayProps) {
  const dragRef = useRef<{
    active: boolean;
    groupId: number;
    u0: number;
    v0: number;
    plane: PlaneCache;
    shiftKey: boolean;
  } | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const latestDraftRef = useRef<MeasureDragState | null>(null);
  const altHeldRef = useRef(false);

  const snapActive = edgeSnapEnabled && !altHeldRef.current;

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Alt") altHeldRef.current = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Alt") altHeldRef.current = false;
    };
    const onBlur = () => {
      altHeldRef.current = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      altHeldRef.current = false;
    };
  }, [active]);

  const scheduleDraft = useCallback(
    (draft: MeasureDragState | null) => {
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

  useEffect(() => {
    if (!active) {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      scheduleDraft(null);
    }
  }, [active, scheduleDraft]);

  const snapMeasure = useCallback(
    (draft: MeasureDragState): MeasureDragState => {
      const ps = viewerRef.current?.getDisplayPanelSize(draft.groupId);
      if (!ps) return draft;
      const snapped = snapCutDragToPanelEdges(measureToCutDraft(draft), ps, snapActive);
      return { ...draft, u0: snapped.u0, v0: snapped.v0, u1: snapped.u1, v1: snapped.v1 };
    },
    [viewerRef, snapActive],
  );

  const handleMiddleMouse = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    overlay.style.pointerEvents = "none";
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
    const restore = () => {
      overlay.style.pointerEvents = "";
      window.removeEventListener("pointerup", restore);
    };
    window.addEventListener("pointerup", restore, { once: true });
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!active) return;
      if (e.button === 1) {
        handleMiddleMouse(e);
        return;
      }
      if (e.button !== 0) return;
      if (document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-viewer-chrome]")) return;

      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);

      const hit = viewerRef.current?.raycastMeasure(e.clientX, e.clientY);
      if (!hit) return;

      const ps = viewerRef.current?.getDisplayPanelSize(hit.hitGroupId);
      const start = ps
        ? snapPointToPanelEdges(hit.u, hit.v, ps, snapActive)
        : { u: hit.u, v: hit.v };

      dragRef.current = {
        active: true,
        groupId: hit.hitGroupId,
        u0: start.u,
        v0: start.v,
        plane: { scenePoint: hit.scenePoint, projection: hit.projection },
        shiftKey: e.shiftKey,
      };

      scheduleDraft(
        snapMeasure({
          groupId: hit.hitGroupId,
          kind: shapeKind,
          u0: start.u,
          v0: start.v,
          u1: start.u,
          v1: start.v,
          shiftKey: e.shiftKey,
        }),
      );
    },
    [active, shapeKind, viewerRef, handleMiddleMouse, snapActive, snapMeasure, scheduleDraft],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current?.active) return;

      const drag = dragRef.current;
      const uv = viewerRef.current?.getUVFromMouseOnPlane(
        e.clientX,
        e.clientY,
        drag.plane.scenePoint,
        drag.plane.projection,
      );
      const u1 = uv ? uv.u : (latestDraftRef.current?.u1 ?? drag.u0);
      const v1 = uv ? uv.v : (latestDraftRef.current?.v1 ?? drag.v0);

      scheduleDraft(
        snapMeasure({
          groupId: drag.groupId,
          kind: shapeKind,
          u0: drag.u0,
          v0: drag.v0,
          u1,
          v1,
          shiftKey: e.shiftKey,
        }),
      );
    },
    [shapeKind, viewerRef, scheduleDraft, snapMeasure],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current?.active) return;
      dragRef.current.active = false;

      const draft = latestDraftRef.current;
      scheduleDraft(null);

      if (!draft) return;

      const resolved = resolveMeasureDrag({ ...draft, shiftKey: e.shiftKey });
      if (minMeasureSize(shapeKind, resolved) < 0.03) return;

      onCommitMeasure({
        id: createMeasureId(),
        groupId: draft.groupId,
        kind: shapeKind,
        ...resolved,
        shiftKey: e.shiftKey,
      });
    },
    [shapeKind, onCommitMeasure, scheduleDraft],
  );

  if (!active) return null;

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 z-20"
      style={{ cursor: "crosshair" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    />
  );
}
