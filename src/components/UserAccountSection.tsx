"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Calendar,
  FolderOpen,
  KeyRound,
  Loader2,
  LogOut,
  Mail,
  MailCheck,
  User,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useUserProfile } from "@/context/UserProfileContext";
import {
  NOMBRE_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "@/services/users";

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
  const { logout } = useAuth();
  const {
    profile,
    isLoadingProfile,
    profileError,
    updateNombre,
    changePassword,
    clearProfileError,
  } = useUserProfile();

  const [nombre, setNombre] = useState("");
  const [isSavingNombre, setIsSavingNombre] = useState(false);
  const [nombreNotice, setNombreNotice] = useState<string | null>(null);
  const [nombreError, setNombreError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [passwordNotice, setPasswordNotice] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

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
      setNombreError(`El nombre no puede superar ${NOMBRE_MAX_LENGTH} caracteres.`);
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
      setNombreError(err instanceof Error ? err.message : "No se pudo guardar el nombre");
    } finally {
      setIsSavingNombre(false);
    }
  }

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      setPasswordError(
        `La nueva contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`,
      );
      return;
    }
    if (newPassword.length > PASSWORD_MAX_LENGTH) {
      setPasswordError(
        `La nueva contraseña no puede superar ${PASSWORD_MAX_LENGTH} caracteres.`,
      );
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Las contraseñas nuevas no coinciden.");
      return;
    }
    if (newPassword === currentPassword) {
      setPasswordError("La nueva contraseña debe ser distinta a la actual.");
      return;
    }

    setIsSavingPassword(true);
    setPasswordError(null);
    setPasswordNotice(null);
    clearProfileError();

    try {
      const message = await changePassword(currentPassword, newPassword);
      setPasswordNotice(message);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setPasswordError(
        err instanceof Error ? err.message : "No se pudo cambiar la contraseña",
      );
    } finally {
      setIsSavingPassword(false);
    }
  }

  function handleLogout() {
    logout();
    router.push("/");
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
      <div className="flex items-start gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10 text-primary shrink-0">
          <User size={18} />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-base-content">Mi cuenta</h2>
          <p className="text-xs text-base-content/55 mt-1">
            Datos de tu perfil y seguridad de la cuenta.
          </p>
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
          <dd className="font-medium mt-1">{formatProfileDate(profile.fecha_creacion)}</dd>
        </div>
        <div className="rounded-xl border border-base-300/60 bg-base-100/50 px-3 py-2.5">
          <dt className="text-xs text-base-content/50 flex items-center gap-1.5">
            <MailCheck size={12} />
            Email verificado
          </dt>
          <dd className="font-medium mt-1">{formatProfileDate(profile.email_verified_at)}</dd>
        </div>
        <div className="rounded-xl border border-base-300/60 bg-base-100/50 px-3 py-2.5 sm:col-span-2">
          <dt className="text-xs text-base-content/50 flex items-center gap-1.5">
            <FolderOpen size={12} />
            Proyectos guardados
          </dt>
          <dd className="font-medium mt-1">{profile.total_proyectos}</dd>
        </div>
      </dl>

      <form onSubmit={handleNombreSubmit} className="space-y-3 pt-2 border-t border-base-300/40">
        <label className="form-control w-full">
          <span className="label-text font-medium mb-1">Nombre</span>
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
        </label>
        {nombreError && (
          <p className="text-sm text-error">{nombreError}</p>
        )}
        {nombreNotice && !nombreError && (
          <p className="text-sm text-success">{nombreNotice}</p>
        )}
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
      </form>

      <form onSubmit={handlePasswordSubmit} className="space-y-3 pt-2 border-t border-base-300/40">
        <div className="flex items-start gap-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-base-200/80 text-base-content/70 shrink-0">
            <KeyRound size={16} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-base-content">Cambiar contraseña</h3>
            <p className="text-xs text-base-content/55 mt-0.5">
              Mínimo {PASSWORD_MIN_LENGTH} caracteres.
            </p>
          </div>
        </div>

        <label className="form-control w-full">
          <span className="label-text font-medium mb-1">Contraseña actual</span>
          <input
            type="password"
            className="input input-bordered w-full bg-base-100"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            required
            disabled={isSavingPassword}
          />
        </label>
        <label className="form-control w-full">
          <span className="label-text font-medium mb-1">Nueva contraseña</span>
          <input
            type="password"
            className="input input-bordered w-full bg-base-100"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            maxLength={PASSWORD_MAX_LENGTH}
            disabled={isSavingPassword}
          />
        </label>
        <label className="form-control w-full">
          <span className="label-text font-medium mb-1">Confirmar nueva contraseña</span>
          <input
            type="password"
            className="input input-bordered w-full bg-base-100"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            disabled={isSavingPassword}
          />
        </label>
        {passwordError && (
          <p className="text-sm text-error">{passwordError}</p>
        )}
        {passwordNotice && !passwordError && (
          <p className="text-sm text-success">{passwordNotice}</p>
        )}
        <button
          type="submit"
          className="btn btn-outline btn-sm rounded-xl border-base-300"
          disabled={isSavingPassword}
        >
          {isSavingPassword ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            "Actualizar contraseña"
          )}
        </button>
      </form>

      <div className="pt-2 border-t border-base-300/40">
        <button
          type="button"
          onClick={handleLogout}
          className="btn btn-outline btn-sm rounded-xl border-base-300 gap-2"
        >
          <LogOut size={16} />
          Salir de la sesión
        </button>
      </div>
    </section>
  );
}
