"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface PaymentScreenProps {
  onPaymentApproved: (paymentId: string) => void;
  onPaymentError: (msg: string) => void;
  onCancel: () => void;
  onBypassSuccess: () => void;
}

type Stage = "loading" | "ready" | "waiting" | "verifying" | "error";

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
  const walletRef = useRef<HTMLDivElement>(null);
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

        if (cancelled || !walletRef.current) return;

        const mp = new (window as any).MercadoPago(publicKey, { locale: "es-AR" });
        const bricks = mp.bricks();

        brickRef.current = await bricks.create("wallet", walletRef.current, {
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
    <div className="payment-overlay">
      <div className="payment-card">
        <h2 className="payment-title">Descargá tus planos</h2>
        <p className="payment-description">
          Planos de corte láser en DXF + PDF, listos para enviar a la cortadora.
        </p>

        <div className="payment-price-box">
          <span className="payment-price">$30.000</span>
          <span className="payment-currency">ARS</span>
        </div>

        {stage === "loading" && (
          <div className="payment-loading">
            <span className="spinner spinner--dark" />
            <p>Preparando pago...</p>
          </div>
        )}

        {stage === "verifying" && (
          <div className="payment-loading">
            <span className="spinner spinner--dark" />
            <p>Verificando pago...</p>
          </div>
        )}

        {stage === "error" && (
          <div className="payment-error">
            <p>{errorMsg}</p>
            <button className="payment-retry-btn" onClick={handleRetry}>
              Reintentar
            </button>
          </div>
        )}

        <div
          ref={walletRef}
          className="payment-wallet-container"
          style={{ display: stage === "loading" || stage === "verifying" ? "none" : "block" }}
        />

        <div className="payment-footer">
          <button className="payment-cancel-btn" onClick={onCancel}>
            Volver
          </button>

          {!showBypass ? (
            <button
              className="payment-bypass-toggle"
              onClick={() => setShowBypass(true)}
            >
              ¿Tenés un código?
            </button>
          ) : (
            <div className="payment-bypass-form">
              <input
                className="payment-bypass-input"
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
                className="payment-bypass-submit"
                onClick={handleBypassSubmit}
                disabled={bypassLoading || !bypassCode.trim()}
              >
                {bypassLoading ? "..." : "Aplicar"}
              </button>
              {bypassError && (
                <span className="payment-bypass-error">{bypassError}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
