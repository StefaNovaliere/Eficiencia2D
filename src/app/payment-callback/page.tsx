"use client";

import { useEffect } from "react";

export default function PaymentCallback() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const data = {
      type: "mp_payment_result" as const,
      status: params.get("collection_status") ?? params.get("status") ?? "",
      paymentId: params.get("collection_id") ?? params.get("payment_id") ?? "",
      externalReference: params.get("external_reference") ?? "",
    };

    if (window.opener) {
      window.opener.postMessage(data, window.location.origin);
      window.close();
    }
  }, []);

  return (
    <div style={{ padding: 40, textAlign: "center", fontFamily: "Inter, sans-serif" }}>
      <p>Procesando pago... Esta ventana se cerrará automáticamente.</p>
      <p style={{ marginTop: 16, fontSize: "0.85rem", color: "#71717a" }}>
        Si no se cierra, podés cerrarla manualmente y volver a la app.
      </p>
    </div>
  );
}
