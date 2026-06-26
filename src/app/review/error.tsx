"use client";

import { useEffect } from "react";

/**
 * Error boundary de ruta (Next.js) para /review: red de seguridad para que una
 * excepción de cliente muestre un mensaje y un botón de reintento, en vez del
 * "Application error" en pantalla en blanco.
 */
export default function ReviewError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Error en /review:", error);
  }, [error]);

  return (
    <div className="fixed inset-0 z-[300] flex flex-col items-center justify-center gap-4 bg-base-100 text-center px-6">
      <h2 className="text-lg font-bold text-error">Algo salió mal en la revisión</h2>
      <p className="text-sm text-base-content/60 max-w-md">
        Ocurrió un error inesperado. Podés reintentar; si persiste, volvé a subir el modelo.
      </p>
      <button type="button" className="btn btn-primary btn-sm" onClick={reset}>
        Reintentar
      </button>
    </div>
  );
}
