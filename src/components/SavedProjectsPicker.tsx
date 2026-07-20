"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  FolderOpen,
  Loader2,
  MoreVertical,
  Pencil,
  Trash2,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import {
  deleteUserProject,
  formatProjectDate,
  formatProjectSize,
  listUserProjects,
  renameUserProject,
  type UserProject,
} from "@/services/projects";

interface SavedProjectsPickerProps {
  onOpenProject: (project: UserProject) => void | Promise<void>;
  onProjectDeleted?: (projectId: string) => void;
  openingProjectId?: string | null;
  disabled?: boolean;
}

function ProjectActionsMenu({
  projectName,
  disabled,
  isBusy,
  onRename,
  onDelete,
}: {
  projectName: string;
  disabled: boolean;
  isBusy: boolean;
  onRename: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0 self-stretch flex">
      <button
        type="button"
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={`btn btn-ghost btn-sm rounded-xl rounded-l-none shrink-0 px-2 h-auto min-h-0 border-0 shadow-none hover:bg-base-200/70 ${
          open ? "bg-base-200 text-base-content" : "text-base-content/55 hover:text-base-content"
        }`}
        aria-label={`Más opciones para ${projectName}`}
        aria-expanded={open}
        aria-haspopup="menu"
        title="Más opciones"
      >
        {isBusy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <MoreVertical size={16} />
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 z-50 min-w-[10.5rem] rounded-xl border border-base-300/60 bg-base-100 p-1 shadow-xl"
        >
          <button
            type="button"
            role="menuitem"
            disabled={disabled}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-base-200/80 disabled:opacity-50"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onRename();
            }}
          >
            <Pencil size={14} className="shrink-0 opacity-70" />
            Renombrar
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={disabled}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-error hover:bg-error/10 disabled:opacity-50"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onDelete();
            }}
          >
            <Trash2 size={14} className="shrink-0" />
            Eliminar
          </button>
        </div>
      )}
    </div>
  );
}

export default function SavedProjectsPicker({
  onOpenProject,
  onProjectDeleted,
  openingProjectId = null,
  disabled = false,
}: SavedProjectsPickerProps) {
  const { token, isAuthenticated, isLoadingAuth } = useAuth();
  const [projects, setProjects] = useState<UserProject[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameSavingId, setRenameSavingId] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const isBusy =
    disabled ||
    Boolean(openingProjectId) ||
    Boolean(deletingProjectId) ||
    Boolean(renameSavingId);

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

  useEffect(() => {
    if (!renamingProjectId) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [renamingProjectId]);

  const startRename = useCallback((project: UserProject) => {
    setError(null);
    setRenamingProjectId(project.id);
    setRenameValue(project.nombre);
  }, []);

  const cancelRename = useCallback(() => {
    setRenamingProjectId(null);
    setRenameValue("");
  }, []);

  const handleRenameSubmit = useCallback(
    async (project: UserProject) => {
      if (!token || isBusy) return;

      const next = renameValue.trim();
      if (!next) {
        setError("El nombre del proyecto no puede estar vacío");
        return;
      }
      if (next.length > 200) {
        setError("El nombre no puede superar los 200 caracteres");
        return;
      }
      if (next === project.nombre) {
        cancelRename();
        return;
      }

      setRenameSavingId(project.id);
      setError(null);

      try {
        const updated = await renameUserProject(token, project.id, next);
        setProjects((prev) =>
          prev.map((item) => (item.id === project.id ? { ...item, ...updated } : item)),
        );
        cancelRename();
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se pudo renombrar el proyecto");
      } finally {
        setRenameSavingId(null);
      }
    },
    [token, isBusy, renameValue, cancelRename],
  );

  const handleDeleteProject = useCallback(
    async (project: UserProject) => {
      if (!token || isBusy) return;

      const confirmed = window.confirm(
        `¿Eliminar "${project.nombre}"? Esta acción no se puede deshacer.`,
      );
      if (!confirmed) return;

      setDeletingProjectId(project.id);
      setError(null);

      try {
        await deleteUserProject(token, project.id);
        setProjects((prev) => prev.filter((item) => item.id !== project.id));
        if (renamingProjectId === project.id) cancelRename();
        onProjectDeleted?.(project.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se pudo eliminar el proyecto");
      } finally {
        setDeletingProjectId(null);
      }
    },
    [token, isBusy, onProjectDeleted, renamingProjectId, cancelRename],
  );

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

  if (error && projects.length === 0) {
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

        <ul className="space-y-2 max-h-64 overflow-y-auto overflow-x-visible pr-1">
          {projects.map((project) => {
            const isOpening = openingProjectId === project.id;
            const isDeleting = deletingProjectId === project.id;
            const isRenaming = renamingProjectId === project.id;
            const isRenameSaving = renameSavingId === project.id;
            const groups = project.metadata_impresion?.summary?.total_groups;

            return (
              <li key={project.id} className="flex items-stretch gap-2">
                {isRenaming ? (
                  <form
                    className="flex-1 min-w-0 flex items-center gap-2 rounded-xl border border-primary/35 bg-primary/5 px-3 py-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void handleRenameSubmit(project);
                    }}
                  >
                    <input
                      ref={renameInputRef}
                      type="text"
                      value={renameValue}
                      maxLength={200}
                      disabled={isRenameSaving}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          e.preventDefault();
                          cancelRename();
                        }
                      }}
                      className="input input-sm input-bordered flex-1 min-w-0 rounded-lg text-sm"
                      aria-label="Nuevo nombre del proyecto"
                    />
                    <button
                      type="submit"
                      disabled={isRenameSaving || !renameValue.trim()}
                      className="btn btn-primary btn-sm rounded-lg shrink-0"
                    >
                      {isRenameSaving ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Guardar"
                      )}
                    </button>
                    <button
                      type="button"
                      disabled={isRenameSaving}
                      onClick={cancelRename}
                      className="btn btn-ghost btn-sm rounded-lg shrink-0"
                    >
                      Cancelar
                    </button>
                  </form>
                ) : (
                  <div className="flex-1 min-w-0 flex items-stretch rounded-xl border border-base-300/60 bg-base-100/50 transition-colors hover:border-primary/30 hover:bg-primary/5 has-[:disabled]:opacity-60">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void onOpenProject(project)}
                      className="flex-1 btn btn-ghost min-w-0 h-auto min-h-0 flex items-center gap-3 rounded-xl rounded-r-none border-0 bg-transparent px-3 py-3 text-left shadow-none hover:bg-transparent disabled:opacity-100"
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
                      {isOpening && (
                        <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                      )}
                    </button>
                    <ProjectActionsMenu
                      projectName={project.nombre}
                      disabled={isBusy}
                      isBusy={isDeleting || isRenameSaving}
                      onRename={() => startRename(project)}
                      onDelete={() => void handleDeleteProject(project)}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {error && (
          <p className="text-sm text-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
