"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, CreditCard, Loader2, Sparkles } from "lucide-react";
import { useSubscription } from "@/context/SubscriptionContext";
import { useAuth } from "@/context/AuthContext";
import type { Plan } from "@/services/planes";

function formatPrecio(plan: Plan): string {
  if (plan.precio_mensual <= 0) return "Gratis";
  const monto = plan.precio_mensual.toLocaleString("es-AR");
  const periodo = plan.periodo === "año" ? "año" : "mes";
  return `${plan.moneda} ${monto}/${periodo}`;
}

function formatFecha(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("es-AR", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export default function PlanSelector({ hideHeader = false }: { hideHeader?: boolean }) {
  const {
    planes,
    currentPlan,
    suscripcion,
    isLoading,
    error,
    unavailable,
    selectPlan,
    cancelar,
  } = useSubscription();
  const { isAuthenticated } = useAuth();
  const router = useRouter();

  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleSelect(plan: Plan) {
    if (!isAuthenticated) {
      router.push("/login");
      return;
    }
    if (plan.id === currentPlan?.id) return;
    setBusyId(plan.id);
    setNotice(null);
    setActionError(null);
    try {
      const result = await selectPlan(plan);
      if (result.kind === "checkout") {
        setNotice("Redirigiéndote al pago…");
      } else {
        setNotice(`Plan ${plan.nombre} activado.`);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "No se pudo elegir el plan");
    } finally {
      setBusyId(null);
    }
  }

  async function handleCancel() {
    setBusyId("__cancel__");
    setNotice(null);
    setActionError(null);
    try {
      await cancelar();
      setNotice("Tu plan fue cancelado.");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "No se pudo cancelar el plan");
    } finally {
      setBusyId(null);
    }
  }

  const hasPaidActive =
    currentPlan != null &&
    currentPlan.precio_mensual > 0 &&
    suscripcion?.estado === "activa";

  return (
    <section className={hideHeader ? "space-y-3" : "space-y-3 pt-2 border-t border-base-300/40"}>
      {!hideHeader && (
        <div className="flex items-start gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10 text-primary shrink-0">
            <CreditCard size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-base-content">Plan</h2>
            <p className="text-xs text-base-content/55 mt-1">
              {isAuthenticated && currentPlan
                ? `Plan actual: ${currentPlan.nombre}${
                    suscripcion?.cancela_al_fin && suscripcion?.periodo_fin
                      ? ` · finaliza el ${formatFecha(suscripcion.periodo_fin)}`
                      : suscripcion?.periodo_fin
                        ? ` · renueva el ${formatFecha(suscripcion.periodo_fin)}`
                        : ""
                  }`
                : "Elegí el plan que mejor se adapte a tu trabajo."}
            </p>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-base-content/50 py-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Cargando planes…
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {planes.map((plan) => {
              const active = plan.id === currentPlan?.id;
              const busy = busyId === plan.id;
              return (
                <div
                  key={plan.id}
                  className={`relative flex flex-col rounded-xl border p-3 transition-colors ${
                    active
                      ? "border-primary/40 bg-primary/5 ring-1 ring-primary/20"
                      : "border-base-300/60 bg-base-100 hover:bg-base-200/40"
                  }`}
                >
                  {plan.destacado && (
                    <span className="absolute -top-2 right-2 inline-flex items-center gap-1 rounded-full bg-primary text-primary-content text-[10px] font-semibold px-2 py-0.5">
                      <Sparkles size={10} />
                      Recomendado
                    </span>
                  )}
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="text-sm font-bold text-base-content">{plan.nombre}</h3>
                  </div>
                  <p className="text-base font-bold text-primary mt-0.5">
                    {formatPrecio(plan)}
                  </p>
                  <p className="text-xs text-base-content/55 mt-1">{plan.descripcion}</p>

                  <ul className="mt-2 space-y-1 flex-1">
                    {plan.features.map((f) => (
                      <li
                        key={f}
                        className="flex items-start gap-1.5 text-xs text-base-content/70"
                      >
                        <Check className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>

                  <button
                    type="button"
                    className={`btn btn-sm rounded-xl mt-3 ${
                      active ? "btn-ghost" : "btn-primary"
                    }`}
                    disabled={active || busy}
                    onClick={() => handleSelect(plan)}
                  >
                    {busy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : active ? (
                      "Plan actual"
                    ) : !isAuthenticated ? (
                      "Ingresá para elegir"
                    ) : plan.precio_mensual > 0 ? (
                      "Suscribirme"
                    ) : (
                      "Elegir"
                    )}
                  </button>
                </div>
              );
            })}
          </div>

          {hasPaidActive && !suscripcion?.cancela_al_fin && (
            <button
              type="button"
              className="btn btn-ghost btn-xs text-base-content/50"
              disabled={busyId === "__cancel__"}
              onClick={handleCancel}
            >
              {busyId === "__cancel__" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                "Cancelar plan"
              )}
            </button>
          )}
        </>
      )}

      {unavailable && (
        <div className="alert alert-warning rounded-xl text-sm">
          <span>
            Se guardó en este dispositivo; se sincronizará con tu cuenta cuando el servidor lo
            soporte.
          </span>
        </div>
      )}

      {actionError && (
        <div className="alert alert-error rounded-xl text-sm">
          <span>{actionError}</span>
        </div>
      )}
      {error && !actionError && (
        <div className="alert alert-warning rounded-xl text-sm">
          <span>{error}</span>
        </div>
      )}
      {notice && !actionError && (
        <div className="alert alert-success rounded-xl text-sm">
          <span>{notice}</span>
        </div>
      )}
    </section>
  );
}
