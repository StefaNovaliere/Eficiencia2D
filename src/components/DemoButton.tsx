"use client";

import { Play } from "lucide-react";

export interface DemoButtonProps {
  onClick: () => void;
}

/**
 * Acción SECUNDARIA "Ver demo": un único CTA discreto (ghost) para no competir
 * con la acción primaria de subir un .obj. Sin animaciones que distraigan.
 */
export default function DemoButton({ onClick }: DemoButtonProps) {
  return (
    <div className="flex justify-center mt-4">
      <button
        type="button"
        onClick={onClick}
        className="btn btn-ghost btn-sm gap-2 text-base-content/60 hover:text-base-content font-medium"
      >
        <Play className="w-3.5 h-3.5" />
        ¿Primera vez? Probá con un modelo de ejemplo
      </button>
    </div>
  );
}
