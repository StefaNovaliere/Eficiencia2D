import type { Vec3 } from "./types";
import type {
  AssemblyPanel,
  AssemblyPreviewData,
  AssemblySequencePiecePayload,
} from "@/services/api";

/** One assembly step from the backend JSON. */
export interface AssemblySequenceStep {
  title: string;
  description: string;
  panel_ids: string[];
  camera_focus?: Vec3;
}

/** A single piece placed during the interactive assembly sequence. */
export interface AssemblySequencePiece {
  id: string;
  stepIndex: number;
  kind?: "oriented_box" | string;
  position: Vec3;
  /** Euler XYZ radians (Three.js). */
  rotation: Vec3;
  normal: Vec3;
  width_m: number;
  height_m: number;
  depth_m: number;
  category: string;
  color?: string;
}

/** Prefer backend `pasos` / `steps`; fall back to elevations. */
export function resolveAssemblySteps(data: AssemblyPreviewData): AssemblySequenceStep[] {
  if (data.steps && data.steps.length > 0) {
    return data.steps.map((s) => ({
      title: s.title,
      description: s.description,
      panel_ids: s.panel_ids,
      camera_focus: s.camera_focus,
    }));
  }

  const elevations = data.elevations ?? {};
  return Object.values(elevations)
    .filter((elev) => (elev.panel_ids ?? []).length > 0)
    .map((elev) => ({
      title: elev.label,
      description: `Colocá las piezas de ${elev.label}.`,
      panel_ids: elev.panel_ids ?? [],
    }));
}

function findSequencePiece(
  pieceById: Map<string, AssemblySequencePiecePayload>,
  panelId: string,
): AssemblySequencePiecePayload | undefined {
  const trimmed = panelId.trim();
  const direct = pieceById.get(trimmed);
  if (direct) return direct;
  const lower = trimmed.toLowerCase();
  for (const [key, piece] of pieceById) {
    if (key.trim().toLowerCase() === lower) return piece;
  }
  return undefined;
}

function payloadToPiece(
  raw: AssemblySequencePiecePayload,
  stepIndex: number,
): AssemblySequencePiece {
  return {
    id: raw.id,
    stepIndex,
    kind: raw.kind,
    position: raw.position,
    rotation: raw.rotation ?? { x: 0, y: 0, z: 0 },
    normal: raw.normal,
    width_m: raw.width_m,
    height_m: raw.height_m,
    depth_m: raw.depth_m,
    category: raw.category,
    color: raw.color,
  };
}

/**
 * Maps piezas to 3D pieces using the ordered pasos/steps as source of truth
 * for stepIndex (drives progressive assembly animation).
 */
export function buildAssemblyPieces(
  data: AssemblyPreviewData,
  steps: AssemblySequenceStep[],
): AssemblySequencePiece[] {
  if (data.sequencePieces && data.sequencePieces.length > 0) {
    const pieceById = new Map<string, AssemblySequencePiecePayload>();
    for (const p of data.sequencePieces) {
      pieceById.set(p.id, p);
    }

    const built: AssemblySequencePiece[] = [];
    const used = new Set<string>();

    for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
      for (const panelId of steps[stepIndex].panel_ids) {
        const raw = findSequencePiece(pieceById, panelId);
        if (!raw || used.has(raw.id)) continue;
        used.add(raw.id);
        built.push(payloadToPiece(raw, stepIndex));
      }
    }

    const lastStep = Math.max(0, steps.length - 1);
    for (const raw of data.sequencePieces) {
      if (used.has(raw.id)) continue;
      built.push(payloadToPiece(raw, lastStep));
    }

    if (built.length > 0) return built;

    const stepCount = Math.max(steps.length, 1);
    return data.sequencePieces.map((raw, i) =>
      payloadToPiece(
        raw,
        Math.min(stepCount - 1, Math.floor((i * stepCount) / data.sequencePieces!.length)),
      ),
    );
  }

  // Sin sequencePieces: usar paneles del backend.
  const panelById = new Map((data.panels ?? []).map((p) => [p.id, p]));
  const pieces: AssemblySequencePiece[] = [];

  for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
    for (const panelId of steps[stepIndex].panel_ids) {
      const panel = panelById.get(panelId);
      if (!panel) continue;
      pieces.push(panelToPiece(panel, stepIndex));
    }
  }

  return pieces;
}

function panelToPiece(panel: AssemblyPanel, stepIndex: number): AssemblySequencePiece {
  return {
    id: panel.id,
    stepIndex,
    position: panel.centroid,
    rotation: { x: 0, y: 0, z: 0 },
    normal: panel.normal,
    width_m: panel.width_m,
    height_m: panel.height_m,
    depth_m: panel.category === "floor" ? 0.04 : 0.012,
    category: panel.category,
  };
}

function finiteCoord(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

function finiteDim(n: number, min = 0.03): number {
  return Number.isFinite(n) && n > 0 ? n : min;
}

/** Detect mm/cm coords and normalize to metres for Three.js. */
function detectMetreScale(pieces: AssemblySequencePiece[]): number {
  let maxAbs = 0;
  for (const p of pieces) {
    maxAbs = Math.max(
      maxAbs,
      Math.abs(p.position.x),
      Math.abs(p.position.y),
      Math.abs(p.position.z),
      p.width_m,
      p.height_m,
      p.depth_m,
    );
  }
  if (maxAbs > 500) return 0.001;
  if (maxAbs > 50) return 0.01;
  return 1;
}

/** Sanitize positions/dims so R3F never receives NaN (breaks the whole scene). */
export function prepareAssemblyPiecesForRender(
  pieces: AssemblySequencePiece[],
  options?: { viewerSchema?: string },
): AssemblySequencePiece[] {
  if (pieces.length === 0) return pieces;

  const isOrientedBoxV1 = options?.viewerSchema === "oriented_box_v1";
  const scale = isOrientedBoxV1 ? 1 : detectMetreScale(pieces);

  return pieces.map((p) => ({
    ...p,
    position: {
      x: finiteCoord(p.position.x) * scale,
      y: finiteCoord(p.position.y) * scale,
      z: finiteCoord(p.position.z) * scale,
    },
    rotation: {
      x: finiteCoord(p.rotation?.x ?? 0),
      y: finiteCoord(p.rotation?.y ?? 0),
      z: finiteCoord(p.rotation?.z ?? 0),
    },
    width_m: finiteDim(p.width_m * scale, isOrientedBoxV1 ? 0.012 : 0.03),
    height_m: finiteDim(p.height_m * scale, isOrientedBoxV1 ? 0.012 : 0.03),
    depth_m: finiteDim(p.depth_m * scale, isOrientedBoxV1 ? 0.012 : 0.02),
  }));
}

/** Scene center for orbit target (model-space). */
export function computeSequenceCenter(pieces: AssemblySequencePiece[]): Vec3 {
  if (pieces.length === 0) return { x: 0, y: 0, z: 0 };

  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;

  for (const p of pieces) {
    const x = finiteCoord(p.position.x);
    const y = finiteCoord(p.position.y);
    const z = finiteCoord(p.position.z);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }

  if (!Number.isFinite(minX)) return { x: 0, y: 0, z: 0 };

  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    z: (minZ + maxZ) / 2,
  };
}

export function computeSequenceDiag(pieces: AssemblySequencePiece[]): number {
  if (pieces.length === 0) return 4;
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (const p of pieces) {
    const x = finiteCoord(p.position.x);
    const y = finiteCoord(p.position.y);
    const z = finiteCoord(p.position.z);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }
  if (!Number.isFinite(minX)) return 4;
  return Math.max(
    Math.sqrt((maxX - minX) ** 2 + (maxY - minY) ** 2 + (maxZ - minZ) ** 2),
    1,
  );
}
