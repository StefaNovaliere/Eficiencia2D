"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, CreditCard } from "lucide-react";
import BackgroundSymbols from "@/components/BackgroundSymbols";
import PlanSelector from "@/components/PlanSelector";
import { useSubscription } from "@/context/SubscriptionContext";

function PlanesContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { refresh } = useSubscription();
  const [banner, setBanner] = useState<"ok" | "pending" | null>(null);

  useEffect(() => {
    const paid = searchParams.get("paid");
    if (paid == null) return;

    void refresh().then(() => {
      setBanner(paid === "1" ? "ok" : "pending");
      router.replace("/planes", { scroll: false });
    });
  }, [searchParams, refresh, router]);

  return (
    <main className="flex flex-col min-h-screen items-center py-2 px-4 md:px-8 relative">
      <BackgroundSymbols />

      <div className="w-full max-w-3xl z-10 mt-8 md:mt-12">
        <Link
          href="/home"
          className="inline-flex items-center gap-1.5 text-sm text-base-content/60 hover:text-base-content mb-6"
        >
          <ArrowLeft size={16} />
          Volver al inicio
        </Link>

        {banner === "ok" && (
          <div className="alert alert-success rounded-xl mb-4 text-sm">
            <span>Pago recibido. Tu plan se activará en cuanto Mercado Pago confirme la suscripción.</span>
          </div>
        )}
        {banner === "pending" && (
          <div className="alert alert-warning rounded-xl mb-4 text-sm">
            <span>El pago no se completó. Podés elegir el plan de nuevo cuando quieras.</span>
          </div>
        )}

        <div className="card bg-base-100 shadow-2xl border border-base-200">
          <div className="card-body p-6 md:p-8 gap-6">
            <div className="flex items-start gap-3">
              <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-primary/10 text-primary shrink-0">
                <CreditCard size={22} />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-primary/80 mb-0.5">
                  Planes
                </p>
                <h1 className="text-2xl font-bold tracking-tight">Elegí tu plan</h1>
                <p className="text-sm text-base-content/55 mt-1">
                  Empezá gratis y pasá a un plan pago cuando lo necesites. Sin apuro.
                </p>
              </div>
            </div>

            <PlanSelector hideHeader />
          </div>
        </div>
      </div>
    </main>
  );
}

export default function PlanesPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center">
          <span className="loading loading-spinner loading-lg text-primary" />
        </main>
      }
    >
      <PlanesContent />
    </Suspense>
  );
}
