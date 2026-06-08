"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface PaymentScreenProps {
  onPaymentApproved: (paymentId: string) => void;
  onPaymentError: (msg: string) => void;
  onCancel: () => void;
  onBypassSuccess: () => void;
}

type Stage = "loading" | "ready" | "waiting" | "verifying" | "error";

const WALLET_CONTAINER_ID = "mp-wallet-container";

export default function PaymentScreen({
  onPaymentApproved,
  onPaymentError,
  onCancel,
  onBypassSuccess,
}: PaymentScreenProps) {
  const [stage, setStage] = useState<Stage>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [showBypass, setShowBypass] = useState(false);
  const [bypassCode, setBypassCode] = useState("");
  const [bypassError, setBypassError] = useState("");
  const [bypassLoading, setBypassLoading] = useState(false);
  const brickRef = useRef<any>(null);

  // Listen for postMessage from payment-callback popup.
  useEffect(() => {
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
  }, [onPaymentApproved]);

  // Initialize Mercado Pago Wallet Brick.
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const res = await fetch("/api/mp/preference", { method: "POST" });
        if (!res.ok) throw new Error("Error al crear la preferencia de pago.");
        const { preferenceId } = await res.json();
        if (cancelled) return;

        const publicKey = process.env.NEXT_PUBLIC_MP_PUBLIC_KEY;
        if (!publicKey) throw new Error("Clave pública de Mercado Pago no configurada.");

        const { loadMercadoPago } = await import("@mercadopago/sdk-js");
        await loadMercadoPago();

        if (cancelled) return;

        // Wait one tick so the container div with WALLET_CONTAINER_ID is in
        // the DOM before the SDK tries to look it up.
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
      }
    }

    init();

    return () => {
      cancelled = true;
      if (brickRef.current?.unmount) brickRef.current.unmount();
    };
  }, []);

  const handleBypassSubmit = useCallback(async () => {
    if (!bypassCode.trim()) return;
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
        onBypassSuccess();
      } else {
        setBypassError("Código inválido.");
      }
    } catch {
      setBypassError("Error al verificar el código.");
    } finally {
      setBypassLoading(false);
    }
  }, [bypassCode, onBypassSuccess]);

  const handleRetry = useCallback(() => {
    setStage("loading");
    setErrorMsg("");
    window.location.reload();
  }, []);

  return (
    <div className="fixed inset-0 z-[100] bg-base-200/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="card bg-base-100 shadow-2xl border border-base-200 w-full max-w-md p-8">
        <h2 className="text-2xl font-bold text-center mb-2">Descargá tus planos</h2>
        <p className="text-base-content/70 text-center mb-6">
          Planos de corte láser en DXF + PDF, listos para enviar a la cortadora.
        </p>

        <div className="flex items-baseline justify-center gap-2 bg-base-200 py-4 rounded-xl mb-8">
          <span className="text-4xl font-extrabold">$30.000</span>
          <span className="text-lg font-medium text-base-content/50">ARS</span>
        </div>

        {stage === "loading" && (
          <div className="flex flex-col items-center gap-3 py-6 text-base-content/70">
            <span className="loading loading-spinner text-primary" />
            <p>Preparando pago...</p>
          </div>
        )}

        {stage === "verifying" && (
          <div className="flex flex-col items-center gap-3 py-6 text-base-content/70">
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

        <div
          id={WALLET_CONTAINER_ID}
          className="mb-4 min-h-[48px]"
          style={{ display: stage === "loading" || stage === "verifying" ? "none" : "block" }}
        />

        <div className="flex flex-wrap items-center justify-between gap-3 mt-2">
          <button className="btn btn-ghost" onClick={onCancel}>
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
                  if (e.key === "Enter") handleBypassSubmit();
                }}
                autoFocus
              />
              <button
                className="btn btn-primary btn-sm"
                onClick={handleBypassSubmit}
                disabled={bypassLoading || !bypassCode.trim()}
              >
                {bypassLoading ? "..." : "Aplicar"}
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
