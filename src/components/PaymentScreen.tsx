"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import StepIndicator from "./StepIndicator";
import TermsAcceptance from "@/components/TermsAcceptance";

export interface PaymentScreenProps {
  onPaymentApproved: (paymentId: string) => void;
  onPaymentError: (msg: string) => void;
  onCancel: () => void;
  onBypassSuccess: () => void;
  /** Monto a cobrar (default: 30000 planos). */
  amount?: number;
  currency?: string;
  title?: string;
  description?: string;
  /** Si false, oculta el indicador de pasos del flujo de proyecto. */
  showStepIndicator?: boolean;
  /**
   * Checkout de suscripción (preapproval MP). Si está, no usa Wallet Brick:
   * muestra el monto y redirige a Mercado Pago.
   */
  checkoutUrl?: string;
  /** Título del ítem en la preference de MP (Wallet Brick). */
  preferenceTitle?: string;
  preferenceItemId?: string;
  /**
   * Se llama al aceptar términos (p. ej. persistir `acepto_terminos_at`).
   * Si falla, no se habilita el cobro.
   */
  onAcceptTerms?: () => Promise<void>;
}

type Stage = "loading" | "ready" | "waiting" | "verifying" | "error";

const WALLET_CONTAINER_ID = "mp-wallet-container";
const DEFAULT_AMOUNT = 30000;

function formatAmount(amount: number): string {
  return amount.toLocaleString("es-AR");
}

export default function PaymentScreen({
  onPaymentApproved,
  onPaymentError,
  onCancel,
  onBypassSuccess,
  amount = DEFAULT_AMOUNT,
  currency = "ARS",
  title = "Descargá tus planos",
  description = "Planos de corte láser en DXF + PDF, listos para enviar a la cortadora.",
  showStepIndicator = true,
  checkoutUrl,
  preferenceTitle = "Eficiencia2D - Planos de Corte Láser",
  preferenceItemId = "planos",
  onAcceptTerms,
}: PaymentScreenProps) {
  const isSubscriptionCheckout = Boolean(checkoutUrl);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [termsSaving, setTermsSaving] = useState(false);
  const [termsError, setTermsError] = useState("");
  const [stage, setStage] = useState<Stage>(
    isSubscriptionCheckout ? "ready" : "loading",
  );
  const [errorMsg, setErrorMsg] = useState("");
  const [showBypass, setShowBypass] = useState(false);
  const [bypassCode, setBypassCode] = useState("");
  const [bypassError, setBypassError] = useState("");
  const [bypassLoading, setBypassLoading] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const brickRef = useRef<any>(null);

  const handleTermsChange = useCallback(
    async (checked: boolean) => {
      setTermsError("");
      if (!checked) {
        setTermsAccepted(false);
        return;
      }
      if (!onAcceptTerms) {
        setTermsAccepted(true);
        return;
      }
      setTermsSaving(true);
      try {
        await onAcceptTerms();
        setTermsAccepted(true);
      } catch (err) {
        setTermsAccepted(false);
        setTermsError(
          err instanceof Error ? err.message : "No se pudo registrar la aceptación",
        );
      } finally {
        setTermsSaving(false);
      }
    },
    [onAcceptTerms],
  );

  // Listen for postMessage from payment-callback popup.
  useEffect(() => {
    if (isSubscriptionCheckout) return;

    const handler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== "mp_payment_result") return;

      const { status, paymentId } = event.data;
      if (status === "approved" && paymentId) {
        setStage("verifying");
        onPaymentApproved(paymentId);
      } else if (status === "pending") {
        setErrorMsg("Tu pago está pendiente de acreditación. Volvé a intentar cuando se acredite.");
        setStage("error");
      } else {
        setErrorMsg("El pago no fue aprobado. Intentá de nuevo.");
        setStage("error");
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [onPaymentApproved, isSubscriptionCheckout]);

  // Wallet Brick solo después de aceptar términos.
  useEffect(() => {
    if (isSubscriptionCheckout || !termsAccepted) return;

    let cancelled = false;

    async function init() {
      setStage("loading");
      setErrorMsg("");
      try {
        const res = await fetch("/api/mp/preference", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount,
            currency,
            title: preferenceTitle,
            itemId: preferenceItemId,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error ?? "Error al crear la preferencia de pago.");
        }
        const { preferenceId } = await res.json();
        if (cancelled) return;

        const publicKey = process.env.NEXT_PUBLIC_MP_PUBLIC_KEY;
        if (!publicKey) throw new Error("Clave pública de Mercado Pago no configurada.");

        const { loadMercadoPago } = await import("@mercadopago/sdk-js");
        await loadMercadoPago();

        if (cancelled) return;

        await new Promise((r) => setTimeout(r, 0));
        if (cancelled) return;

        const mp = new (window as any).MercadoPago(publicKey, { locale: "es-AR" });
        const bricks = mp.bricks();

        brickRef.current = await bricks.create("wallet", WALLET_CONTAINER_ID, {
          initialization: {
            preferenceId,
            redirectMode: "modal",
          },
          callbacks: {
            onReady: () => {
              if (!cancelled) setStage("ready");
            },
            onError: (error: any) => {
              if (!cancelled) {
                setErrorMsg(error?.message ?? "Error en Mercado Pago.");
                setStage("error");
              }
            },
          },
        });
      } catch (err: unknown) {
        if (cancelled) return;
        setErrorMsg(err instanceof Error ? err.message : "Error al inicializar el pago.");
        setStage("error");
        onPaymentError(err instanceof Error ? err.message : "Error al inicializar el pago.");
      }
    }

    init();

    return () => {
      cancelled = true;
      if (brickRef.current?.unmount) brickRef.current.unmount();
      brickRef.current = null;
    };
  }, [
    amount,
    currency,
    isSubscriptionCheckout,
    onPaymentError,
    preferenceTitle,
    preferenceItemId,
    termsAccepted,
  ]);

  const handleSubscriptionPay = useCallback(() => {
    if (!checkoutUrl || !termsAccepted) return;
    setRedirecting(true);
    window.location.href = checkoutUrl;
  }, [checkoutUrl, termsAccepted]);

  const handleBypassSubmit = useCallback(async () => {
    if (!bypassCode.trim() || !termsAccepted) {
      if (!termsAccepted) setBypassError("Primero aceptá los términos y condiciones.");
      return;
    }
    setBypassLoading(true);
    setBypassError("");

    try {
      const res = await fetch("/api/mp/bypass", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: bypassCode.trim() }),
      });
      const data = await res.json();
      if (data.valid) {
        localStorage.setItem("e2d_bypass", bypassCode.trim());
        setBypassCode("");
        onBypassSuccess();
      } else if (data.configured === false) {
        setBypassError("El bypass no está configurado en este entorno (falta MP_BYPASS_KEY).");
      } else {
        setBypassError("Código inválido.");
      }
    } catch {
      setBypassError("Error al verificar el código.");
    } finally {
      setBypassLoading(false);
    }
  }, [bypassCode, onBypassSuccess, termsAccepted]);

  const handleRetry = useCallback(() => {
    setStage("loading");
    setErrorMsg("");
    window.location.reload();
  }, []);

  return (
    <div className="fixed inset-0 z-[100] bg-base-200/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="card bg-base-100 shadow-2xl border border-base-200 w-full max-w-md p-8">
        {showStepIndicator && (
          <div className="mb-6">
            <StepIndicator current="payment" variant="compact" />
          </div>
        )}
        <h2 className="text-2xl font-bold text-center mb-2">{title}</h2>
        <p className="text-base-content/70 text-center mb-6">{description}</p>

        <div className="flex items-baseline justify-center gap-2 bg-base-200 py-4 rounded-xl mb-6">
          <span className="text-4xl font-extrabold">${formatAmount(amount)}</span>
          <span className="text-lg font-medium text-base-content/50">{currency}</span>
        </div>

        <div className="mb-6 space-y-2">
          <TermsAcceptance
            id="pago-acepto-terminos"
            checked={termsAccepted}
            onChange={(v) => void handleTermsChange(v)}
            disabled={termsSaving || redirecting || stage === "verifying"}
            label="Para continuar, acepto los"
          />
          {termsSaving && (
            <p className="text-xs text-base-content/50 flex items-center gap-1.5">
              <span className="loading loading-spinner loading-xs" />
              Guardando aceptación…
            </p>
          )}
          {termsError && <p className="text-xs text-error">{termsError}</p>}
          {!termsAccepted && !termsError && (
            <p className="text-xs text-base-content/50">
              Tenés que aceptar los términos para habilitar el pago.
            </p>
          )}
        </div>

        {termsAccepted && stage === "loading" && (
          <div className="flex flex-col items-center gap-3 py-2 text-base-content/70">
            <span className="loading loading-spinner text-primary" />
            <p>Preparando pago...</p>
          </div>
        )}

        {stage === "verifying" && (
          <div className="flex flex-col items-center gap-3 py-2 text-base-content/70">
            <span className="loading loading-spinner text-primary" />
            <p>Verificando pago...</p>
          </div>
        )}

        {stage === "error" && (
          <div className="alert alert-error mb-4 flex-col gap-2 rounded-xl">
            <p>{errorMsg}</p>
            <button className="btn btn-sm w-full" onClick={handleRetry}>
              Reintentar
            </button>
          </div>
        )}

        {isSubscriptionCheckout ? (
          <button
            type="button"
            className="btn btn-primary w-full mb-4 rounded-xl"
            disabled={!termsAccepted || redirecting || stage === "error" || termsSaving}
            onClick={handleSubscriptionPay}
          >
            {redirecting ? (
              <span className="loading loading-spinner loading-sm" />
            ) : (
              "Pagar con Mercado Pago"
            )}
          </button>
        ) : (
          <div
            id={WALLET_CONTAINER_ID}
            className="mb-4 min-h-[48px]"
            style={{
              display:
                !termsAccepted || stage === "loading" || stage === "verifying" ? "none" : "block",
            }}
          />
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 mt-2">
          <button className="btn btn-ghost" onClick={onCancel} disabled={redirecting}>
            Volver
          </button>

          {!showBypass ? (
            <button
              className="text-xs font-medium text-base-content/60 underline underline-offset-2 hover:text-base-content"
              onClick={() => setShowBypass(true)}
            >
              ¿Tenés un código?
            </button>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <input
                className="input input-bordered input-sm w-32"
                type="text"
                placeholder="Código"
                value={bypassCode}
                onChange={(e) => setBypassCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleBypassSubmit();
                }}
                autoFocus
              />
              <button
                className="btn btn-primary btn-sm"
                onClick={() => void handleBypassSubmit()}
                disabled={bypassLoading || !bypassCode.trim() || !termsAccepted}
              >
                {bypassLoading ? <span className="loading loading-spinner loading-xs" /> : "Aplicar"}
              </button>
              {bypassError && (
                <span className="text-error text-xs w-full mt-1">{bypassError}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
