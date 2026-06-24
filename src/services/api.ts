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
  } else if (obj !== null && obj.constructor === Object) {
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
  const res = await apiFetch("/api/nesting-preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => null);
    throw new Error(errorData?.detail || `Error al previsualizar nesting: ${res.statusText}`);
  }

  return toCamelCase(await res.json()) as NestingPreviewData;
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

/** Assembly guide response from the backend. */
export interface AssemblyPreviewData {
  panels: AssemblyPanel[];
  /** Keyed by elevation name (front/back/right/left/top). */
  elevations: Record<string, { label: string; panel_ids: string[] }>;
  totals: {
    wall_count: number;
    floor_count: number;
    total_panels: number;
  };
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

/** Fetches the interactive assembly guide data (JSON, no PDF generation). */
export async function fetchAssemblyPreview(
  payload: AssemblyPreviewPayload,
): Promise<AssemblyPreviewData> {
  const res = await apiFetch("/api/assembly-preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => null);
    throw new Error(errorData?.detail || `Error al cargar instructivo: ${res.statusText}`);
  }

  return res.json() as Promise<AssemblyPreviewData>;
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
