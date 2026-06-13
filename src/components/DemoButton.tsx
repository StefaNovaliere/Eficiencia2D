"use client";

import { Camera, Play } from "lucide-react";

export interface DemoButtonProps {
  onClick: () => void;
  /** Si true, flota fijo arriba a la derecha (evitar si hay AuthNav). */
  floating?: boolean;
}

/**
 * Call-to-action "Ver demo". Por defecto va inline (p. ej. arriba del formulario)
 * para no superponerse con Ingresar / Registrarse.
 */
export default function DemoButton({ onClick, floating = false }: DemoButtonProps) {
  const wrapperClass = floating
    ? "fixed top-4 right-4 md:top-6 md:right-6 z-50 flex items-center justify-end gap-3"
    : "flex items-center justify-end gap-3 w-full mb-4";

  return (
    <div className={wrapperClass}>
      <div className="hidden sm:flex items-center gap-1.5 text-primary animate-[pulse_2.4s_ease-in-out_infinite]">
        <span className="text-sm font-medium italic whitespace-nowrap">
          ¿Querés ver cómo funciona?
        </span>
        <svg
          className="flex-shrink-0"
          width="44"
          height="32"
          viewBox="0 0 44 32"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2 22 C 14 22, 24 16, 36 6" />
          <polyline points="30 4 36 6 36 12" />
        </svg>
      </div>
      <button
        className="btn btn-primary rounded-full shadow-lg shadow-primary/20 transition-transform hover:-translate-y-0.5"
        onClick={onClick}
        type="button"
      >
        <Play className="w-4 h-4 mr-2" />
        Ver demo
      </button>
    </div>
  );
}
