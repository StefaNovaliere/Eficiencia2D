"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, CreditCard, Loader2, Sparkles, Ticket, X } from "lucide-react";
import { useSubscription } from "@/context/SubscriptionContext";
import { useAuth } from "@/context/AuthContext";
import type { Plan } from "@/services/planes";
import { findPlanByNumericId } from "@/services/planes";
import { savePlanCheckout } from "@/services/planCheckout";
import {
  resolverPrecioFinalDescuento,
  validarCuponPorCodigo,
  type ValidarCuponResult,
} from "@/services/cupones";

function formatPrecio(plan: Plan): string {
  if (plan.precio_mensual <= 0) return "Gratis";
  const monto = plan.precio_mensual.toLocaleString("es-AR");
  const periodo = plan.periodo === "año" ? "año" : "mes";
  return `${plan.moneda} ${monto}/${periodo}`;
}

function formatMonto(moneda: string, monto: number, periodo: string): string {
  return `${moneda} ${monto.toLocaleString("es-AR")}/${periodo}`;
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
  const { isAuthenticated, token } = useAuth();
  const router = useRouter();

  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cuponInput, setCuponInput] = useState("");
  const [appliedCupon, setAppliedCupon] = useState<ValidarCuponResult | null>(null);
  /** Precio con descuento por plan (solo tipo descuento). */
  const [descuentoPorPlan, setDescuentoPorPlan] = useState<
    Record<number, ValidarCuponResult>
  >({});
  const [isValidatingCupon, setIsValidatingCupon] = useState(false);
  const [cuponError, setCuponError] = useState<string | null>(null);

  function clearCupon() {
    setAppliedCupon(null);
    setDescuentoPorPlan({});
    setCuponInput("");
    setCuponError(null);
  }

  async function fetchDescuentosPorPlan(
    codigo: string,
    paidPlans: Plan[],
  ): Promise<Record<number, ValidarCuponResult>> {
    const entries = await Promise.all(
      paidPlans.map(async (plan) => {
        try {
          const result = await validarCuponPorCodigo(codigo, {
            planId: plan.plan_id,
            token,
          });
          return [plan.plan_id, result] as const;
        } catch {
          return null;
        }
      }),
    );
    return Object.fromEntries(
      entries.filter((e): e is [number, ValidarCuponResult] => e != null),
    );
  }

  async function handleApplyCupon() {
    const codigo = cuponInput.trim();
    if (!codigo) {
      setCuponError("Ingresá un código de cupón.");
      return;
    }

    setIsValidatingCupon(true);
    setCuponError(null);
    setNotice(null);
    setActionError(null);

    try {
      const result = await validarCuponPorCodigo(codigo, { token });
      setAppliedCupon(result);
      setCuponInput(result.cupon.codigo);

      if (result.tipo === "descuento") {
        const paidPlans = planes.filter((p) => p.precio_mensual > 0);
        setDescuentoPorPlan(await fetchDescuentosPorPlan(result.cupon.codigo, paidPlans));
      } else {
        setDescuentoPorPlan({});
      }
    } catch (err) {
      clearCupon();
      setCuponError(err instanceof Error ? err.message : "No se pudo validar el cupón");
    } finally {
      setIsValidatingCupon(false);
    }
  }

  async function handleSelect(plan: Plan) {
    if (!isAuthenticated) {
      router.push("/login");
      return;
    }
    if (plan.id === currentPlan?.id) return;

    if (appliedCupon?.tipo === "plan" && appliedCupon.cupon.plan_id !== plan.plan_id) {
      setActionError(
        `Este cupón incluye acceso al plan ${appliedCupon.cupon.plan?.nombre ?? appliedCupon.cupon.plan_id}. Elegí ese plan o quitá el cupón.`,
      );
      return;
    }

    const precioConDescuento = getPrecioFinalDescuento(plan);
    const amount =
      precioConDescuento != null ? precioConDescuento : plan.precio_mensual;
    const esCuponPlan =
      appliedCupon?.tipo === "plan" && appliedCupon.cupon.plan_id === plan.plan_id;
    const requierePago = amount > 0 && !esCuponPlan;

    // Plan pago: ir a cobrar con Wallet Brick (Next/MP). No llamar al preapproval
    // del backend acá — en el VPS suele colgarse y el front muestra "no se pudo conectar".
    if (requierePago) {
      const periodo = plan.periodo === "año" ? "año" : "mes";
      savePlanCheckout({
        planId: plan.id,
        planNumericId: plan.plan_id,
        planNombre: plan.nombre,
        amount,
        moneda: plan.moneda || "ARS",
        periodo,
        cuponCodigo: appliedCupon?.cupon.codigo,
      });
      clearCupon();
      router.push("/payment?from=plan");
      return;
    }

    setBusyId(plan.id);
    setNotice(null);
    setActionError(null);
    try {
      await selectPlan(plan, {
        cuponCodigo: appliedCupon?.cupon.codigo,
      });
      setNotice(`Plan ${plan.nombre} activado.`);
      clearCupon();
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

  function getPrecioFinalDescuento(plan: Plan): number | null {
    if (!appliedCupon || appliedCupon.tipo !== "descuento" || plan.precio_mensual <= 0) {
      return null;
    }
    return resolverPrecioFinalDescuento(
      plan.precio_mensual,
      appliedCupon.cupon,
      descuentoPorPlan[plan.plan_id],
    );
  }

  function renderPlanPrice(plan: Plan) {
    if (appliedCupon?.tipo === "plan" && appliedCupon.cupon.plan_id === plan.plan_id) {
      return (
        <div className="space-y-0.5">
          {plan.precio_mensual > 0 && (
            <p className="text-xs text-base-content/45 line-through">{formatPrecio(plan)}</p>
          )}
          <p className="text-base font-bold text-success">Gratis con cupón</p>
        </div>
      );
    }

    const precioFinal = getPrecioFinalDescuento(plan);
    if (precioFinal != null) {
      const periodo = plan.periodo === "año" ? "año" : "mes";

      if (precioFinal <= 0) {
        return (
          <div className="space-y-0.5">
            <p className="text-xs text-base-content/45 line-through">{formatPrecio(plan)}</p>
            <p className="text-xs font-medium text-success">Con cupón</p>
            <p className="text-base font-bold text-success">Gratis</p>
          </div>
        );
      }

      return (
        <div className="space-y-0.5">
          <p className="text-xs text-base-content/45 line-through">{formatPrecio(plan)}</p>
          <p className="text-xs font-medium text-success">Con cupón</p>
          <p className="text-base font-bold text-success">
            {formatMonto(plan.moneda, precioFinal, periodo)}
          </p>
        </div>
      );
    }

    return <p className="text-base font-bold text-primary">{formatPrecio(plan)}</p>;
  }

  const hasPaidActive =
    currentPlan != null &&
    currentPlan.precio_mensual > 0 &&
    suscripcion?.estado === "activa";

  const cuponPlanTarget =
    appliedCupon?.tipo === "plan" && appliedCupon.cupon.plan_id != null
      ? findPlanByNumericId(planes, appliedCupon.cupon.plan_id)
      : null;

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
          <div className="rounded-xl border border-base-300/60 bg-base-100/50 p-3 space-y-2">
            <div className="flex items-start gap-3">
              <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 text-primary shrink-0">
                <Ticket size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-base-content">Cupón</p>
                <p className="text-xs text-base-content/55 mt-0.5">
                  Ingresá tu código
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                className="input input-bordered input-sm sm:flex-1 bg-base-100 uppercase"
                placeholder="Ej: VERANO2026"
                value={cuponInput}
                onChange={(e) => {
                  setCuponInput(e.target.value.toUpperCase());
                  setCuponError(null);
                }}
                disabled={isValidatingCupon || Boolean(appliedCupon)}
                aria-label="Código de cupón"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !appliedCupon && cuponInput.trim()) {
                    e.preventDefault();
                    void handleApplyCupon();
                  }
                }}
              />
              {appliedCupon ? (
                <button
                  type="button"
                  className="btn btn-outline btn-sm rounded-xl gap-1.5"
                  onClick={clearCupon}
                >
                  <X size={14} />
                  Quitar
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary btn-sm rounded-xl"
                  disabled={isValidatingCupon || !cuponInput.trim()}
                  onClick={() => void handleApplyCupon()}
                >
                  {isValidatingCupon ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Aplicar"
                  )}
                </button>
              )}
            </div>

            {appliedCupon && (
              <div className="rounded-lg bg-success/10 border border-success/20 px-3 py-2 space-y-1.5">
                <p className="text-xs font-medium text-success">{appliedCupon.message}</p>
                <p className="text-xs text-base-content/60">
                
                  {appliedCupon.tipo === "plan" && cuponPlanTarget
                    ? ` · Suscribite al plan ${cuponPlanTarget.nombre}`
                    : ""}
                </p>
                
              </div>
            )}

            {cuponError && <p className="text-xs text-error">{cuponError}</p>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {planes.map((plan) => {
              const active = plan.id === currentPlan?.id;
              const busy = busyId === plan.id;
              const isCuponTarget = cuponPlanTarget?.plan_id === plan.plan_id;
              const hasDescuento =
                appliedCupon?.tipo === "descuento" &&
                getPrecioFinalDescuento(plan) != null;

              return (
                <div
                  key={plan.id}
                  className={`relative flex flex-col rounded-xl border p-3 transition-colors ${
                    active
                      ? "border-primary/40 bg-primary/5 ring-1 ring-primary/20"
                      : isCuponTarget
                        ? "border-success/50 bg-success/5 ring-1 ring-success/30"
                        : hasDescuento
                          ? "border-primary/30 bg-primary/[0.03]"
                          : "border-base-300/60 bg-base-100"
                  }`}
                >
                  {plan.destacado && (
                    <span className="absolute -top-2 right-2 inline-flex items-center gap-1 rounded-full bg-primary text-primary-content text-[10px] font-semibold px-2 py-0.5">
                      <Sparkles size={10} />
                      Recomendado
                    </span>
                  )}
                  {isCuponTarget && !active && (
                    <span className="absolute -top-2 left-2 badge badge-success badge-sm">
                      Incluido en tu cupón
                    </span>
                  )}
                  
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="text-sm font-bold text-base-content">{plan.nombre}</h3>
                  </div>
                  <div className="mt-0.5">{renderPlanPrice(plan)}</div>
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
                      active ? "btn-ghost" : isCuponTarget ? "btn-success" : "btn-primary"
                    }`}
                    disabled={active || busy}
                    onClick={() => void handleSelect(plan)}
                  >
                    {busy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : active ? (
                      "Plan actual"
                    ) : !isAuthenticated ? (
                      "Ingresá para elegir"
                    ) : isCuponTarget ? (
                      "Activar con cupón"
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
