"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import BackgroundSymbols from "@/components/BackgroundSymbols";
import { useAuth } from "@/context/AuthContext";
import { Mail, CheckCircle2, ArrowRight } from "lucide-react";

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
  const [unverifiedEmail, setUnverifiedEmail] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  const isRegister = mode === "register";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      if (isRegister) {
        const res = await register(email.trim(), password, nombre.trim() || undefined);
        setPendingEmail(res.email);
      } else {
        await login(email.trim(), password);
        router.push("/");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Ocurrió un error inesperado";
      // Detectar cuenta pendiente de verificación (mensaje del backend)
      const isUnverified =
        msg.toLowerCase().includes("verific") ||
        msg.toLowerCase().includes("pendiente");
      setUnverifiedEmail(isUnverified);
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }

  // Pantalla post-registro: pedimos que revisen el correo
  if (pendingEmail) {
    return (
      <main className="flex flex-col min-h-screen items-center py-12 px-4 md:px-8 relative">
        <BackgroundSymbols />

        <div className="text-center mb-8 mt-8 md:mt-16 z-10">
          <img
            src="/images/logoFaviconE2d.svg"
            alt="Eficiencia2D"
            width={96}
            height={96}
            className="mx-auto mb-4 w-20 h-20 md:w-24 md:h-24 e2d-logo-glow"
          />
        </div>

        <div className="w-full max-w-md z-10">
          <div className="card bg-base-100 shadow-2xl border border-base-200">
            <div className="card-body p-6 md:p-8 text-center space-y-5">
              <div className="flex justify-center">
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                  <Mail size={32} className="text-primary" />
                </div>
              </div>

              <div className="space-y-2">
                <h2 className="text-2xl font-extrabold text-base-content">
                  Revisá tu correo
                </h2>
                <p className="text-base-content/70 text-sm leading-relaxed">
                  Te enviamos un link de verificación a{" "}
                  <span className="font-semibold text-base-content">{pendingEmail}</span>.
                  Hacé clic en el link para activar tu cuenta.
                </p>
              </div>

              <div className="bg-base-200/60 rounded-xl px-4 py-3 text-left space-y-2">
                <div className="flex items-start gap-2 text-sm text-base-content/70">
                  <CheckCircle2 size={16} className="text-success shrink-0 mt-0.5" />
                  <span>El correo puede tardar unos minutos.</span>
                </div>
                <div className="flex items-start gap-2 text-sm text-base-content/70">
                  <CheckCircle2 size={16} className="text-success shrink-0 mt-0.5" />
                  <span>Si no lo ves, revisá la carpeta de spam o correo no deseado.</span>
                </div>
              </div>

              <Link
                href="/login"
                className="btn btn-primary btn-block rounded-xl gap-2"
              >
                Ir al inicio de sesión
                <ArrowRight size={16} />
              </Link>

              <p className="text-xs text-base-content/40">
                Una vez verificado el correo podés iniciar sesión normalmente.
              </p>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-col min-h-screen items-center py-12 px-4 md:px-8 relative">
      <BackgroundSymbols />

      <div className="text-center mb-8 mt-8 md:mt-12 z-10">
        <img
          src="/images/logoFaviconE2d.svg"
          alt="Eficiencia2D"
          width={96}
          height={96}
          className="mx-auto mb-4 w-20 h-20 md:w-24 md:h-24 e2d-logo-glow"
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
                <div className="alert alert-error rounded-xl flex-col items-start gap-1">
                  <span>{error}</span>
                  {unverifiedEmail && (
                    <p className="text-xs opacity-80">
                      Revisá tu casilla de correo y hacé clic en el link de verificación.{" "}
                      <Link href="/register" className="underline font-medium">
                        ¿No recibiste el correo? Registrate de nuevo.
                      </Link>
                    </p>
                  )}
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
