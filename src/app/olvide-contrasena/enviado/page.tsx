import Link from "next/link";
import { ArrowRight, Mail } from "lucide-react";
import BackgroundSymbols from "@/components/BackgroundSymbols";

export default function OlvideContrasenaEnviadoPage() {
  return (
    <main className="flex flex-col min-h-screen items-center py-12 px-4 md:px-8 relative">
      <BackgroundSymbols />

      <div className="w-full max-w-md z-10 mt-8 md:mt-16">
        <div className="card bg-base-100 shadow-2xl border border-base-200">
          <div className="card-body p-6 md:p-8 text-center space-y-5">
            <div className="flex justify-center">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                <Mail size={32} className="text-primary" />
              </div>
            </div>

            <div className="space-y-2">
              <h1 className="text-2xl font-extrabold text-base-content">Revisá tu bandeja de entrada</h1>
              <p className="text-sm text-base-content/70 leading-relaxed">
                Si el correo está registrado, recibirás un enlace para restablecer tu contraseña.
                El enlace expira en aproximadamente 1 hora.
              </p>
            </div>

            <p className="text-xs text-base-content/45">
              Por seguridad, mostramos el mismo mensaje aunque el email no exista en nuestro sistema.
            </p>

            <Link href="/login" className="btn btn-primary btn-block rounded-xl gap-2">
              Ir al inicio de sesión
              <ArrowRight size={16} />
            </Link>

            <Link
              href="/olvide-contrasena"
              className="btn btn-ghost btn-sm text-base-content/60"
            >
              Enviar otro enlace
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
