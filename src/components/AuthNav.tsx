"use client";

import Link from "next/link";
import { Settings } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

interface AuthNavProps {
  /** En login/registro: solo el acceso a configuración a la izquierda. */
  hideAuthActions?: boolean;
}

export function SettingsNavLink() {
  return (
    <Link
      href="/settings"
      className="btn btn-ghost btn-sm btn-circle rounded-xl border border-base-300 bg-base-100/80 backdrop-blur shadow-md"
      title="Configuración"
      aria-label="Configuración"
    >
      <Settings size={16} />
    </Link>
  );
}

export default function AuthNav({ hideAuthActions = false }: AuthNavProps) {
  const { user, isLoadingAuth, isAuthenticated } = useAuth();

  return (
    <>
      <div className="fixed top-4 left-4 md:top-6 md:left-6 z-20">
        <SettingsNavLink />
      </div>

      {!hideAuthActions && (
        <div className="fixed top-4 right-4 z-20 flex items-center gap-2">
          {isLoadingAuth ? (
            <span className="loading loading-spinner loading-sm text-primary" />
          ) : isAuthenticated && user ? (
            <span className="hidden sm:inline text-sm text-base-content/70 bg-base-100/80 backdrop-blur px-3 py-2 rounded-xl border border-base-300">
              {user.nombre || user.email}
            </span>
          ) : (
            <>
              <Link href="/login" className="btn btn-ghost btn-sm rounded-xl">
                Ingresar
              </Link>
              <Link href="/register" className="btn btn-primary btn-sm rounded-xl shadow-primary/20">
                Registrarse
              </Link>
            </>
          )}
        </div>
      )}
    </>
  );
}
