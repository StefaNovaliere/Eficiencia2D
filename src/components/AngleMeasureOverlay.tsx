"use client";

/**
 * Angle measurement (protractor) overlay.
 *
 * mode "line"   → 2 clicks on the SAME panel → shows line angle vs horizontal
 * mode "panels" → 2 clicks on ANY panels     → shows dihedral angle between panels
 *
 * Middle-mouse is forwarded to the canvas for orbiting.
 * Escape cancels the current placement and resets to idle.
 * Changing `mode` while placing auto-resets the draft.
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
  mode: "line" | "panels";
  viewerRef: React.RefObject<ModelViewerHandle | null>;
  onDraftChange: (draft: AngleDraftState | null) => void;
  onCommit: (measure: UserAngleMeasure) => void;
}

type ClickPhase = "idle" | "placingPoint2";

export default function AngleMeasureOverlay({
  active,
  mode,
  viewerRef,
  onDraftChange,
  onCommit,
}: AngleMeasureOverlayProps) {
  const phaseRef        = useRef<ClickPhase>("idle");
  const draftRef        = useRef<AngleDraftState | null>(null);
  const overlayRef      = useRef<HTMLDivElement>(null);
  const rafRef          = useRef<number | null>(null);
  const latestDraftRef  = useRef<AngleDraftState | null>(null);

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

  // Reset when tool is deactivated or mode changes while mid-placement
  useEffect(() => {
    if (!active) {
      phaseRef.current = "idle";
      clearDraft();
    }
  }, [active, clearDraft]);

  useEffect(() => {
    if (phaseRef.current !== "idle") {
      phaseRef.current = "idle";
      clearDraft();
    }
  // intentionally only on mode change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

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
      const current = latestDraftRef.current;
      if (!current || current.mode !== "line") return; // cursor tracking only for line mode

      const hit = viewerRef.current?.raycastMeasure(e.clientX, e.clientY);
      if (!hit || hit.hitGroupId !== current.groupId) return;

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
        // ── First click: anchor point 1 ──────────────────────────────────
        phaseRef.current = "placingPoint2";

        const draft: AngleDraftState =
          mode === "line"
            ? { mode: "line", groupId: hit.hitGroupId, point1: uv, cursor: uv }
            : { mode: "panels", groupId1: hit.hitGroupId, point1: uv };

        latestDraftRef.current = draft;
        draftRef.current = draft;
        onDraftChange(draft);

      } else {
        // ── Second click: commit ─────────────────────────────────────────
        const current = draftRef.current;
        if (!current) return;

        if (current.mode === "line") {
          if (hit.hitGroupId !== current.groupId) return;
          const len = Math.hypot(uv.u - current.point1.u, uv.v - current.point1.v);
          if (len < MIN_ANGLE_ARM_LENGTH) return;

          onCommit({
            mode: "line",
            id: createAngleMeasureId(),
            groupId: current.groupId,
            point1: current.point1,
            point2: uv,
          });

        } else {
          // panels mode — no group restriction, any distance ok
          onCommit({
            mode: "panels",
            id: createAngleMeasureId(),
            groupId1: current.groupId1,
            groupId2: hit.hitGroupId,
            point1: current.point1,
            point2: uv,
          });
        }

        phaseRef.current = "idle";
        clearDraft();
      }
    },
    [active, mode, viewerRef, forwardMiddleMouse, onDraftChange, onCommit, clearDraft],
  );

  if (!active) return null;

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 z-20"
      style={{ cursor: "crosshair" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
    />
  );
}
