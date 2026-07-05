"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import BackgroundSymbols from "@/components/BackgroundSymbols";
import { useAuth } from "@/context/AuthContext";
import {
  NOMBRE_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "@/services/auth";
import { getRols, type Rol } from "@/services/rols";
import { Mail, CheckCircle2, ArrowRight, Eye, EyeOff } from "lucide-react";

type AuthMode = "login" | "register";

interface AuthFormProps {
  mode: AuthMode;
  /** Mensaje tras restablecer contraseña (login). */
  passwordUpdatedNotice?: boolean;
}

export default function AuthForm({ mode, passwordUpdatedNotice }: AuthFormProps) {
  const router = useRouter();
  const { login, register } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [nombre, setNombre] = useState("");
  const [rols, setRols] = useState<Rol[]>([]);
  const [selectedRolId, setSelectedRolId] = useState<number | "">("");
  const [isLoadingRols, setIsLoadingRols] = useState(false);
  const [error, setError] = useState("");
  const [unverifiedEmail, setUnverifiedEmail] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  const isRegister = mode === "register";

  useEffect(() => {
    if (!isRegister) return;

    let cancelled = false;
    setIsLoadingRols(true);

    getRols()
      .then((loadedRols) => {
        if (cancelled) return;
        const safeRols = Array.isArray(loadedRols) ? loadedRols : [];
        setRols(safeRols);
        if (safeRols.length === 1) {
          setSelectedRolId(safeRols[0].id);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setRols([]);
        setError("No se pudieron cargar los roles disponibles.");
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingRols(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isRegister]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setUnverifiedEmail(false);

    const trimmedEmail = email.trim();
    if (isRegister) {
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
      const trimmedNombre = nombre.trim();
      if (trimmedNombre.length > NOMBRE_MAX_LENGTH) {
        setError(`El nombre no puede superar ${NOMBRE_MAX_LENGTH} caracteres.`);
        return;
      }
      if (selectedRolId === "") {
        setError("Seleccioná un rol para tu cuenta.");
        return;
      }
    }

    setIsLoading(true);

    try {
      if (isRegister) {
        // El rol ya se validó arriba; este guard estrecha el tipo (number | "" -> number).
        if (selectedRolId === "") return;
        const res = await register(
          trimmedEmail,
          password,
          selectedRolId,
          nombre.trim() || undefined,
        );
        setPendingEmail(res.email);
      } else {
        await login(trimmedEmail, password);
        router.push("/home");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Ocurrió un error inesperado";
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
      <main className="flex flex-col min-h-screen items-center py-2 px-4 md:px-8 relative">
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
    <main className="flex flex-col min-h-screen items-center py-2 px-4 md:px-8 relative">
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
            <form onSubmit={handleSubmit} className="space-y-6">
              {passwordUpdatedNotice && !isRegister && (
                <div className="alert alert-success rounded-xl text-sm">
                  <span>Contraseña actualizada. Ya podés iniciar sesión.</span>
                </div>
              )}

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
                    maxLength={NOMBRE_MAX_LENGTH}
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
                <div className="relative">
                  <input
                    type={isRegister && showPassword ? "text" : "password"}
                    className="input input-bordered w-full bg-base-100 pr-11"
                    placeholder={isRegister ? "Mínimo 6 caracteres" : "Tu contraseña"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={isRegister ? PASSWORD_MIN_LENGTH : 1}
                    maxLength={isRegister ? PASSWORD_MAX_LENGTH : undefined}
                    autoComplete={isRegister ? "new-password" : "current-password"}
                  />
                  {isRegister && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm btn-circle absolute right-1 top-1/2 -translate-y-1/2"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  )}
                </div>
              </label>

                  
              {!isRegister && (
                <div className="text-right -mt-1">
                  <Link
                    href="/olvide-contrasena"
                    className="text-sm text-primary font-medium hover:underline"
                  >
                    ¿Olvidaste tu contraseña?
                  </Link>
                </div>
              )}

              {isRegister && (
                <label className="form-control w-full">
                  <span className="label-text font-medium mb-1">Confirmar contraseña</span>
                  <div className="relative">
                    <input
                      type={showConfirmPassword ? "text" : "password"}
                      className="input input-bordered w-full bg-base-100 pr-11"
                      placeholder="Repetí tu contraseña"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      minLength={PASSWORD_MIN_LENGTH}
                      maxLength={PASSWORD_MAX_LENGTH}
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm btn-circle absolute right-1 top-1/2 -translate-y-1/2"
                      onClick={() => setShowConfirmPassword((v) => !v)}
                      aria-label={showConfirmPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                    >
                      {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </label>
              )}


{isRegister && (
                <label className="form-control w-full">
                  <span className="label-text font-medium mb-1">Rol</span>
                  <select
                    className="select select-bordered w-full bg-base-100"
                    value={selectedRolId}
                    onChange={(e) => {
                      const value = e.target.value;
                      setSelectedRolId(value === "" ? "" : Number(value));
                    }}
                    required
                    disabled={isLoadingRols || rols.length === 0}
                  >
                    <option value="" disabled>
                      {isLoadingRols ? "Cargando roles…" : "Seleccioná un rol"}
                    </option>
                    {rols.map((rol) => (
                      <option key={rol.id} value={rol.id}>
                        {rol.rol}
                      </option>
                    ))}
                  </select>
                </label>
              )}

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
                disabled={isLoading || (isRegister && (isLoadingRols || selectedRolId === ""))}
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
