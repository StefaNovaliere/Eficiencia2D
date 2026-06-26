import type { Face3D, Vec3 } from "./types";
import type { PlateJoint } from "./pipeline";
import { liftFaces, buildSlots, type LiftedPieceGeometry } from "./assembly-lift";
import type {
  AssemblyPanel,
  AssemblyPreviewData,
  AssemblySequencePiecePayload,
} from "@/services/api";

/**
 * Contexto del instructivo v2 (método obligatorio del contrato):
 *  - CUERPO + HUECOS + POSE: la malla original del grupo
 *    (`faces[group.faceIndices]`), idéntica al visor de /review. Los huecos
 *    aparecen solos (son gaps reales de la malla). NO se reconstruye desde el
 *    panel 2D de corte (causaba huecos tapados y pisos deformados).
 *  - ENCASTRES (ranuras): overlay desde `plate_joints` de `/api/nesting-preview`
 *    (ya en coords de mundo), filtrados por `cut_id == group.id`.
 */
export interface AssemblyLiftContext {
  /** etiqueta de panel (A1, B2…) → id de grupo. */
  labelToGroupId: Map<string, number>;
  /** Caras originales del modelo (mismo espacio que el visor de review). */
  faces: Face3D[];
  /** etiqueta → índices de cara del grupo (cuerpo de la pieza). */
  faceIndicesByLabel: Map<string, number[]>;
  /** Encastres por id de grupo que los RECIBE (`cut_id`). */
  plateJointsByGroupId?: Map<number, PlateJoint[]>;
  /** Normal del plano de cada grupo (para orientar las ranuras). */
  normalByGroupId?: Map<number, Vec3>;
}

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
  /** Geometría de corte lifteada a 3D (instructivo #2). Si está, el visor la
   *  dibuja en lugar de una caja. Coordenadas de mundo (metros). */
  lifted?: LiftedPieceGeometry;
  /** La pieza graba sus aberturas (rojo) en vez de cortarlas. */
  isMark?: boolean;
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
 * v2: arma la geometría de la pieza = malla original del grupo (cuerpo + huecos
 * + pose) + overlay de ranuras de encastre. Nunca tira: ante cualquier error,
 * la pieza cae al render de caja (sin `lifted`).
 */
function applyLift(
  piece: AssemblySequencePiece,
  lift: AssemblyLiftContext | undefined,
): AssemblySequencePiece {
  if (!lift) return piece;
  const label = piece.id.trim();
  const faceIndices = lift.faceIndicesByLabel.get(label);
  if (!faceIndices || faceIndices.length === 0) return piece;

  try {
    const faces = faceIndices.map((i) => lift.faces[i]).filter(Boolean);
    if (faces.length === 0) return piece;

    const body = liftFaces(faces);
    if ((body.positions?.length ?? 0) < 9) return piece;

    // Overlay de ranuras de encastre (plate_joints con cut_id == group.id).
    const groupId = lift.labelToGroupId.get(label);
    const joints = groupId === undefined ? undefined : lift.plateJointsByGroupId?.get(groupId);
    const normal = groupId === undefined ? undefined : lift.normalByGroupId?.get(groupId);
    const slots = joints && joints.length > 0 && normal ? buildSlots(joints, normal) : [];

    return { ...piece, lifted: { ...body, openings: body.openings ?? [], slots } };
  } catch {
    // Caer al render de caja.
    return piece;
  }
}

export function buildAssemblyPieces(
  data: AssemblyPreviewData,
  steps: AssemblySequenceStep[],
  lift?: AssemblyLiftContext,
): AssemblySequencePiece[] {
  return buildAssemblyPiecesRaw(data, steps).map((p) => applyLift(p, lift));
}

function buildAssemblyPiecesRaw(
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
  // Las piezas lifteadas ya vienen en metros de mundo (desde `placements`); no
  // se reescalan, y su `position` (para centrado/cámara) tampoco.
  const hasLift = pieces.some((p) => p.lifted);
  const scale = hasLift || isOrientedBoxV1 ? 1 : detectMetreScale(pieces);

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
