"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Shield } from "lucide-react";
import AdminPanel from "@/components/AdminPanel";
import BackgroundSymbols from "@/components/BackgroundSymbols";
import { useAuth } from "@/context/AuthContext";

export default function AdminPage() {
  const router = useRouter();
  const { user, isLoadingAuth, isAdmin } = useAuth();

  useEffect(() => {
    if (isLoadingAuth) return;
    if (!isAdmin) {
      router.replace("/home");
    }
  }, [isLoadingAuth, isAdmin, router]);

  if (isLoadingAuth || !isAdmin || !user) {
    return (
      <main className="flex flex-col min-h-screen items-center justify-center px-4">
        <span className="loading loading-spinner loading-lg text-primary" />
      </main>
    );
  }

  return (
    <main className="flex flex-col min-h-screen items-center py-12 px-4 md:px-8 relative">
      <BackgroundSymbols />

      <div className="w-full max-w-3xl z-10 mt-8 md:mt-12">
        <Link
          href="/home"
          className="inline-flex items-center gap-1.5 text-sm text-base-content/60 hover:text-base-content mb-6"
        >
          <ArrowLeft size={16} />
          Volver al inicio
        </Link>

        <div className="card bg-base-100 shadow-2xl border border-base-200">
          <div className="card-body p-6 md:p-8 gap-6">
            <div className="flex items-start gap-3">
              <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-primary/10 text-primary shrink-0">
                <Shield size={22} />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-primary/80 mb-0.5">
                  Administración
                </p>
                <h1 className="text-2xl font-bold tracking-tight">Panel de administrador</h1>
                <p className="text-sm text-base-content/55 mt-1">
                  Herramientas de gestión de la plataforma Eficiencia2D.
                </p>
              </div>
            </div>

            <AdminPanel user={user} />
          </div>
        </div>
      </div>
    </main>
  );
}
