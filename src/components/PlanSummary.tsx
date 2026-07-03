"use client";

import Link from "next/link";
import { CreditCard, Loader2 } from "lucide-react";
import { useSubscription } from "@/context/SubscriptionContext";

/**
 * Resumen compacto del plan para Configuración: muestra el plan actual y un
 * acceso a la página dedicada `/planes` (el grid completo vive ahí).
 */
export default function PlanSummary() {
  const { currentPlan, isLoading } = useSubscription();

  return (
    <section className="space-y-3 pt-2 border-t border-base-300/40">
      <div className="flex items-start gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10 text-primary shrink-0">
          <CreditCard size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-base-content">Plan</h2>
          <p className="text-xs text-base-content/55 mt-1">
            {isLoading ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Cargando…
              </span>
            ) : (
              `Plan actual: ${currentPlan?.nombre ?? "Gratis"}`
            )}
          </p>
        </div>
        <Link
          href="/planes"
          className="btn btn-outline btn-sm rounded-xl border-base-300 gap-2 shrink-0"
        >
          <CreditCard size={16} />
          Ver planes
        </Link>
      </div>
    </section>
  );
}
