"use client";

/**
 * Angle measurement (protractor) overlay.
 * Uses a 3-click model:
 *   Click 1 → vertex (corner of the angle)
 *   Click 2 → end of arm 1
 *   Click 3 → end of arm 2 → commits the angle
 *
 * While placing, middle-mouse is forwarded to the canvas for orbiting.
 * Escape cancels the current placement and resets to idle.
 */

import { useCallback, useEffect, useRef } from "react";
import {
  createAngleMeasureId,
  MIN_ANGLE_ARM_LENGTH,
  type AngleDraftState,
  type UserAngleMeasure,
} from "@/core/angle-measure";
import type { ModelViewerHandle } from "@/components/ModelViewer";

interface AngleMeasureOverlayProps {
  active: boolean;
  viewerRef: React.RefObject<ModelViewerHandle | null>;
  onDraftChange: (draft: AngleDraftState | null) => void;
  onCommit: (measure: UserAngleMeasure) => void;
}

type ClickPhase = "idle" | "placingArm1" | "placingArm2";

export default function AngleMeasureOverlay({
  active,
  viewerRef,
  onDraftChange,
  onCommit,
}: AngleMeasureOverlayProps) {
  const phaseRef = useRef<ClickPhase>("idle");
  const draftRef = useRef<AngleDraftState | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const latestDraftRef = useRef<AngleDraftState | null>(null);

  const flushDraft = useCallback((draft: AngleDraftState | null) => {
    latestDraftRef.current = draft;
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      draftRef.current = latestDraftRef.current;
      onDraftChange(latestDraftRef.current);
    });
  }, [onDraftChange]);

  const clearDraft = useCallback(() => {
    latestDraftRef.current = null;
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    draftRef.current = null;
    onDraftChange(null);
  }, [onDraftChange]);

  // Reset when tool is deactivated
  useEffect(() => {
    if (!active) {
      phaseRef.current = "idle";
      clearDraft();
    }
  }, [active, clearDraft]);

  // Escape → cancel current placement
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && phaseRef.current !== "idle") {
        phaseRef.current = "idle";
        clearDraft();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, clearDraft]);

  const forwardMiddleMouse = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
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

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!active || phaseRef.current === "idle") return;

      const hit = viewerRef.current?.raycastMeasure(e.clientX, e.clientY);
      const current = latestDraftRef.current;
      if (!hit || !current || hit.hitGroupId !== current.groupId) return;

      flushDraft({ ...current, cursor: { u: hit.u, v: hit.v } });
    },
    [active, viewerRef, flushDraft],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!active) return;
      if (e.button === 1) { forwardMiddleMouse(e); return; }
      if (e.button !== 0) return;
      if (document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-viewer-chrome]")) return;

      e.preventDefault();

      const hit = viewerRef.current?.raycastMeasure(e.clientX, e.clientY);
      if (!hit) return;

      const uv = { u: hit.u, v: hit.v };

      if (phaseRef.current === "idle") {
        // 1st click — place vertex
        phaseRef.current = "placingArm1";
        const draft: AngleDraftState = { groupId: hit.hitGroupId, vertex: uv, cursor: uv };
        latestDraftRef.current = draft;
        draftRef.current = draft;
        onDraftChange(draft);

      } else if (phaseRef.current === "placingArm1") {
        const current = draftRef.current;
        if (!current || hit.hitGroupId !== current.groupId) return;
        const armLen = Math.hypot(uv.u - current.vertex.u, uv.v - current.vertex.v);
        if (armLen < MIN_ANGLE_ARM_LENGTH) return;

        // 2nd click — place arm 1
        phaseRef.current = "placingArm2";
        const draft: AngleDraftState = { ...current, arm1: uv, cursor: uv };
        latestDraftRef.current = draft;
        draftRef.current = draft;
        onDraftChange(draft);

      } else if (phaseRef.current === "placingArm2") {
        const current = draftRef.current;
        if (!current?.arm1 || hit.hitGroupId !== current.groupId) return;
        const armLen = Math.hypot(uv.u - current.vertex.u, uv.v - current.vertex.v);
        if (armLen < MIN_ANGLE_ARM_LENGTH) return;

        // 3rd click — commit
        onCommit({
          id: createAngleMeasureId(),
          groupId: current.groupId,
          vertex: current.vertex,
          arm1: current.arm1,
          arm2: uv,
        });

        // Reset for placing the next angle immediately
        phaseRef.current = "idle";
        clearDraft();
      }
    },
    [active, viewerRef, forwardMiddleMouse, onDraftChange, onCommit, clearDraft],
  );

  if (!active) return null;

  // Crosshair cursor in all phases; show "+" to indicate click-based interaction
  const cursorStyle =
    phaseRef.current === "idle"       ? "crosshair" :
    phaseRef.current === "placingArm1" ? "crosshair" :
    "crosshair";

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 z-20"
      style={{ cursor: cursorStyle }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
    />
  );
}
