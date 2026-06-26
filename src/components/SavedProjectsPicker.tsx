"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, FolderOpen, Loader2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import {
  formatProjectDate,
  formatProjectSize,
  listUserProjects,
  type UserProject,
} from "@/services/projects";

interface SavedProjectsPickerProps {
  onOpenProject: (project: UserProject) => void | Promise<void>;
  openingProjectId?: string | null;
  disabled?: boolean;
}

export default function SavedProjectsPicker({
  onOpenProject,
  openingProjectId = null,
  disabled = false,
}: SavedProjectsPickerProps) {
  const { token, isAuthenticated, isLoadingAuth } = useAuth();
  const [projects, setProjects] = useState<UserProject[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadProjects = useCallback(async () => {
    if (!token) {
      setProjects([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await listUserProjects(token);
      setProjects(result.proyectos);
    } catch (err) {
      setProjects([]);
      setError(err instanceof Error ? err.message : "No se pudieron cargar tus proyectos");
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (isLoadingAuth) return;
    if (!isAuthenticated || !token) {
      setProjects([]);
      setIsLoading(false);
      return;
    }
    void loadProjects();
  }, [isLoadingAuth, isAuthenticated, token, loadProjects]);

  if (isLoadingAuth) return null;

  if (!isAuthenticated) {
    return (
      <div className="card bg-base-100 shadow-lg border border-base-200 w-full mt-4">
        <div className="card-body p-5 gap-2">
          <div className="flex items-center gap-2 text-sm text-base-content/60">
            <FolderOpen size={18} className="shrink-0" />
            <p>
              <Link href="/login" className="text-primary font-medium hover:underline">
                Iniciá sesión
              </Link>{" "}
              para abrir proyectos guardados en la nube.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="card bg-base-100 shadow-lg border border-base-200 w-full mt-4">
        <div className="card-body p-5 flex items-center gap-2 text-sm text-base-content/50">
          <Loader2 className="h-4 w-4 animate-spin" />
          Cargando tus proyectos…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card bg-base-100 shadow-lg border border-error/20 w-full mt-4">
        <div className="card-body p-5">
          <p className="text-sm text-error">{error}</p>
        </div>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="card bg-base-100 shadow-lg border border-base-200 w-full mt-4">
        <div className="card-body p-5 gap-1">
          <p className="text-sm font-medium text-base-content">Mis proyectos guardados</p>
          <p className="text-xs text-base-content/55">
            Todavía no tenés proyectos en la nube. Subí un modelo estando logueada para guardarlo acá.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="card bg-base-100 shadow-lg border border-base-200 w-full mt-4">
      <div className="card-body p-5 md:p-6 gap-4">
        <div className="flex items-start gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10 text-primary shrink-0">
            <FolderOpen size={18} />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-base-content">Mis proyectos guardados</h2>
            <p className="text-xs text-base-content/55 mt-0.5">
              Elegí uno para continuar sin volver a subir el archivo.
            </p>
          </div>
        </div>

        <ul className="space-y-2 max-h-64 overflow-y-auto pr-1">
          {projects.map((project) => {
            const isOpening = openingProjectId === project.id;
            const groups = project.metadata_impresion?.summary?.total_groups;

            return (
              <li key={project.id}>
                <button
                  type="button"
                  disabled={disabled || isOpening || Boolean(openingProjectId)}
                  onClick={() => void onOpenProject(project)}
                  className="w-full flex items-center gap-3 rounded-xl border border-base-300/60 bg-base-100/50 px-3 py-3 text-left transition-colors hover:border-primary/30 hover:bg-primary/5 disabled:opacity-60"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm truncate">{project.nombre}</p>
                    <p className="text-xs text-base-content/50 mt-0.5">
                      {formatProjectDate(project.fecha_creacion)}
                      {project.formato ? ` · ${project.formato.toUpperCase()}` : ""}
                      {project.tamano_bytes > 0
                        ? ` · ${formatProjectSize(project.tamano_bytes)}`
                        : ""}
                      {groups != null ? ` · ${groups} grupos` : ""}
                    </p>
                  </div>
                  {isOpening ? (
                    <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                  ) : (
                    <span className="btn btn-primary btn-sm btn-outline rounded-lg gap-1 shrink-0 pointer-events-none">
                      Abrir
                      <ArrowRight size={14} />
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
