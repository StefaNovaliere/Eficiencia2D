"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Calendar,
  FolderOpen,
  Loader2,
  Mail,
  User,
} from "lucide-react";
import { useUserProfile } from "@/context/UserProfileContext";
import { NOMBRE_MAX_LENGTH } from "@/services/users";

function formatProfileDate(iso: string | null): string {
  if (!iso) return "—";

  try {
    return new Date(iso).toLocaleDateString("es-AR", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function estadoLabel(estado: string): string {
  switch (estado) {
    case "activo":
      return "Activa";
    case "pendiente_verificacion":
      return "Pendiente de verificación";
    case "inactivo":
      return "Inactiva";
    default:
      return estado;
  }
}

export default function UserAccountSection() {
  const router = useRouter();

  const {
    profile,
    isLoadingProfile,
    profileError,
    updateNombre,
    clearProfileError,
  } = useUserProfile();

  const [nombre, setNombre] = useState("");
  const [isSavingNombre, setIsSavingNombre] = useState(false);
  const [nombreNotice, setNombreNotice] = useState<string | null>(null);
  const [nombreError, setNombreError] = useState<string | null>(null);

  useEffect(() => {
    if (profile) {
      setNombre(profile.nombre ?? "");
    }
  }, [profile]);

  async function handleNombreSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile) return;

    const trimmed = nombre.trim();
    if (trimmed.length > NOMBRE_MAX_LENGTH) {
      setNombreError(
        `El nombre no puede superar ${NOMBRE_MAX_LENGTH} caracteres.`,
      );
      return;
    }
    if (trimmed === (profile.nombre ?? "")) return;

    setIsSavingNombre(true);
    setNombreError(null);
    setNombreNotice(null);
    clearProfileError();

    try {
      await updateNombre(trimmed);
      setNombreNotice("Nombre actualizado.");
    } catch (err) {
      setNombreError(
        err instanceof Error ? err.message : "No se pudo guardar el nombre",
      );
    } finally {
      setIsSavingNombre(false);
    }
  }

  if (isLoadingProfile) {
    return (
      <section className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-base-content/50 py-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Cargando tu cuenta…
        </div>
      </section>
    );
  }

  if (!profile) {
    return profileError ? (
      <section className="alert alert-error rounded-xl text-sm">
        <span>{profileError}</span>
      </section>
    ) : null;
  }

  const nombreChanged = nombre.trim() !== (profile.nombre ?? "");

  return (
    <section className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10 text-primary shrink-0">
          <User size={18} />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-base-content">Mi cuenta</h2>
        </div>
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl border border-base-300/60 bg-base-100/50 px-3 py-2.5">
          <dt className="text-xs text-base-content/50 flex items-center gap-1.5">
            <Mail size={12} />
            Email
          </dt>
          <dd className="font-medium mt-1 truncate">{profile.email}</dd>
        </div>
        <div className="rounded-xl border border-base-300/60 bg-base-100/50 px-3 py-2.5">
          <dt className="text-xs text-base-content/50">Estado</dt>
          <dd className="font-medium mt-1">{estadoLabel(profile.estado)}</dd>
        </div>
        <div className="rounded-xl border border-base-300/60 bg-base-100/50 px-3 py-2.5">
          <dt className="text-xs text-base-content/50 flex items-center gap-1.5">
            <Calendar size={12} />
            Miembro desde
          </dt>
          <dd className="font-medium mt-1">
            {formatProfileDate(profile.fecha_creacion)}
          </dd>
        </div>
        <div className="rounded-xl border border-base-300/60 bg-base-100/50 px-3 py-2.5 sm:col-span-2">
          <dt className="text-xs text-base-content/50 flex items-center gap-1.5">
            <FolderOpen size={12} />
            Proyectos guardados
          </dt>
          <dd className="font-medium mt-1">{profile.total_proyectos}</dd>
        </div>
      </dl>

      <form
        onSubmit={handleNombreSubmit}
        className="space-y-3 pt-2 border-t border-base-300/40"
      >
        <label className="form-control w-full">
          <span className="label-text font-medium ">Nombre</span>
          <div className="flex items-center gap-3 mt-1.5 justify-between">
            <input
              type="text"
              className="input input-bordered w-full bg-base-100"
              placeholder="Tu nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              autoComplete="name"
              maxLength={NOMBRE_MAX_LENGTH}
              disabled={isSavingNombre}
            />
            <button
              type="submit"
              className="btn btn-primary btn-sm rounded-xl"
              disabled={isSavingNombre || !nombreChanged}
            >
              {isSavingNombre ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Guardar nombre"
              )}
            </button>
          </div>
        </label>
        {nombreError && <p className="text-sm text-error">{nombreError}</p>}
        {nombreNotice && !nombreError && (
          <p className="text-sm text-success">{nombreNotice}</p>
        )}
      </form>
    </section>
  );
}
