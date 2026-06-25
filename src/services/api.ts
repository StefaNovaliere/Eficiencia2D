import { decodePackedFaces } from "@/core/packed-faces";
import type { Phase1Result, NestingPreviewData, ClassificationOverride } from "@/core/pipeline";
import type { UserCut } from "@/core/user-cuts";
import { serializeUserCutsForApi } from "@/core/user-cuts";
import {
  invalidateApiBaseUrl,
  resolveApiBaseUrl,
} from "@/services/api-base";

/** Serializa los cortes manuales del usuario al formato snake_case del backend. */
export function userCutsForApi(cuts: UserCut[]): Record<string, unknown>[] {
  return serializeUserCutsForApi(cuts);
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  let baseUrl = await resolveApiBaseUrl();

  try {
    const res = await fetch(`${baseUrl}${path}`, init);
    return res;
  } catch (error) {
    invalidateApiBaseUrl();
    baseUrl = await resolveApiBaseUrl(true);

    try {
      return await fetch(`${baseUrl}${path}`, init);
    } catch (retryError) {
      throw retryError ?? error;
    }
  }
}

export interface UploadResponse {
  message: string;
  file_id: string;
  original_filename: string;
  summary: {
    walls: number;
    floors: number;
    discards: number;
    total_groups: number;
  };
  topology: Phase1Result; // Mapped from backend snake_case + packed faces
  preview_obj: string;
}

// Helper to convert snake_case keys to camelCase for the frontend TS interfaces
function toCamelCase(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(v => toCamelCase(v));
  }
  if (obj !== null && typeof obj === "object" && obj.constructor === Object) {
    return Object.keys(obj).reduce((result, key) => {
      const camelKey = key.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
      result[camelKey] = toCamelCase(obj[key]);
      return result;
    }, {} as any);
  }
  return obj;
}

/**
 * Mapea la topología cruda del backend (`/api/upload` o `/api/recompute`) al
 * `Phase1Result` que consume la UI: decodifica la geometría empaquetada y
 * cameliza el resto de las claves. El backend es dueño de la geometría; acá
 * sólo desempaquetamos y renombramos.
 */
function mapTopology(topo: any, originalFilename?: string): Phase1Result {
  // Extraer geometría empaquetada antes de camelizar (evita renombrar coords_b64).
  const facesPacked = topo.faces_packed;
  const rawFacesPacked = topo.raw_faces_packed;
  delete topo.faces_packed;
  delete topo.raw_faces_packed;

  const camel = toCamelCase(topo);
  camel.faces = facesPacked ? decodePackedFaces(facesPacked) : [];
  camel.rawFaces = rawFacesPacked ? decodePackedFaces(rawFacesPacked) : [];
  camel.appliedAxis ??= "Y";
  camel.preSplitFaceCount ??= camel.rawFaces.length || camel.faces.length;
  camel.stem ??= originalFilename?.replace(/\.[^.]+$/, "") ?? "";
  camel.warnings ??= [];
  camel.suggestedMerges ??= [];

  return camel as Phase1Result;
}

export interface SplitOperation {
  group_id: number;
  mode: "components" | "panels";
}

/** Payload para `POST /api/recompute` (re-deriva la topología en el backend). */
export interface RecomputePayload {
  file_id: string;
  axis: "Y" | "Z";
  min_area_m2: number;
  merges: number[][];
  splits: SplitOperation[];
}

/** Payload para `POST /api/nesting-preview`. */
export interface NestingPreviewPayload {
  file_id: string;
  axis: "Y" | "Z";
  min_area_m2: number;
  merges: number[][];
  splits: SplitOperation[];
  overrides: Record<number, string>;
  wall_wall_decisions: Record<number, number>;
  marks: number[];
  sheet_config: {
    width_m: number;
    height_m: number;
    gap_m: number;
  };
  scale_denom: number;
  /** Tamaño de papel del PDF. En modo cartón (`page_mode = one_per_sheet`) el
   *  backend deriva la plancha de este papel, así que afecta el preview. */
  paper?: string;
  /** Paginación del PDF. En `one_per_sheet` la plancha = papel − margen
   *  (auto-orientada); en `single_page` se usa `sheet_config` tal cual. */
  page_mode?: "one_per_sheet" | "single_page";
  /** Cortes manuales del usuario (panel-local, metros). Para previsualizar las
   *  planchas con los recortes aplicados. */
  user_cuts?: Record<string, unknown>[];
}

export interface GenerateRequestPayload {
  file_id: string;
  original_filename: string;
  scale_denom?: number;
  paper?: string;
  /** Paginación del PDF de planchas: una plancha por página o todas en una. */
  page_mode?: "one_per_sheet" | "single_page";
  min_area_m2?: number;
  sheet_config?: {
    width_m: number;
    height_m: number;
    gap_m: number;
  };
  overrides?: Record<number, string>;
  wall_wall_decisions?: Record<number, number>;
  merges?: number[][];
  /** Group splits recorded in Review (replayed by the backend). */
  splits?: SplitOperation[];
  /** GeometryGroup ids whose openings (inner-ring holes) must be engraved
   *  (red, MARK_VECTOR / ACI 1) instead of cut. */
  marks?: number[];
  /** Recortes manuales del usuario (panel-local, metros). Campo reservado: la
   *  herramienta de corte se re-implementará contra el backend. */
  user_cuts?: Record<string, unknown>[];
}

export interface GenerateResponse {
  message: string;
  generated_files: string[];
  zip_base64?: string;
  zip_filename?: string;
}

export function base64ToBlob(base64: string, mime = "application/zip"): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export async function uploadModelFile(file: File): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append("file", file);

  const res = await apiFetch("/api/upload", {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => null);
    throw new Error(errorData?.detail || `Error del servidor: ${res.statusText}`);
  }

  const data = await res.json();
  if (data.topology) {
    data.topology = mapTopology(data.topology, data.original_filename);
  }
  return data;
}

/**
 * Re-deriva la topología en el backend tras una edición geométrica (cambio de
 * eje, área mínima, fusión o división). El backend es la fuente de verdad: el
 * front reemplaza su `phase1Result` con lo que devuelve esta llamada.
 */
export async function recomputeTopology(payload: RecomputePayload): Promise<Phase1Result> {
  const res = await apiFetch("/api/recompute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => null);
    throw new Error(errorData?.detail || `Error al recalcular: ${res.statusText}`);
  }

  const data = await res.json();
  const topo = data.topology ?? data;
  return mapTopology(topo);
}

/** Pide al backend el layout de planchas (nesting) para previsualizar. */
export async function fetchNestingPreview(
  payload: NestingPreviewPayload,
): Promise<NestingPreviewData> {
  const attempts: NestingPreviewPayload[] = [
    payload,
    { ...payload, paper: undefined, page_mode: undefined },
    { ...payload, paper: undefined, page_mode: undefined, user_cuts: undefined },
  ];

  let lastDetail: string | undefined;

  for (let i = 0; i < attempts.length; i++) {
    const body = attempts[i];
    const res = await apiFetch("/api/nesting-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body, (_k, v) => (v === undefined ? undefined : v)),
    });

    if (res.ok) {
      return toCamelCase(await res.json()) as NestingPreviewData;
    }

    const errorData = await res.json().catch(() => null);
    const detail =
      typeof errorData?.detail === "string"
        ? errorData.detail
        : `Error al previsualizar nesting: ${res.statusText}`;
    lastDetail = detail;

    const retryable =
      res.status === 500 &&
      i < attempts.length - 1 &&
      /unpack|expected \d+/i.test(detail);

    if (!retryable) {
      throw new Error(detail);
    }
  }

  throw new Error(lastDetail ?? "Error al previsualizar nesting");
}

// ---------------------------------------------------------------------------
// Assembly preview — POST /api/assembly-preview
// ---------------------------------------------------------------------------

/** A single physical panel in the assembly guide. */
export interface AssemblyPanel {
  id: string;
  category: "wall" | "floor" | string;
  source_group_id: number;
  width_m: number;
  height_m: number;
  area_m2: number;
  centroid: { x: number; y: number; z: number };
  normal: { x: number; y: number; z: number };
  label: string;
}

/** One step in the interactive assembly sequence (backend JSON). */
export interface AssemblySequenceStep {
  title: string;
  description: string;
  /** Part / panel ids placed in this step (`part_ids` from backend). */
  panel_ids: string[];
  /** Optional camera target from `steps[n].camera_focus`. */
  camera_focus?: { x: number; y: number; z: number };
}

/** Assembly guide response from the backend. */
export interface AssemblyPreviewData {
  panels: AssemblyPanel[];
  /** Keyed by elevation name (front/back/right/left/top). */
  elevations: Record<string, { label: string; panel_ids: string[] }>;
  /** Ordered assembly steps for the interactive 3D viewer. */
  steps?: AssemblySequenceStep[];
  /** Pre-built 3D sequence from backend `pieces` / `piezas` (when present). */
  sequencePieces?: AssemblySequencePiecePayload[];
  /** From `meta.viewer_schema` — e.g. `oriented_box_v1`. */
  viewerSchema?: string;
  totals: {
    wall_count: number;
    floor_count: number;
    total_panels: number;
  };
}

/** One animated piece for the interactive viewer (normalized from backend JSON). */
export interface AssemblySequencePiecePayload {
  id: string;
  stepIndex: number;
  /** `oriented_box` for guia_ensamble v1 thin plates. */
  kind?: "oriented_box" | string;
  position: { x: number; y: number; z: number };
  /** Euler XYZ radians (Three.js). Defaults to 0 when omitted. */
  rotation: { x: number; y: number; z: number };
  normal: { x: number; y: number; z: number };
  width_m: number;
  height_m: number;
  depth_m: number;
  category: string;
  /** Hex color from backend (`#64748b` floor, `#475569` wall). */
  color?: string;
}

/**
 * Same params as nesting-preview (sheet_config / scale_denom excluded —
 * the backend ignores them for this endpoint).
 */
export interface AssemblyPreviewPayload {
  file_id: string;
  axis: "Y" | "Z";
  min_area_m2: number;
  merges: number[][];
  splits: SplitOperation[];
  overrides: Record<number, string>;
  wall_wall_decisions: Record<number, number>;
  marks: number[];
  user_cuts?: Record<string, unknown>[];
}

/** Estado actual de la revisión enviado al pedir el instructivo interactivo. */
export interface AssemblyPreviewRequest {
  overrides: ClassificationOverride[];
  wallWallDecisions: Map<number, number>;
  marks: number[];
  userCuts: UserCut[];
}

function finiteNum(n: unknown, fallback = 0): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

function normalizeVec3(v: unknown): { x: number; y: number; z: number } {
  if (Array.isArray(v) && v.length >= 3) {
    return {
      x: finiteNum(v[0]),
      y: finiteNum(v[1]),
      z: finiteNum(v[2]),
    };
  }
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return {
      x: finiteNum(o.x),
      y: finiteNum(o.y),
      z: finiteNum(o.z),
    };
  }
  return { x: 0, y: 0, z: 0 };
}

function normalizeSize3(v: unknown): { w: number; h: number; d: number } {
  if (Array.isArray(v) && v.length >= 3) {
    return { w: Number(v[0]), h: Number(v[1]), d: Number(v[2]) };
  }
  if (v && typeof v === "object") {
    const o = v as Record<string, number>;
    return {
      w: Number(o.w ?? o.width ?? o.width_m ?? o.widthM ?? 0),
      h: Number(o.h ?? o.height ?? o.height_m ?? o.heightM ?? 0),
      d: Number(o.d ?? o.depth ?? o.depth_m ?? o.depthM ?? 0),
    };
  }
  return { w: 0, h: 0, d: 0 };
}

function normalizeEuler3(v: unknown): { x: number; y: number; z: number } {
  if (Array.isArray(v) && v.length >= 3) {
    return {
      x: finiteNum(v[0]),
      y: finiteNum(v[1]),
      z: finiteNum(v[2]),
    };
  }
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return {
      x: finiteNum(o.x ?? o.rx),
      y: finiteNum(o.y ?? o.ry),
      z: finiteNum(o.z ?? o.rz),
    };
  }
  return { x: 0, y: 0, z: 0 };
}

const ORIENTED_BOX_V1 = "oriented_box_v1";
const DEFAULT_WALL_THICKNESS_M = 0.012;
const DEFAULT_FLOOR_THICKNESS_M = 0.04;

function categoryFromPieceColor(color: string | undefined): string {
  if (!color) return "wall";
  const c = color.toLowerCase();
  if (c.includes("64748b")) return "floor";
  return "wall";
}

function normalizeAssemblyPanel(raw: unknown): AssemblyPanel | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const id = p.id ?? p.piece_id ?? p.pieceId ?? p.panel_id ?? p.panelId ?? p.label;
  if (id == null || id === "") return null;

  const size = normalizeSize3(p.size);
  const hasSize = size.w > 0 || size.h > 0 || size.d > 0;
  const color = typeof p.color === "string" ? p.color : undefined;

  return {
    id: String(id),
    category: String(p.category ?? p.tipo ?? categoryFromPieceColor(color)),
    source_group_id: Number(
      p.source_group_id ?? p.sourceGroupId ?? p.group_id ?? p.groupId ?? 0,
    ),
    width_m: Number(p.width_m ?? p.widthM ?? (hasSize ? size.w : 0)),
    height_m: Number(p.height_m ?? p.heightM ?? (hasSize ? size.h : 0)),
    area_m2: Number(
      p.area_m2 ??
        p.areaM2 ??
        p.area ??
        (hasSize ? size.w * size.h : 0),
    ),
    centroid: normalizeVec3(p.centroid ?? p.position ?? p.pos ?? p.centroid_m),
    normal: normalizeVec3(p.normal ?? p.norm),
    label: String(p.label ?? id),
  };
}

function extractStepPieceIds(step: Record<string, unknown>): string[] {
  const direct =
    step.part_ids ??
    step.partIds ??
    step.panel_ids ??
    step.panelIds ??
    step.piece_ids ??
    step.pieceIds ??
    step.pieza_ids ??
    step.piezaIds;
  if (Array.isArray(direct)) return direct.map((id) => String(id).trim()).filter(Boolean);

  const embedded = step.pieces ?? step.piezas ?? step.panels;
  if (!Array.isArray(embedded)) return [];

  const ids: string[] = [];
  for (const item of embedded) {
    if (typeof item === "string" || typeof item === "number") {
      ids.push(String(item));
      continue;
    }
    if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const id = o.id ?? o.piece_id ?? o.pieceId ?? o.panel_id ?? o.panelId ?? o.label;
      if (id != null && id !== "") ids.push(String(id));
    }
  }
  return ids;
}

function normalizeSequencePiecePayload(
  raw: unknown,
  fallbackStepIndex = 0,
  viewerSchema = "",
): AssemblySequencePiecePayload | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const id = p.id ?? p.piece_id ?? p.pieceId ?? p.panel_id ?? p.panelId ?? p.label;
  if (id == null || id === "") return null;

  // Deprecated: mesh.positions (plural) — skip invalid legacy entries.
  if (p.mesh && typeof p.mesh === "object") {
    const mesh = p.mesh as Record<string, unknown>;
    if ("positions" in mesh && !("position" in p)) return null;
  }
  if ("positions" in p && !("position" in p)) return null;

  const isOrientedBox =
    viewerSchema === ORIENTED_BOX_V1 ||
    p.kind === "oriented_box" ||
    p.kind === "orientedBox";

  const size = normalizeSize3(p.size ?? p.dimensions ?? p.bbox ?? p.extents);
  const hasSize = size.w > 0 || size.h > 0 || size.d > 0;
  const color = typeof p.color === "string" ? p.color : undefined;
  const category = String(p.category ?? p.tipo ?? categoryFromPieceColor(color));
  const defaultDepth =
    category === "floor" ? DEFAULT_FLOOR_THICKNESS_M : DEFAULT_WALL_THICKNESS_M;
  const width = finiteNum(p.width_m ?? p.widthM ?? (hasSize ? size.w : 0));
  const height = finiteNum(p.height_m ?? p.heightM ?? (hasSize ? size.h : 0));
  const depth = finiteNum(
    p.depth_m ?? p.depthM ?? p.depth ?? (hasSize ? size.d : defaultDepth),
  );

  const kindRaw = p.kind;
  const kind =
    kindRaw === "oriented_box" || kindRaw === "orientedBox"
      ? "oriented_box"
      : isOrientedBox
        ? "oriented_box"
        : undefined;

  return {
    id: String(id),
    stepIndex: finiteNum(
      p.step_index ?? p.stepIndex ?? p.step ?? p.paso ?? fallbackStepIndex,
    ),
    kind,
    position: normalizeVec3(p.position ?? p.pos ?? p.centroid ?? p.centroid_m),
    rotation: normalizeEuler3(p.rotation ?? p.rot ?? p.euler),
    normal: normalizeVec3(p.normal ?? p.norm),
    width_m: width,
    height_m: height,
    depth_m: depth,
    category,
    color,
  };
}

function normalizeSequencePieces(
  raw: unknown,
  viewerSchema = "",
): AssemblySequencePiecePayload[] {
  if (!Array.isArray(raw)) return [];
  const out: AssemblySequencePiecePayload[] = [];
  for (const item of raw) {
    const piece = normalizeSequencePiecePayload(item, 0, viewerSchema);
    if (piece) out.push(piece);
  }
  return out;
}

function normalizeAssemblyPanels(raw: unknown): AssemblyPanel[] {
  if (!Array.isArray(raw)) return [];
  const out: AssemblyPanel[] = [];
  for (const item of raw) {
    const panel = normalizeAssemblyPanel(item);
    if (panel) out.push(panel);
  }
  return out;
}

function normalizeAssemblySteps(raw: unknown): AssemblySequenceStep[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, index) => {
    const s = item as Record<string, unknown>;
    const panelIds = extractStepPieceIds(s);
    return {
      title: String(s.title ?? s.titulo ?? s.name ?? `Paso ${index + 1}`),
      description: String(s.description ?? s.descripcion ?? s.detail ?? ""),
      panel_ids: panelIds,
      camera_focus: normalizeVec3(s.camera_focus ?? s.cameraFocus),
    };
  });
}

/** Prefer Spanish `pasos` for UI; merge `camera_focus` from canonical English `steps`. */
function normalizeAssemblyStepsFromPasos(
  pasos: unknown[],
  stepsEn: unknown[],
): AssemblySequenceStep[] {
  return pasos.map((item, index) => {
    const s = item as Record<string, unknown>;
    const en = ((stepsEn[index] ?? {}) as Record<string, unknown>);
    const panelIds = extractStepPieceIds(s);
    const enIds = extractStepPieceIds(en);
    const mergedIds = [...new Set([...panelIds, ...enIds])];
    return {
      title: String(s.titulo ?? s.title ?? en.title ?? `Paso ${index + 1}`),
      description: String(s.descripcion ?? s.description ?? en.description ?? ""),
      panel_ids: mergedIds,
      camera_focus: normalizeVec3(
        s.camera_focus ?? s.cameraFocus ?? en.camera_focus ?? en.cameraFocus,
      ),
    };
  });
}

function resolveStepIndexForPiece(
  pieceId: string,
  stepByPartId: Map<string, number>,
  lastStep: number,
): number {
  const trimmed = pieceId.trim();
  const direct = stepByPartId.get(trimmed);
  if (direct !== undefined) return direct;
  const lower = trimmed.toLowerCase();
  for (const [key, idx] of stepByPartId) {
    if (key.trim().toLowerCase() === lower) return idx;
  }
  return lastStep;
}

function assignStepIndicesToPieces(
  pieces: AssemblySequencePiecePayload[],
  steps: AssemblySequenceStep[],
): AssemblySequencePiecePayload[] {
  const lastStep = Math.max(0, steps.length - 1);
  const stepByPartId = new Map<string, number>();
  for (let i = 0; i < steps.length; i++) {
    for (const id of steps[i].panel_ids) {
      const key = id.trim();
      if (!stepByPartId.has(key)) stepByPartId.set(key, i);
    }
  }

  return pieces.map((piece) => ({
    ...piece,
    stepIndex: resolveStepIndexForPiece(piece.id, stepByPartId, lastStep),
  }));
}

/** Any pieza missing from pasos/steps is appended to the last step. */
function ensureAllPiecesInSteps(
  pieces: AssemblySequencePiecePayload[],
  steps: AssemblySequenceStep[],
): AssemblySequenceStep[] {
  if (steps.length === 0 || pieces.length === 0) return steps;

  const assigned = new Set(steps.flatMap((s) => s.panel_ids));
  const missing = pieces.filter((p) => !assigned.has(p.id)).map((p) => p.id);
  if (missing.length === 0) return steps;

  const last = steps.length - 1;
  const updated = steps.map((s) => ({ ...s, panel_ids: [...s.panel_ids] }));
  updated[last] = {
    ...updated[last],
    panel_ids: [...new Set([...updated[last].panel_ids, ...missing])],
  };
  return updated;
}

function sequencePiecesToPanels(
  pieces: AssemblySequencePiecePayload[],
): AssemblyPanel[] {
  return pieces.map((p) => ({
    id: p.id,
    category: p.category,
    source_group_id: 0,
    width_m: p.width_m,
    height_m: p.height_m,
    area_m2: p.width_m * p.height_m,
    centroid: p.position,
    normal: p.normal,
    label: p.id,
  }));
}

function normalizeElevations(
  raw: unknown,
): Record<string, { label: string; panel_ids: string[] }> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, { label: string; panel_ids: string[] }> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const e = value as Record<string, unknown>;
    const panelIds = e.panel_ids ?? e.panelIds;
    out[key] = {
      label: String(e.label ?? key),
      panel_ids: Array.isArray(panelIds) ? panelIds.map(String) : [],
    };
  }
  return out;
}

function unwrapAssemblyRoot(raw: unknown): unknown {
  let root = raw;
  for (let depth = 0; depth < 4 && root && typeof root === "object"; depth++) {
    const o = root as Record<string, unknown>;
    const nested =
      o.assembly_preview ??
      o.assemblyPreview ??
      o.data ??
      o.result ??
      o.payload;
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const hasAssemblyFields =
        "panels" in nested ||
        "pieces" in nested ||
        "piezas" in nested ||
        "elevations" in nested ||
        "steps" in nested ||
        "pasos" in nested ||
        "totals" in nested ||
        "meta" in nested;
      if (hasAssemblyFields) {
        root = nested;
        continue;
      }
    }
    break;
  }
  return root;
}

/** Accepts snake/camel case, wrappers, and steps-only payloads from the backend. */
export function normalizeAssemblyPreviewData(raw: unknown): AssemblyPreviewData {
  const root = unwrapAssemblyRoot(raw);
  if (!root || typeof root !== "object") {
    return {
      panels: [],
      elevations: {},
      steps: [],
      totals: { wall_count: 0, floor_count: 0, total_panels: 0 },
    };
  }

  const camel = toCamelCase(root) as Record<string, unknown>;
  const metaRaw = (camel.meta ?? {}) as Record<string, unknown>;
  const viewerSchema = String(
    metaRaw.viewer_schema ?? metaRaw.viewerSchema ?? "",
  );

  const rawPieceList = Array.isArray(camel.piezas)
    ? camel.piezas
    : Array.isArray(camel.pieces)
      ? camel.pieces
      : Array.isArray(camel.panels)
        ? camel.panels
        : [];

  const rawPasos = Array.isArray(camel.pasos) ? camel.pasos : [];
  const rawStepsEn = Array.isArray(camel.steps) ? camel.steps : [];
  let steps =
    rawPasos.length > 0
      ? normalizeAssemblyStepsFromPasos(rawPasos, rawStepsEn)
      : normalizeAssemblySteps(rawStepsEn);

  let sequencePieces: AssemblySequencePiecePayload[] = [];
  if (Array.isArray(camel.sequencePieces) && camel.sequencePieces.length > 0) {
    sequencePieces = (camel.sequencePieces as unknown[])
      .map((p) => normalizeSequencePiecePayload(p, 0, viewerSchema))
      .filter((p): p is AssemblySequencePiecePayload => p != null);
  } else {
    sequencePieces = normalizeSequencePieces(rawPieceList, viewerSchema);
  }

  steps = ensureAllPiecesInSteps(sequencePieces, steps);
  sequencePieces = assignStepIndicesToPieces(sequencePieces, steps);

  let panels = normalizeAssemblyPanels(rawPieceList);
  if (panels.length === 0 && sequencePieces.length > 0) {
    panels = sequencePiecesToPanels(sequencePieces);
  }

  // Some backends embed panel geometry inside each step.
  if (panels.length === 0 && rawPasos.length > 0) {
    for (const step of rawPasos as Record<string, unknown>[]) {
      panels.push(
        ...normalizeAssemblyPanels(step.panels ?? step.pieces ?? step.piezas ?? []),
      );
    }
  }

  // Fill step panel_ids from assigned pieces when backend omits id lists.
  if (steps.length > 0 && steps.some((s) => s.panel_ids.length === 0)) {
    steps = steps.map((step, stepIndex) => {
      if (step.panel_ids.length > 0) return step;
      const ids = sequencePieces
        .filter((p) => p.stepIndex === stepIndex)
        .map((p) => p.id);
      return { ...step, panel_ids: ids };
    });
  }

  // Build sequence pieces from legacy panels + steps when no bbox list exists.
  if (sequencePieces.length === 0 && panels.length > 0 && steps.length > 0) {
    const panelById = new Map(panels.map((p) => [p.id, p]));
    for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
      for (const panelId of steps[stepIndex].panel_ids) {
        const panel = panelById.get(panelId);
        if (!panel) continue;
        sequencePieces.push({
          id: panel.id,
          stepIndex,
          kind: viewerSchema === ORIENTED_BOX_V1 ? "oriented_box" : undefined,
          position: panel.centroid,
          rotation: { x: 0, y: 0, z: 0 },
          normal: panel.normal,
          width_m: panel.width_m,
          height_m: panel.height_m,
          depth_m: panel.category === "floor" ? DEFAULT_FLOOR_THICKNESS_M : DEFAULT_WALL_THICKNESS_M,
          category: panel.category,
        });
      }
    }
  }

  const elevations = normalizeElevations(camel.elevations ?? {});

  const meta = metaRaw as Record<string, number>;
  const totalsRaw = (camel.totals ?? {}) as Record<string, number>;
  const totals = {
    wall_count: Number(
      totalsRaw.wall_count ??
        totalsRaw.wallCount ??
        meta.wall_count ??
        meta.wallCount ??
        panels.filter((p) => p.category === "wall").length,
    ),
    floor_count: Number(
      totalsRaw.floor_count ??
        totalsRaw.floorCount ??
        meta.floor_count ??
        meta.floorCount ??
        panels.filter((p) => p.category === "floor").length,
    ),
    total_panels: Number(
      totalsRaw.total_panels ??
        totalsRaw.totalPanels ??
        meta.piece_count ??
        meta.pieceCount ??
        (panels.length || sequencePieces.length),
    ),
  };

  return {
    panels,
    elevations,
    steps: steps.length > 0 ? steps : undefined,
    sequencePieces: sequencePieces.length > 0 ? sequencePieces : undefined,
    viewerSchema: viewerSchema || undefined,
    totals,
  };
}

/** Canonical normalizer for API responses and `guia_ensamble.json` from the ZIP. */
export const normalizeAssemblyGuide = normalizeAssemblyPreviewData;

/** Fetches the interactive assembly guide (`/api/assembly-guide`, alias of assembly-preview). */
export async function fetchAssemblyGuide(
  payload: AssemblyPreviewPayload,
): Promise<AssemblyPreviewData> {
  const res = await apiFetch("/api/assembly-guide", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => null);
    throw new Error(errorData?.detail || `Error al cargar instructivo: ${res.statusText}`);
  }

  const raw = await res.json();
  return normalizeAssemblyGuide(raw);
}

/** @deprecated Use fetchAssemblyGuide — kept for existing call sites. */
export async function fetchAssemblyPreview(
  payload: AssemblyPreviewPayload,
): Promise<AssemblyPreviewData> {
  try {
    return await fetchAssemblyGuide(payload);
  } catch {
    const res = await apiFetch("/api/assembly-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => null);
      throw new Error(errorData?.detail || `Error al cargar instructivo: ${res.statusText}`);
    }

    const raw = await res.json();
    return normalizeAssemblyGuide(raw);
  }
}

export async function uploadDemoObj(textContent: string, filename: string = "demo.obj"): Promise<UploadResponse> {
  const blob = new Blob([textContent], { type: "text/plain" });
  const file = new File([blob], filename, { type: "text/plain" });
  
  return uploadModelFile(file);
}

export async function generateProjectFiles(payload: GenerateRequestPayload): Promise<GenerateResponse> {
  const res = await apiFetch("/api/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => null);
    throw new Error(errorData?.detail || `Error al generar: ${res.statusText}`);
  }

  return res.json();
}
