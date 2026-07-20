"use client";

import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

export interface InspectorSectionProps {
  icon: ReactNode;
  title: string;
  /** Contador/estado a la derecha (se oculta si es falsy o 0). */
  badge?: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}

/**
 * Fila de acordeón del inspector de Revisión: header de una línea (ícono +
 * título + badge + chevron) que revela su contenido al abrirse. El padre
 * controla `open` (una sección a la vez) — ver ReviewScreen.
 */
export default function InspectorSection({
  icon,
  title,
  badge,
  open,
  onToggle,
  children,
}: InspectorSectionProps) {
  const showBadge = badge != null && badge !== 0 && badge !== "0";
  return (
    <div className="border-b border-base-300/30">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors ${
          open ? "bg-base-200/40" : "hover:bg-base-200/40"
        }`}
      >
        <span
          className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg transition-colors ${
            open ? "bg-primary/15 text-primary" : "bg-base-200/70 text-base-content/55"
          }`}
        >
          {icon}
        </span>
        <span className="flex-1 text-sm font-medium text-base-content/80">{title}</span>
        {showBadge && (
          <span className="badge badge-xs badge-primary font-mono">{badge}</span>
        )}
        <ChevronDown
          size={14}
          className={`opacity-40 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && <div className="animate-[fadeIn_0.12s_ease]">{children}</div>}
    </div>
  );
}
