import type { UserCut } from "@/core/user-cuts";
import { serializeUserCutsForApi } from "@/core/user-cuts";
import { decodePackedFaces } from "@/core/packed-faces";
import {
  invalidateApiBaseUrl,
  resolveApiBaseUrl,
} from "@/services/api-base";

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
  topology: any; // Mapped to Phase1Result in frontend
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

export interface GenerateRequestPayload {
  file_id: string;
  original_filename: string;
  scale_denom?: number;
  paper?: string;
  min_area_m2?: number;
  sheet_config?: {
    width_m: number;
    height_m: number;
    gap_m: number;
  };
  overrides?: Record<number, string>;
  wall_wall_decisions?: Record<number, number>;
  merges?: number[][];
  /** GeometryGroup ids whose openings (inner-ring holes) must be engraved
   *  (red, MARK_VECTOR / ACI 1) instead of cut. */
  marks?: number[];
  /** User-defined subtractive cuts in panel-local metres (see user-cuts.ts). */
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
    const topo = data.topology;

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
    camel.stem ??= data.original_filename?.replace(/\.[^.]+$/, "") ?? "";
    camel.warnings ??= [];

    data.topology = camel;
  }
  return data;
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
