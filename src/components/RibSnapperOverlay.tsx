"use client";

import { useCallback, useEffect, useRef } from "react";
import type { PlateJoint } from "@/core/pipeline";
import { findNearestJoint } from "@/core/rib-snapper";
import { createRibId, type Rib } from "@/core/reinforcements";
import type { ModelViewerHandle } from "@/components/ModelViewer";

interface RibSnapperOverlayProps {
  active: boolean;
  viewerRef: React.RefObject<ModelViewerHandle | null>;
  /** Aristas de junta placa↔placa (backend). Sin esto no hay imán. */
  plateJoints: PlateJoint[];
  /** Cateto del nervio en metros de MUNDO (físico × escala). */
  ribSizeM: number;
  /** Nervio fantasma bajo el mouse (o null). Se dibuja ámbar translúcido. */
  onGhostChange: (ghost: Rib | null) => void;
  onCommit: (rib: Rib) => void;
}

/**
 * Herramienta "Colocar nervio" con atracción magnética: al mover el mouse sobre
 * el modelo, se raycastea la superficie, se busca la junta (arista pared↔piso)
 * más cercana al punto 3D y, si está a menos del umbral, aparece un nervio
 * fantasma anclado a esa esquina en la posición `t` sobre la arista. El click
 * lo fija. Sin junta cerca ⇒ sin fantasma.
 */
export default function RibSnapperOverlay({
  active,
  viewerRef,
  plateJoints,
  ribSizeM,
  onGhostChange,
  onCommit,
}: RibSnapperOverlayProps) {
  const ghostRef = useRef<Rib | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastEventRef = useRef<{ x: number; y: number } | null>(null);

  const clearGhost = useCallback(() => {
    ghostRef.current = null;
    onGhostChange(null);
  }, [onGhostChange]);

  useEffect(() => {
    if (!active) {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      clearGhost();
    }
  }, [active, clearGhost]);

  const updateGhost = useCallback(() => {
    rafRef.current = null;
    const pos = lastEventRef.current;
    if (!pos) return;

    const hit = viewerRef.current?.raycastPanelFull(pos.x, pos.y);
    if (!hit) {
      if (ghostRef.current) clearGhost();
      return;
    }

    // Umbral del imán: un tamaño de nervio alrededor de la arista.
    const snap = findNearestJoint(hit.worldPoint, plateJoints, ribSizeM);
    if (!snap) {
      if (ghostRef.current) clearGhost();
      return;
    }

    // Cartela modesta: nunca más grande que un tramo razonable de la junta.
    const jointLen = Math.hypot(
      snap.joint.b.x - snap.joint.a.x,
      snap.joint.b.y - snap.joint.a.y,
      snap.joint.b.z - snap.joint.a.z,
    );
    const sizeM = Math.min(ribSizeM, jointLen * 0.4);
    const ghost: Rib = {
      id: "__ghost__",
      groupA: snap.joint.cutId,
      groupB: snap.joint.cutterId,
      sizeM,
      t: snap.t,
    };
    const prev = ghostRef.current;
    if (
      !prev ||
      prev.groupA !== ghost.groupA ||
      prev.groupB !== ghost.groupB ||
      Math.abs(prev.t - ghost.t) > 1e-3
    ) {
      ghostRef.current = ghost;
      onGhostChange(ghost);
    }
  }, [viewerRef, plateJoints, ribSizeM, clearGhost, onGhostChange]);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      lastEventRef.current = { x: e.clientX, y: e.clientY };
      if (rafRef.current == null) {
        rafRef.current = requestAnimationFrame(updateGhost);
      }
    },
    [updateGhost],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const ghost = ghostRef.current;
      if (!ghost) return;
      e.preventDefault();
      onCommit({ ...ghost, id: createRibId() });
    },
    [onCommit],
  );

  if (!active) return null;

  return (
    <div
      className="absolute inset-0 z-20"
      style={{ cursor: ghostRef.current ? "copy" : "crosshair" }}
      onPointerMove={handlePointerMove}
      onPointerDown={handlePointerDown}
      onPointerLeave={clearGhost}
    />
  );
}
