"use client";

import { useState } from "react";
import { RotateCcw, Smartphone } from "lucide-react";

/**
 * Aviso de "girá el celular" para la revisión.
 *
 * El visor 3D es un lienzo que necesita ancho: en vertical el modelo queda en
 * una franja donde no se puede ni seleccionar una pared. En vez de degradar la
 * herramienta, proponemos la orientación en la que sí se usa.
 *
 * NO es un bloqueo: quien insista puede seguir en vertical. Es una sugerencia
 * con una salida clara, no una pared.
 */
export default function RotateDevicePrompt({ onDismiss }: { onDismiss?: () => void }) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div
      className="absolute inset-0 z-[70] flex flex-col items-center justify-center gap-6 px-8 text-center bg-base-100/95 backdrop-blur-md"
      role="dialog"
      aria-label="Girá el celular para usar el visor 3D"
    >
      <div className="relative flex items-center justify-center">
        <Smartphone
          size={72}
          strokeWidth={1.25}
          className="text-primary e2d-rotate-hint"
          aria-hidden
        />
        <RotateCcw
          size={22}
          strokeWidth={2}
          className="absolute -right-6 -top-2 text-secondary"
          aria-hidden
        />
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-bold tracking-tight">Girá el celular</h2>
        <p className="text-sm text-base-content/60 leading-relaxed max-w-xs">
          El visor 3D necesita pantalla ancha para que puedas seleccionar y editar
          los componentes. Poné el teléfono en horizontal.
        </p>
      </div>

      <button
        type="button"
        className="btn btn-ghost btn-sm rounded-xl border border-base-300/50 text-base-content/60"
        onClick={() => {
          setDismissed(true);
          onDismiss?.();
        }}
      >
        Seguir en vertical igual
      </button>
    </div>
  );
}
