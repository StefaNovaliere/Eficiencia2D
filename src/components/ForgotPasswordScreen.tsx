"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { ArrowLeft } from "lucide-react";
import BackgroundSymbols from "@/components/BackgroundSymbols";
import { requestPasswordReset } from "@/services/auth";

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      await requestPasswordReset(email.trim());
      router.push("/olvide-contrasena/enviado");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo enviar la solicitud");
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
              <img
                src="/images/logoFaviconE2d.svg"
                alt="Eficiencia2D"
                className="mx-auto w-16 h-16 e2d-logo-glow"
              />
              <h1 className="text-2xl font-extrabold tracking-tight">Olvidé mi contraseña</h1>
              <p className="text-sm text-base-content/65 leading-relaxed">
                Ingresá tu email y te enviaremos un enlace para restablecer tu contraseña.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <label className="form-control w-full">
                <span className="label-text font-medium mb-1">Email</span>
                <input
                  type="email"
                  className="input input-bordered w-full bg-base-100"
                  placeholder="tu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  disabled={isLoading}
                />
              </label>

              {error && (
                <div className="alert alert-error rounded-xl text-sm">
                  <span>{error}</span>
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
                  "Enviar enlace de recuperación"
                )}
              </button>
            </form>
          </div>
        </div>
      </div>
    </main>
  );
}
