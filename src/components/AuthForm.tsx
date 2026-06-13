"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import BackgroundSymbols from "@/components/BackgroundSymbols";
import { ThemePicker } from "@/context/ThemeContext";
import { useAuth } from "@/context/AuthContext";

type AuthMode = "login" | "register";

interface AuthFormProps {
  mode: AuthMode;
}

export default function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const { login, register } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nombre, setNombre] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const isRegister = mode === "register";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      if (isRegister) {
        await register(email.trim(), password, nombre.trim() || undefined);
      } else {
        await login(email.trim(), password);
      }
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ocurrió un error inesperado");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="flex flex-col min-h-screen items-center py-12 px-4 md:px-8 relative">
      <ThemePicker />

      <div className="fixed top-4 right-4 z-20">
        <Link href="/" className="btn btn-ghost btn-sm rounded-xl">
          Volver al inicio
        </Link>
      </div>

      <BackgroundSymbols />

      <div className="text-center mb-8 mt-8 md:mt-12 z-10">
        <img
          src="/images/logoFaviconE2d.svg"
          alt="Eficiencia2D"
          width={96}
          height={96}
          className="mx-auto mb-4 w-20 h-20 md:w-24 md:h-24 drop-shadow-md"
        />
        <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-2 text-base-content">
          {isRegister ? "Crear cuenta" : "Iniciar sesión"}
        </h1>
        <p className="text-base text-base-content/70 max-w-md mx-auto">
          {isRegister
            ? "Registrate para probar la gestión de usuarios."
            : "Ingresá con tu email y contraseña."}
        </p>
      </div>

      <div className="w-full max-w-md z-10">
        <div className="card bg-base-100 shadow-2xl border border-base-200">
          <div className="card-body p-6 md:p-8">
            <form onSubmit={handleSubmit} className="space-y-4">
              {isRegister && (
                <label className="form-control w-full">
                  <span className="label-text font-medium mb-1">Nombre</span>
                  <input
                    type="text"
                    className="input input-bordered w-full bg-base-100"
                    placeholder="Tu nombre"
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                    autoComplete="name"
                  />
                </label>
              )}

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
                />
              </label>

              <label className="form-control w-full">
                <span className="label-text font-medium mb-1">Contraseña</span>
                <input
                  type="password"
                  className="input input-bordered w-full bg-base-100"
                  placeholder={isRegister ? "Mínimo 6 caracteres" : "Tu contraseña"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={isRegister ? 6 : 1}
                  autoComplete={isRegister ? "new-password" : "current-password"}
                />
              </label>

              {error && (
                <div className="alert alert-error rounded-xl">
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className="btn btn-primary btn-block rounded-xl shadow-lg shadow-primary/20 mt-2"
              >
                {isLoading ? (
                  <span className="loading loading-spinner loading-md" />
                ) : isRegister ? (
                  "Registrarme"
                ) : (
                  "Entrar"
                )}
              </button>
            </form>

            <p className="text-center text-sm text-base-content/70 mt-4">
              {isRegister ? (
                <>
                  ¿Ya tenés cuenta?{" "}
                  <Link href="/login" className="text-primary font-medium hover:underline">
                    Iniciar sesión
                  </Link>
                </>
              ) : (
                <>
                  ¿No tenés cuenta?{" "}
                  <Link href="/register" className="text-primary font-medium hover:underline">
                    Crear cuenta
                  </Link>
                </>
              )}
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
