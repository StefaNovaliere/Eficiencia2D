"use client";

import Link from "next/link";
import { ArrowLeft, Keyboard } from "lucide-react";
import BackgroundSymbols from "@/components/BackgroundSymbols";
import KeyboardShortcutsPanel from "@/components/KeyboardShortcutsPanel";

export default function KeyboardShortcutsPage() {
  return (
    <main className="flex flex-col min-h-screen items-center py-2 px-4 md:px-8 relative">
      <BackgroundSymbols />

      <div className="w-full max-w-2xl z-10 mt-8 md:mt-12">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1.5 text-sm text-base-content/60 hover:text-base-content mb-6"
        >
          <ArrowLeft size={16} />
          Volver a configuración
        </Link>

        <div className="card bg-base-100 shadow-2xl border border-base-200">
          <div className="card-body p-6 md:p-8 gap-6">
            <div className="flex items-start gap-3">
              <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-primary/10 text-primary shrink-0">
                <Keyboard size={22} />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-primary/80 mb-0.5">
                  Referencia
                </p>
                <h1 className="text-2xl font-bold tracking-tight">Atajos de teclado</h1>
                <p className="text-sm text-base-content/55 mt-1">
                  Combinaciones disponibles en la pantalla de revisión del modelo.
                </p>
              </div>
            </div>

            <KeyboardShortcutsPanel />
          </div>
        </div>
      </div>
    </main>
  );
}
