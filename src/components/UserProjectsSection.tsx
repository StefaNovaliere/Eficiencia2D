"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, FolderOpen, Loader2, Trash2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useUserProfile } from "@/context/UserProfileContext";
import {
  deleteUserProject,
  fetchProjectDownloadUrl,
  formatProjectDate,
  formatProjectSize,
  listUserProjects,
  openProjectDownloadUrl,
  type UserProject,
} from "@/services/projects";

export default function UserProjectsSection() {
  const { token } = useAuth();
  const { refreshProfile } = useUserProfile();

  const [projects, setProjects] = useState<UserProject[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadProjects = useCallback(async () => {
    if (!token) {
      setProjects([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await listUserProjects(token);
      setProjects(result.proyectos);
      setTotal(result.total);
    } catch (err) {
      setProjects([]);
      setTotal(0);
      setError(err instanceof Error ? err.message : "No se pudo cargar tus proyectos");
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  async function handleDownload(project: UserProject) {
    if (!token) return;

    setBusyId(project.id);
    setError(null);

    try {
      const info = await fetchProjectDownloadUrl(token, project.id);
      openProjectDownloadUrl(info.download_url);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No se pudo descargar el archivo. Probá de nuevo — el enlace expira en ~1 hora.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(project: UserProject) {
    if (!token) return;

    const confirmed = window.confirm(
      `¿Eliminar "${project.nombre}"? Esta acción no se puede deshacer.`,
    );
    if (!confirmed) return;

    setBusyId(project.id);
    setError(null);

    try {
      await deleteUserProject(token, project.id);
      setProjects((prev) => prev.filter((p) => p.id !== project.id));
      await refreshProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar el proyecto");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="space-y-4 pt-2 border-t border-base-300/40">
      <div className="flex items-start gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10 text-primary shrink-0">
          <FolderOpen size={18} />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-base-content">Mis proyectos</h2>
          <p className="text-xs text-base-content/55 mt-1">
            Modelos guardados en tu cuenta ({total}). Descargá el .obj / .stl con enlace
            firmado (~1 h de validez).
          </p>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-base-content/50 py-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Cargando proyectos…
        </div>
      )}

      {!isLoading && error && (
        <div className="alert alert-error rounded-xl text-sm">
          <span>{error}</span>
        </div>
      )}

      {!isLoading && !error && projects.length === 0 && (
        <p className="text-sm text-base-content/55 py-2">
          Todavía no tenés proyectos guardados. Subí un modelo estando logueado para
          guardarlo en la nube.
        </p>
      )}

      {!isLoading && projects.length > 0 && (
        <ul className="space-y-2">
          {projects.map((project) => {
            const isBusy = busyId === project.id;
            return (
              <li
                key={project.id}
                className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-base-300/60 bg-base-100/50 px-3 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm truncate">{project.nombre}</p>
                  <p className="text-xs text-base-content/50 mt-0.5">
                    {formatProjectDate(project.fecha_creacion)}
                    {project.formato ? ` · ${project.formato.toUpperCase()}` : ""}
                    {project.tamano_bytes > 0
                      ? ` · ${formatProjectSize(project.tamano_bytes)}`
                      : ""}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    type="button"
                    className="btn btn-outline btn-sm rounded-xl border-base-300 gap-1.5"
                    disabled={isBusy}
                    onClick={() => handleDownload(project)}
                  >
                    {isBusy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download size={14} />
                    )}
                    Descargar
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm rounded-xl text-error gap-1.5"
                    disabled={isBusy}
                    onClick={() => handleDelete(project)}
                    aria-label={`Eliminar ${project.nombre}`}
                  >
                    <Trash2 size={14} />
                    Eliminar
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
