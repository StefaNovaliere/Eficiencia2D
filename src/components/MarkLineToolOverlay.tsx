"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  createMarkLineId,
  markLineLengthM,
  simplifyPolyline,
  MIN_MARK_LINE_M,
  type MarkLine,
  type MarkLinePoint,
} from "@/core/mark-lines";
import type { PanelProjection } from "@/core/cut-preview";
import { snapPointToPanelEdges } from "@/core/user-cuts";
import type { ModelViewerHandle } from "@/components/ModelViewer";

export type MarkLineMode = "straight" | "freehand";

interface MarkLineToolOverlayProps {
  active: boolean;
  mode: MarkLineMode;
  edgeSnapEnabled: boolean;
  viewerRef: React.RefObject<ModelViewerHandle | null>;
  onDraftChange: (line: MarkLine | null) => void;
  onCommit: (line: MarkLine) => void;
}

/** Distancia mínima (m panel) entre puntos muestreados en mano alzada. */
const FREEHAND_MIN_STEP_M = 0.01;
/** Tolerancia del RDP para limpiar el trazo libre (m panel). */
const FREEHAND_SIMPLIFY_TOL_M = 0.004;

/** Restringe el extremo a horizontal/vertical respecto del inicio (Shift). */
function orthoConstrain(u0: number, v0: number, u1: number, v1: number): MarkLinePoint {
  return Math.abs(u1 - u0) >= Math.abs(v1 - v0) ? { u: u1, v: v0 } : { u: u0, v: v1 };
}

export default function MarkLineToolOverlay({
  active,
  mode,
  edgeSnapEnabled,
  viewerRef,
  onDraftChange,
  onCommit,
}: MarkLineToolOverlayProps) {
  const dragRef = useRef<{
    active: boolean;
    groupId: number;
    scenePoint: { x: number; y: number; z: number };
    projection: PanelProjection;
    u0: number;
    v0: number;
    points: MarkLinePoint[]; // freehand
  } | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const latestRef = useRef<MarkLine | null>(null);

  const scheduleDraft = useCallback(
    (line: MarkLine | null) => {
      latestRef.current = line;
      if (line === null) {
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
        onDraftChange(latestRef.current);
      });
    },
    [onDraftChange],
  );

  useEffect(() => {
    if (!active) {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      dragRef.current = null;
      scheduleDraft(null);
    }
  }, [active, scheduleDraft]);

  // Reenvía el botón central (paneo) al canvas, como el resto de las herramientas.
  const handleMiddleMouse = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    overlay.style.pointerEvents = "none";
    const canvas = overlay.parentElement?.querySelector("canvas");
    canvas?.dispatchEvent(
      new PointerEvent("pointerdown", {
        pointerId: e.nativeEvent.pointerId,
        clientX: e.clientX,
        clientY: e.clientY,
        button: 1,
        buttons: 4,
        bubbles: true,
        cancelable: true,
        pointerType: e.nativeEvent.pointerType,
        isPrimary: e.nativeEvent.isPrimary,
      }),
    );
    window.addEventListener(
      "pointerup",
      () => {
        overlay.style.pointerEvents = "";
      },
      { once: true },
    );
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

      const hit = viewerRef.current?.raycastMeasure(e.clientX, e.clientY);
      if (!hit) return;

      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);

      const ps = viewerRef.current?.getDisplayPanelSize(hit.hitGroupId);
      const start =
        mode === "straight" && ps
          ? snapPointToPanelEdges(hit.u, hit.v, ps, edgeSnapEnabled)
          : { u: hit.u, v: hit.v };

      dragRef.current = {
        active: true,
        groupId: hit.hitGroupId,
        scenePoint: hit.scenePoint,
        projection: hit.projection,
        u0: start.u,
        v0: start.v,
        points: [{ u: start.u, v: start.v }],
      };
      scheduleDraft({
        id: "__draft__",
        groupId: hit.hitGroupId,
        points: [{ u: start.u, v: start.v }, { u: start.u, v: start.v }],
      });
    },
    [active, mode, edgeSnapEnabled, viewerRef, handleMiddleMouse, scheduleDraft],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag?.active) return;

      const uv = viewerRef.current?.getUVFromMouseOnPlane(
        e.clientX,
        e.clientY,
        drag.scenePoint,
        drag.projection,
      );
      if (!uv) return;

      if (mode === "freehand") {
        const last = drag.points[drag.points.length - 1];
        if (Math.hypot(uv.u - last.u, uv.v - last.v) >= FREEHAND_MIN_STEP_M) {
          drag.points.push({ u: uv.u, v: uv.v });
        }
        scheduleDraft({ id: "__draft__", groupId: drag.groupId, points: [...drag.points, uv] });
      } else {
        let end: MarkLinePoint = uv;
        if (e.shiftKey) end = orthoConstrain(drag.u0, drag.v0, uv.u, uv.v);
        const ps = viewerRef.current?.getDisplayPanelSize(drag.groupId);
        if (ps && edgeSnapEnabled) end = snapPointToPanelEdges(end.u, end.v, ps, true);
        scheduleDraft({
          id: "__draft__",
          groupId: drag.groupId,
          points: [{ u: drag.u0, v: drag.v0 }, end],
        });
      }
    },
    [mode, edgeSnapEnabled, viewerRef, scheduleDraft],
  );

  const handlePointerUp = useCallback(() => {
    const drag = dragRef.current;
    if (!drag?.active) return;
    drag.active = false;
    const draft = latestRef.current;
    scheduleDraft(null);
    if (!draft) return;

    const points =
      mode === "freehand" ? simplifyPolyline(draft.points, FREEHAND_SIMPLIFY_TOL_M) : draft.points;
    if (points.length < 2 || markLineLengthM(points) < MIN_MARK_LINE_M) return;

    onCommit({ id: createMarkLineId(), groupId: draft.groupId, points });
  }, [mode, onCommit, scheduleDraft]);

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
