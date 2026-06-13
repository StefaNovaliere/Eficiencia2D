"use client";

import Link from "next/link";
import { useAuth } from "@/context/AuthContext";

export default function AuthNav() {
  const { user, isLoadingAuth, logout, isAuthenticated } = useAuth();

  if (isLoadingAuth) {
    return (
      <div className="fixed top-4 right-4 z-20">
        <span className="loading loading-spinner loading-sm text-primary" />
      </div>
    );
  }

  if (isAuthenticated && user) {
    return (
      <div className="fixed top-4 right-4 z-20 flex items-center gap-2">
        <span className="hidden sm:inline text-sm text-base-content/70 bg-base-100/80 backdrop-blur px-3 py-2 rounded-xl border border-base-300">
          {user.nombre || user.email}
        </span>
        <button
          type="button"
          onClick={logout}
          className="btn btn-outline btn-sm rounded-xl border-base-300"
        >
          Salir
        </button>
      </div>
    );
  }

  return (
    <div className="fixed top-4 right-4 z-20 flex items-center gap-2">
      <Link href="/login" className="btn btn-ghost btn-sm rounded-xl">
        Ingresar
      </Link>
      <Link href="/register" className="btn btn-primary btn-sm rounded-xl shadow-primary/20">
        Registrarse
      </Link>
    </div>
  );
}
