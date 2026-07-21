"use client";

import { useEffect } from "react";
import { clearPlanCheckout } from "@/services/planCheckout";

export default function PaymentCallback() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const isSubscription = params.get("sub") === "1";
    const status = params.get("collection_status") ?? params.get("status") ?? "";
    const data = {
      type: "mp_payment_result" as const,
      status,
      paymentId: params.get("collection_id") ?? params.get("payment_id") ?? "",
      externalReference: params.get("external_reference") ?? "",
    };

    if (window.opener) {
      window.opener.postMessage(data, window.location.origin);
      window.close();
      return;
    }

    // Suscripción (preapproval): vuelta a la app a pantalla completa.
    if (isSubscription) {
      clearPlanCheckout();
      const paid = status === "approved" || status === "authorized" || !status;
      window.location.replace(paid ? "/planes?paid=1" : "/planes?paid=0");
      return;
    }

    // Pago único sin popup: volver al flujo de planos.
    window.location.replace("/payment");
  }, []);

  return (
    <div style={{ padding: 40, textAlign: "center", fontFamily: "system-ui, sans-serif" }}>
      <p>Procesando pago... Esta ventana se cerrará automáticamente.</p>
      <p style={{ marginTop: 16, fontSize: "0.85rem", color: "#71717a" }}>
        Si no se cierra, podés cerrarla manualmente y volver a la app.
      </p>
    </div>
  );
}
