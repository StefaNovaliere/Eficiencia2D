"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createMarkLineId,
  getMarkLinePrecisionSpec,
  markLineLengthM,
  markLinePointsFromPrecision,
  simplifyPolyline,
  MIN_MARK_LINE_M,
  type MarkLine,
  type MarkLinePoint,
  type MarkLinePrecisionSpec,
} from "@/core/mark-lines";
import type { PanelProjection } from "@/core/cut-preview";
import { cutGroupOwnerId } from "@/core/cut-derived-groups";
import { snapPointToPanelEdges } from "@/core/user-cuts";
import type { ModelViewerHandle } from "@/components/ModelViewer";
import MarkLinePrecisionPanel from "@/components/MarkLinePrecisionPanel";

export type MarkLineMode = "straight" | "freehand";

interface MarkLineToolOverlayProps {
  active: boolean;
  mode: MarkLineMode;
  edgeSnapEnabled: boolean;
  viewerRef: React.RefObject<ModelViewerHandle | null>;
  targetGroupId?: number | null;
  onDraftChange: (line: MarkLine | null) => void;
  onUpsert: (line: MarkLine) => void;
}

const FREEHAND_MIN_STEP_M = 0.01;
const FREEHAND_SIMPLIFY_TOL_M = 0.004;

const DEFAULT_PRECISION: MarkLinePrecisionSpec = {
  lengthM: 1,
  angleDeg: 0,
  horizontalEdge: "left",
  verticalEdge: "top",
  offsetHorizontalM: 0.5,
  offsetVerticalM: 0.5,
};

function orthoConstrain(u0: number, v0: number, u1: number, v1: number): MarkLinePoint {
  return Math.abs(u1 - u0) >= Math.abs(v1 - v0) ? { u: u1, v: v0 } : { u: u0, v: v1 };
}

export default function MarkLineToolOverlay({
  active,
  mode,
  edgeSnapEnabled,
  viewerRef,
  targetGroupId = null,
  onDraftChange,
  onUpsert,
}: MarkLineToolOverlayProps) {
  const dragRef = useRef<{
    active: boolean;
    groupId: number;
    scenePoint: { x: number; y: number; z: number };
    projection: PanelProjection;
    u0: number;
    v0: number;
    points: MarkLinePoint[];
  } | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const latestRef = useRef<MarkLine | null>(null);

  const [precision, setPrecision] = useState<MarkLinePrecisionSpec>(DEFAULT_PRECISION);
  const [isDragging, setIsDragging] = useState(false);
  const [hasWallTarget, setHasWallTarget] = useState(false);
  const precisionRef = useRef(precision);
  precisionRef.current = precision;

  const precisionEdgesRef = useRef({
    horizontalEdge: DEFAULT_PRECISION.horizontalEdge,
    verticalEdge: DEFAULT_PRECISION.verticalEdge,
  });
  const activeGroupRef = useRef<number | null>(null);
  /** Id de la línea que se está ajustando (null = preview draft). */
  const editingLineIdRef = useRef<string | null>(null);

  const onUpsertRef = useRef(onUpsert);
  onUpsertRef.current = onUpsert;
  const onDraftChangeRef = useRef(onDraftChange);
  onDraftChangeRef.current = onDraftChange;

  const resolveOwnerId = useCallback((groupId: number) => cutGroupOwnerId(groupId), []);

  const raycastHit = useCallback(
    (clientX: number, clientY: number) => {
      if (mode === "straight") {
        const hit = viewerRef.current?.raycastPanelFull(clientX, clientY);
        if (!hit) return null;
        return {
          groupId: hit.groupId,
          u: hit.u,
          v: hit.v,
          scenePoint: hit.scenePoint,
          projection: hit.projection,
        };
      }
      const hit = viewerRef.current?.raycastMeasure(clientX, clientY);
      if (!hit) return null;
      return {
        groupId: hit.hitGroupId,
        u: hit.u,
        v: hit.v,
        scenePoint: hit.scenePoint,
        projection: hit.projection,
      };
    },
    [mode, viewerRef],
  );

  const showPrecision = active && mode === "straight";

  useEffect(() => {
    precisionEdgesRef.current = {
      horizontalEdge: precision.horizontalEdge,
      verticalEdge: precision.verticalEdge,
    };
  }, [precision.horizontalEdge, precision.verticalEdge]);

  useEffect(() => {
    if (targetGroupId != null) {
      activeGroupRef.current = resolveOwnerId(targetGroupId);
      setHasWallTarget(true);
    }
  }, [targetGroupId, resolveOwnerId]);

  const scheduleDraft = useCallback((line: MarkLine | null) => {
    latestRef.current = line;
    if (line === null) {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      onDraftChangeRef.current(null);
      return;
    }
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      onDraftChangeRef.current(latestRef.current);
    });
  }, []);

  useEffect(() => {
    if (!active) {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      dragRef.current = null;
      scheduleDraft(null);
      setIsDragging(false);
      editingLineIdRef.current = null;
      setHasWallTarget(targetGroupId != null);
    }
  }, [active, scheduleDraft, targetGroupId]);

  const resolveGroupId = useCallback((): number | null => {
    if (activeGroupRef.current != null) return activeGroupRef.current;
    if (targetGroupId != null) return resolveOwnerId(targetGroupId);
    if (latestRef.current) return latestRef.current.groupId;
    return null;
  }, [targetGroupId, resolveOwnerId]);

  const buildLineFromSpec = useCallback(
    (groupId: number, spec: MarkLinePrecisionSpec, id?: string | null): MarkLine | null => {
      const ownerId = resolveOwnerId(groupId);
      const ps = viewerRef.current?.getPanelSize(ownerId);
      if (!ps) return null;
      if (spec.lengthM < MIN_MARK_LINE_M) return null;
      const points = markLinePointsFromPrecision(spec, ps.widthM, ps.heightM);
      if (markLineLengthM(points) < MIN_MARK_LINE_M) return null;
      return {
        id: id ?? editingLineIdRef.current ?? createMarkLineId(),
        groupId: ownerId,
        points,
      };
    },
    [viewerRef, resolveOwnerId],
  );

  /** Preview o actualización in-place según haya línea en edición. */
  const showSpecOnWall = useCallback(
    (spec: MarkLinePrecisionSpec) => {
      const gid = resolveGroupId();
      if (gid == null) {
        scheduleDraft(null);
        return;
      }
      const line = buildLineFromSpec(gid, spec);
      if (!line) {
        scheduleDraft(null);
        return;
      }
      if (editingLineIdRef.current) {
        onUpsertRef.current({ ...line, id: editingLineIdRef.current });
        scheduleDraft(null);
      } else {
        scheduleDraft({ id: "__draft__", groupId: line.groupId, points: line.points });
      }
    },
    [resolveGroupId, buildLineFromSpec, scheduleDraft],
  );

  // Preview inicial cuando hay pared seleccionada y aún no hay línea en edición.
  useEffect(() => {
    if (!active || mode !== "straight" || isDragging) return;
    if (editingLineIdRef.current) return;
    showSpecOnWall(precision);
  }, [active, mode, isDragging, targetGroupId, precision, showSpecOnWall]);

  const handleAccept = useCallback(
    (specFromPanel?: MarkLinePrecisionSpec) => {
      // Asegurar blur de inputs para no perder el último valor tipeado.
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }

      const spec = specFromPanel ?? precisionRef.current;
      const gid = resolveGroupId();

      let line: MarkLine | null = null;
      const draft = latestRef.current;
      if (draft && draft.points.length >= 2 && markLineLengthM(draft.points) >= MIN_MARK_LINE_M) {
        line = {
          id: editingLineIdRef.current ?? createMarkLineId(),
          groupId: draft.groupId,
          points: draft.points,
        };
      }
      if (!line && gid != null) {
        line = buildLineFromSpec(gid, spec);
      }
      // Si el draft quedó desfasado respecto al panel, preferir el spec del panel.
      if (line && gid != null) {
        const fromSpec = buildLineFromSpec(gid, spec, line.id);
        if (fromSpec) line = fromSpec;
      }

      if (!line) {
        // Sin pared: no hay dónde colocar — el usuario debe seleccionar/cliclear una.
        return;
      }

      onUpsertRef.current(line);
      editingLineIdRef.current = line.id;
      scheduleDraft(null);
      setPrecision(spec);
      precisionRef.current = spec;
    },
    [resolveGroupId, buildLineFromSpec, scheduleDraft],
  );

  const handlePrecisionChange = useCallback(
    (next: MarkLinePrecisionSpec) => {
      setPrecision(next);
      precisionRef.current = next;

      const drag = dragRef.current;
      if (drag?.active && mode === "straight") {
        const ps = viewerRef.current?.getPanelSize(drag.groupId);
        if (!ps) return;
        const points = markLinePointsFromPrecision(next, ps.widthM, ps.heightM);
        scheduleDraft({ id: "__draft__", groupId: drag.groupId, points });
        return;
      }

      showSpecOnWall(next);
    },
    [mode, viewerRef, scheduleDraft, showSpecOnWall],
  );

  const handleNewLine = useCallback(() => {
    editingLineIdRef.current = null;
    scheduleDraft(null);
    showSpecOnWall(precisionRef.current);
  }, [scheduleDraft, showSpecOnWall]);

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
      if (document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-viewer-chrome]")) {
        return;
      }

      const hit = raycastHit(e.clientX, e.clientY);
      if (!hit) return;

      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);

      activeGroupRef.current = resolveOwnerId(hit.groupId);
      setHasWallTarget(true);

      const ps =
        mode === "straight"
          ? viewerRef.current?.getPanelSize(hit.groupId)
          : viewerRef.current?.getDisplayPanelSize(hit.groupId);
      const start =
        mode === "straight" && ps
          ? snapPointToPanelEdges(hit.u, hit.v, ps, edgeSnapEnabled)
          : { u: hit.u, v: hit.v };

      // Al dibujar a mano, cerramos la edición precisa de la línea anterior.
      editingLineIdRef.current = null;

      setIsDragging(true);
      dragRef.current = {
        active: true,
        groupId: resolveOwnerId(hit.groupId),
        scenePoint: hit.scenePoint,
        projection: hit.projection,
        u0: start.u,
        v0: start.v,
        points: [{ u: start.u, v: start.v }],
      };
      scheduleDraft({
        id: "__draft__",
        groupId: resolveOwnerId(hit.groupId),
        points: [
          { u: start.u, v: start.v },
          { u: start.u, v: start.v },
        ],
      });
    },
    [
      active,
      mode,
      edgeSnapEnabled,
      viewerRef,
      handleMiddleMouse,
      scheduleDraft,
      raycastHit,
      resolveOwnerId,
    ],
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
        scheduleDraft({
          id: "__draft__",
          groupId: drag.groupId,
          points: [...drag.points, uv],
        });
      } else {
        let end: MarkLinePoint = uv;
        if (e.shiftKey) end = orthoConstrain(drag.u0, drag.v0, uv.u, uv.v);
        const ps = viewerRef.current?.getPanelSize(drag.groupId);
        if (ps && edgeSnapEnabled) end = snapPointToPanelEdges(end.u, end.v, ps, true);
        const points = [
          { u: drag.u0, v: drag.v0 },
          end,
        ];
        scheduleDraft({
          id: "__draft__",
          groupId: drag.groupId,
          points,
        });
        if (ps) {
          const live = getMarkLinePrecisionSpec(
            points,
            ps.widthM,
            ps.heightM,
            precisionEdgesRef.current,
          );
          if (live) {
            setPrecision(live);
            precisionRef.current = live;
          }
        }
      }
    },
    [mode, edgeSnapEnabled, viewerRef, scheduleDraft],
  );

  const handlePointerUp = useCallback(() => {
    const drag = dragRef.current;
    if (!drag?.active) return;
    drag.active = false;
    setIsDragging(false);
    const draft = latestRef.current;
    scheduleDraft(null);
    if (!draft) return;

    if (mode === "freehand") {
      const points = simplifyPolyline(draft.points, FREEHAND_SIMPLIFY_TOL_M);
      if (points.length >= 2 && markLineLengthM(points) >= MIN_MARK_LINE_M) {
        onUpsertRef.current({ id: createMarkLineId(), groupId: draft.groupId, points });
      }
      return;
    }

    if (markLineLengthM(draft.points) < MIN_MARK_LINE_M) {
      // Clic corto: reponer preview del panel sobre esa pared.
      showSpecOnWall(precisionRef.current);
      return;
    }

    const id = createMarkLineId();
    onUpsertRef.current({
      id,
      groupId: draft.groupId,
      points: draft.points,
    });
    editingLineIdRef.current = id;
  }, [mode, scheduleDraft, showSpecOnWall]);

  if (!active) return null;

  return (
    <>
      <div
        ref={overlayRef}
        className="absolute inset-0 z-20"
        style={{ cursor: "crosshair" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />

      {showPrecision && (
        <MarkLinePrecisionPanel
          spec={precision}
          liveFromDrag={isDragging}
          onChange={handlePrecisionChange}
          onAccept={handleAccept}
          onNewLine={handleNewLine}
          canAccept={hasWallTarget}
        />
      )}
    </>
  );
}
