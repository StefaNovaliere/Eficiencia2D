import { apiFetch, normalizeUploadResponse, type UploadResponse } from "@/services/api";
import { parseApiError } from "@/services/api-errors";
import {
  parseSavedState,
  type ProjectSavedState,
  type ProjectStatePatch,
  type ProjectStatePatchResponse,
} from "@/services/project-state";

export interface ProjectSummary {
  walls?: number;
  floors?: number;
  discards?: number;
  total_groups?: number;
  total_faces?: number;
  total_joints?: number;
}

export interface MetadataImpresion {
  archivo_original?: string;
  summary?: ProjectSummary;
  estado_r2?: string;
  estado_actualizado_at?: string;
  [key: string]: unknown;
}

/** Proyecto del usuario (lista o detalle). */
export interface UserProject {
  id: string;
  nombre: string;
  formato: string;
  tamano_bytes: number;
  fecha_creacion: string;
  metadata_impresion: MetadataImpresion | null;
  download_url: string | null;
  /** Clave interna en R2 — no mostrar al usuario. */
  url_archivo?: string;
}

export interface RenameUserProjectResult extends UserProject {
  estado_sincronizado: boolean;
  estado_actualizado_at: string | null;
}

export interface UserProjectsListResult {
  proyectos: UserProject[];
  total: number;
}

/** Respuesta de `GET /api/projects/{id}/download`. */
export interface ProjectDownloadInfo {
  proyecto_id: string;
  nombre: string;
  formato: string;
  download_url: string;
}

/** @deprecated Usar `UserProject`. */
export type UserProjectListItem = UserProject;

/** @deprecated Usar `UserProject`. */
export type UserProjectDetail = UserProject;

function normalizeProject(raw: unknown): UserProject | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const id = p.id ?? p.proyecto_id ?? p.file_id;
  if (id == null || id === "") return null;

  const metadata = (p.metadata_impresion ?? null) as MetadataImpresion | null;
  const archivoOriginal =
    metadata?.archivo_original ??
    (p.original_filename ? String(p.original_filename) : undefined);

  return {
    id: String(id),
    nombre: String(p.nombre ?? archivoOriginal ?? "Proyecto sin nombre"),
    formato: String(p.formato ?? ""),
    tamano_bytes: Number(p.tamano_bytes ?? 0),
    fecha_creacion: String(p.fecha_creacion ?? ""),
    metadata_impresion: metadata,
    download_url:
      typeof p.download_url === "string" && p.download_url.trim()
        ? p.download_url
        : null,
    url_archivo: p.url_archivo ? String(p.url_archivo) : undefined,
  };
}

function normalizeProjectListResponse(raw: unknown): UserProjectsListResult {
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;

    if (Array.isArray(o.proyectos)) {
      return {
        proyectos: o.proyectos
          .map(normalizeProject)
          .filter((item): item is UserProject => item != null),
        total: Number(o.total ?? o.proyectos.length),
      };
    }

    // Compatibilidad con respuestas array directo o claves legacy.
    const legacyList = o.projects ?? o.items ?? o.data;
    if (Array.isArray(legacyList)) {
      const proyectos = legacyList
        .map(normalizeProject)
        .filter((item): item is UserProject => item != null);
      return { proyectos, total: proyectos.length };
    }
  }

  if (Array.isArray(raw)) {
    const proyectos = raw
      .map(normalizeProject)
      .filter((item): item is UserProject => item != null);
    return { proyectos, total: proyectos.length };
  }

  return { proyectos: [], total: 0 };
}

/** Crea proyecto autenticado: sube archivo, procesa y guarda en R2 + BD. */
export async function createUserProject(
  token: string,
  file: File,
  nombre?: string,
): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append("file", file);
  const trimmedNombre = nombre?.trim();
  if (trimmedNombre) {
    formData.append("nombre", trimmedNombre);
  }

  const res = await apiFetch(
    "/api/users/me/projects",
    { method: "POST", body: formData },
    { token },
  );

  if (!res.ok) {
    await parseApiError(res, "No se pudo guardar el proyecto");
  }

  return normalizeUploadResponse(await res.json());
}

export async function listUserProjects(token: string): Promise<UserProjectsListResult> {
  const res = await apiFetch("/api/users/me/projects", { method: "GET" }, { token });

  if (!res.ok) {
    await parseApiError(res, "No se pudo cargar tus proyectos");
  }

  return normalizeProjectListResponse(await res.json());
}

export async function fetchUserProject(token: string, projectId: string): Promise<UserProject> {
  const res = await apiFetch(`/api/projects/${projectId}`, { method: "GET" }, { token });

  if (!res.ok) {
    await parseApiError(res, "No se pudo cargar el proyecto");
  }

  const project = normalizeProject(await res.json());
  if (!project) {
    throw new Error("Respuesta de proyecto inválida");
  }

  return project;
}

/** Renombra el proyecto en BD y sincroniza `nombre` en estado.json si existe. */
export async function renameUserProject(
  token: string,
  projectId: string,
  nombre: string,
): Promise<RenameUserProjectResult> {
  const trimmed = nombre.trim();
  if (!trimmed) {
    throw new Error("El nombre del proyecto no puede estar vacío");
  }

  const res = await apiFetch(
    `/api/projects/${projectId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre: trimmed }),
    },
    { token },
  );

  if (!res.ok) {
    await parseApiError(res, "No se pudo renombrar el proyecto");
  }

  const raw = (await res.json()) as Record<string, unknown>;
  const project = normalizeProject(raw);
  if (!project) {
    throw new Error("Respuesta de proyecto inválida");
  }

  return {
    ...project,
    estado_sincronizado: Boolean(raw.estado_sincronizado),
    estado_actualizado_at:
      typeof raw.estado_actualizado_at === "string" ? raw.estado_actualizado_at : null,
  };
}

/** Reprocesa el archivo desde R2 y devuelve topología + preview (como al subir). */
export async function openUserProject(
  token: string,
  projectId: string,
): Promise<UploadResponse> {
  const res = await apiFetch(
    `/api/projects/${projectId}/open`,
    { method: "POST" },
    { token },
  );

  if (!res.ok) {
    await parseApiError(res, "No se pudo abrir el proyecto");
  }

  const data = normalizeUploadResponse((await res.json()) as Record<string, unknown>);

  if (!data.topology || data.topology.faces.length === 0) {
    throw new Error(
      "El proyecto se procesó pero no contiene caras válidas.",
    );
  }
  if (!data.preview_obj) {
    throw new Error("El servidor no devolvió la vista previa del proyecto.");
  }

  return data;
}

function normalizeProjectStateResponse(raw: unknown): ProjectStatePatchResponse {
  const o = raw as Record<string, unknown>;
  const estado = parseSavedState(o.estado) ?? {};
  return {
    proyecto_id: String(o.proyecto_id ?? ""),
    nombre: String(o.nombre ?? ""),
    estado_r2: String(o.estado_r2 ?? ""),
    estado_actualizado_at: String(o.estado_actualizado_at ?? ""),
    estado,
    message: String(o.message ?? ""),
  };
}

/** Lee el último estado guardado en R2. */
export async function fetchProjectState(
  token: string,
  projectId: string,
): Promise<ProjectStatePatchResponse> {
  const res = await apiFetch(`/api/projects/${projectId}/state`, { method: "GET" }, { token });

  if (!res.ok) {
    await parseApiError(res, "No se pudo cargar el estado del proyecto");
  }

  return normalizeProjectStateResponse(await res.json());
}

/** Guarda cambios parciales del estado (autosave). */
export async function patchProjectState(
  token: string,
  projectId: string,
  patch: ProjectStatePatch,
  options?: { keepalive?: boolean },
): Promise<ProjectStatePatchResponse> {
  const res = await apiFetch(
    `/api/projects/${projectId}/state`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
      ...(options?.keepalive ? { keepalive: true } : {}),
    },
    { token },
  );

  if (!res.ok) {
    await parseApiError(res, "No se pudo guardar el estado del proyecto");
  }

  return normalizeProjectStateResponse(await res.json());
}

export type { ProjectSavedState, ProjectStatePatch, ProjectStatePatchResponse };

/** Obtiene URL firmada (~1 h) para descargar el archivo 3D original. */
export async function fetchProjectDownloadUrl(
  token: string,
  projectId: string,
): Promise<ProjectDownloadInfo> {
  const res = await apiFetch(
    `/api/projects/${projectId}/download`,
    { method: "GET" },
    { token },
  );

  if (!res.ok) {
    await parseApiError(res, "No se pudo obtener el enlace de descarga");
  }

  const data = (await res.json()) as Record<string, unknown>;
  const downloadUrl = data.download_url;
  if (typeof downloadUrl !== "string" || !downloadUrl.trim()) {
    throw new Error("El servidor no devolvió una URL de descarga válida");
  }

  return {
    proyecto_id: String(data.proyecto_id ?? projectId),
    nombre: String(data.nombre ?? "modelo"),
    formato: String(data.formato ?? "obj"),
    download_url: downloadUrl,
  };
}

/** Abre la URL firmada de R2 (expira ~1 h; volver a pedir si falla). */
export function openProjectDownloadUrl(downloadUrl: string): void {
  window.open(downloadUrl, "_blank", "noopener,noreferrer");
}

export async function deleteUserProject(token: string, projectId: string): Promise<void> {
  const res = await apiFetch(
    `/api/projects/${projectId}`,
    { method: "DELETE" },
    { token },
  );

  if (!res.ok) {
    await parseApiError(res, "No se pudo eliminar el proyecto");
  }

  // 204 No Content — sin body.
}

export function formatProjectSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatProjectDate(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("es-AR", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export function projectDownloadFilename(
  project: Pick<UserProject, "nombre" | "formato" | "metadata_impresion">,
): string {
  const fromMeta = project.metadata_impresion?.archivo_original;
  const base = fromMeta ?? project.nombre;
  if (/\.(obj|stl)$/i.test(base)) return base;
  const ext = project.formato ? `.${project.formato.replace(/^\./, "")}` : ".obj";
  return `${base}${ext}`;
}
