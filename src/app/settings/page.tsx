"use client";

import Link from "next/link";
import { ArrowLeft, Settings } from "lucide-react";
import BackgroundSymbols from "@/components/BackgroundSymbols";
import UserSettingsForm from "@/components/UserSettingsForm";
import { useAuth } from "@/context/AuthContext";

export default function SettingsPage() {
  const { isAuthenticated } = useAuth();

  return (
    <main className="flex flex-col min-h-screen items-center py-2 px-4 md:px-8 relative">
      <BackgroundSymbols />

      <div className="w-full max-w-3xl z-10 ">
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
                <Settings size={22} />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-primary/80 mb-0.5">
                  {isAuthenticated ? "Cuenta" : "Aplicación"}
                </p>
                <h1 className="text-2xl font-bold tracking-tight">Configuración</h1>
               
              </div>
            </div>

            <UserSettingsForm />
          </div>
        </div>
      </div>
    </main>
  );
}
