"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, XCircle, Loader2, Mail } from "lucide-react";
import BackgroundSymbols from "@/components/BackgroundSymbols";
import { useAuth } from "@/context/AuthContext";

// Contenido real separado porque useSearchParams requiere Suspense
function VerifyEmailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { verifyEmail } = useAuth();

  const token = searchParams.get("token");

  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!token?.trim()) {
      setStatus("error");
      setErrorMsg("No se encontró el token de verificación en el link.");
      return;
    }

    verifyEmail(token.trim())
      .then(() => {
        setStatus("success");
        setTimeout(() => router.push("/"), 2000);
      })
      .catch((err: unknown) => {
        setStatus("error");
        setErrorMsg(
          err instanceof Error
            ? err.message
            : "El link de verificación es inválido o ya expiró.",
        );
      });
  }, [token, verifyEmail, router]);

  return (
    <main className="flex flex-col min-h-screen items-center justify-center py-12 px-4 relative">
      <BackgroundSymbols />

      <div className="w-full max-w-md z-10">
        <div className="card bg-base-100 shadow-2xl border border-base-200">
          <div className="card-body p-6 md:p-8 text-center space-y-5">

            {/* Logo */}
            <img
              src="/images/logoFaviconE2d.svg"
              alt="Eficiencia2D"
              className="mx-auto w-14 h-14 drop-shadow-md"
            />

            {/* Estado: cargando */}
            {status === "loading" && (
              <>
                <div className="flex justify-center">
                  <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                    <Loader2 size={32} className="text-primary animate-spin" />
                  </div>
                </div>
                <div className="space-y-1">
                  <h2 className="text-xl font-bold text-base-content">Verificando tu cuenta…</h2>
                  <p className="text-sm text-base-content/60">Esto solo tarda un momento.</p>
                </div>
              </>
            )}

            {/* Estado: éxito */}
            {status === "success" && (
              <>
                <div className="flex justify-center">
                  <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center">
                    <CheckCircle2 size={32} className="text-success" />
                  </div>
                </div>
                <div className="space-y-2">
                  <h2 className="text-xl font-bold text-base-content">¡Cuenta verificada!</h2>
                  <p className="text-sm text-base-content/60 leading-relaxed">
                    Tu email fue confirmado correctamente. Ya iniciaste sesión — te
                    redirigimos en un momento.
                  </p>
                </div>
                <div className="flex items-center justify-center gap-2 text-xs text-base-content/40">
                  <Loader2 size={13} className="animate-spin" />
                  Redirigiendo…
                </div>
              </>
            )}

            {/* Estado: error */}
            {status === "error" && (
              <>
                <div className="flex justify-center">
                  <div className="w-16 h-16 rounded-full bg-error/10 flex items-center justify-center">
                    <XCircle size={32} className="text-error" />
                  </div>
                </div>
                <div className="space-y-2">
                  <h2 className="text-xl font-bold text-base-content">Link inválido</h2>
                  <p className="text-sm text-base-content/60 leading-relaxed">{errorMsg}</p>
                </div>

                <div className="bg-base-200/60 rounded-xl px-4 py-3 text-left space-y-2">
                  <p className="text-xs text-base-content/50 font-medium">¿Qué puedo hacer?</p>
                  <ul className="text-xs text-base-content/60 space-y-1.5">
                    <li className="flex items-start gap-1.5">
                      <Mail size={12} className="shrink-0 mt-0.5 text-base-content/40" />
                      Revisá que hayas copiado el link completo del correo.
                    </li>
                    <li className="flex items-start gap-1.5">
                      <Mail size={12} className="shrink-0 mt-0.5 text-base-content/40" />
                      Los links de verificación expiran. Intentá registrarte de nuevo.
                    </li>
                  </ul>
                </div>

                <div className="flex flex-col gap-2">
                  <Link href="/register" className="btn btn-primary btn-block rounded-xl">
                    Crear cuenta nueva
                  </Link>
                  <Link href="/login" className="btn btn-ghost btn-block rounded-xl text-sm">
                    Iniciar sesión
                  </Link>
                </div>
              </>
            )}

          </div>
        </div>
      </div>
    </main>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center">
          <span className="loading loading-spinner loading-lg text-primary" />
        </main>
      }
    >
      <VerifyEmailContent />
    </Suspense>
  );
}
