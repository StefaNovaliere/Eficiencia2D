"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useState } from "react";
import { ArrowLeft, CheckCircle2, XCircle } from "lucide-react";
import BackgroundSymbols from "@/components/BackgroundSymbols";
import PasswordField from "@/components/PasswordField";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  resetPasswordWithToken,
} from "@/services/auth";

export default function ResetPasswordScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  if (!token) {
    return (
      <main className="flex flex-col min-h-screen items-center justify-center py-2 px-4 relative">
        <BackgroundSymbols />
        <div className="w-full max-w-md z-10 card bg-base-100 shadow-2xl border border-base-200">
          <div className="card-body p-6 md:p-8 text-center space-y-4">
            <div className="flex justify-center">
              <div className="w-14 h-14 rounded-full bg-error/10 flex items-center justify-center">
                <XCircle size={28} className="text-error" />
              </div>
            </div>
            <h1 className="text-xl font-bold">Enlace inválido</h1>
            <p className="text-sm text-base-content/60">
              El link de recuperación está incompleto o expiró. Solicitá uno nuevo.
            </p>
            <Link href="/olvide-contrasena" className="btn btn-primary btn-block rounded-xl">
              Solicitar nuevo enlace
            </Link>
            <Link href="/login" className="btn btn-ghost btn-sm">
              Volver al login
            </Link>
          </div>
        </div>
      </main>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (password.length < PASSWORD_MIN_LENGTH) {
      setError(`La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`);
      return;
    }
    if (password.length > PASSWORD_MAX_LENGTH) {
      setError(`La contraseña no puede superar ${PASSWORD_MAX_LENGTH} caracteres.`);
      return;
    }
    if (password !== confirmPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setIsLoading(true);

    try {
      await resetPasswordWithToken(token, password);
      router.push("/login?passwordUpdated=1");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al restablecer la contraseña");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="flex flex-col min-h-screen items-center py-2 px-4 md:px-8 relative">
      <BackgroundSymbols />

      <div className="w-full max-w-md z-10 mt-8 md:mt-12">
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 text-sm text-base-content/60 hover:text-base-content mb-6"
        >
          <ArrowLeft size={16} />
          Volver al inicio de sesión
        </Link>

        <div className="card bg-base-100 shadow-2xl border border-base-200">
          <div className="card-body p-6 md:p-8 gap-5">
            <div className="text-center space-y-2">
              <div className="flex justify-center">
                <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                  <CheckCircle2 size={28} className="text-primary" />
                </div>
              </div>
              <h1 className="text-2xl font-extrabold tracking-tight">Nueva contraseña</h1>
              <p className="text-sm text-base-content/65">
                Elegí una contraseña nueva para tu cuenta.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <PasswordField
                label="Nueva contraseña"
                value={password}
                onChange={setPassword}
                placeholder={`Mínimo ${PASSWORD_MIN_LENGTH} caracteres`}
                minLength={PASSWORD_MIN_LENGTH}
                maxLength={PASSWORD_MAX_LENGTH}
                disabled={isLoading}
              />
              <PasswordField
                label="Confirmar contraseña"
                value={confirmPassword}
                onChange={setConfirmPassword}
                placeholder="Repetí tu contraseña"
                minLength={PASSWORD_MIN_LENGTH}
                maxLength={PASSWORD_MAX_LENGTH}
                disabled={isLoading}
              />

              {error && (
                <div className="alert alert-error rounded-xl text-sm flex-col items-start gap-2">
                  <span>{error}</span>
                  {(error.toLowerCase().includes("expir") ||
                    error.toLowerCase().includes("inválid") ||
                    error.toLowerCase().includes("utiliz")) && (
                    <Link
                      href="/olvide-contrasena"
                      className="text-xs underline font-medium"
                    >
                      Solicitar un enlace nuevo
                    </Link>
                  )}
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className="btn btn-primary btn-block rounded-xl shadow-lg shadow-primary/20"
              >
                {isLoading ? (
                  <span className="loading loading-spinner loading-md" />
                ) : (
                  "Restablecer contraseña"
                )}
              </button>
            </form>
          </div>
        </div>
      </div>
    </main>
  );
}
