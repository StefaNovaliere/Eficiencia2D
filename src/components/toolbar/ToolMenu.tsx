"use client";

import { useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useUIStore } from "@/stores/uiStore";

export interface ToolMenuItem {
  id: string;
  label: string;
  icon?: LucideIcon;
  /** Resaltado (herramienta/modo activo). */
  active?: boolean;
  /** Atajo mostrado a la derecha. */
  hotkey?: string;
  onSelect: () => void;
  /** Separador visual encima del ítem. */
  dividerAbove?: boolean;
}

interface ToolMenuProps {
  id: "views" | "tools";
  label: string;
  icon: LucideIcon;
  items: ToolMenuItem[];
  /** Marca el trigger como activo (p.ej. hay una herramienta encendida). */
  triggerActive?: boolean;
  /** Nodo extra al pie del popover (p.ej. selector de navegación de cámara). */
  footer?: React.ReactNode;
}

/**
 * Popover categorizado de la toolbar del visor. Estado global en `uiStore`
 * (`openMenu`): un solo menú abierto a la vez; cierra con click-afuera o Esc.
 * Montaje/desmontaje limpio sobre el canvas: cerrado no captura ningún evento.
 */
export default function ToolMenu({
  id,
  label,
  icon: Icon,
  items,
  triggerActive,
  footer,
}: ToolMenuProps) {
  const open = useUIStore((s) => s.openMenu === id);
  const toggleMenu = useUIStore((s) => s.toggleMenu);
  const closeMenu = useUIStore((s) => s.closeMenu);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) closeMenu();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, closeMenu]);

  return (
    <div ref={rootRef} className="relative" data-viewer-chrome>
      <button
        type="button"
        onClick={() => toggleMenu(id)}
        className={`inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-xs font-medium transition-colors ${
          open || triggerActive
            ? "bg-primary/15 text-primary"
            : "text-base-content/70 hover:bg-base-200"
        }`}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <Icon size={15} />
        <span className="hidden md:inline">{label}</span>
        <ChevronDown size={12} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full mt-1.5 z-40 min-w-52 rounded-xl border border-base-300/60 bg-base-100/95 backdrop-blur-md shadow-xl py-1.5"
        >
          {items.map((item) => (
            <div key={item.id}>
              {item.dividerAbove && <div className="my-1 border-t border-base-300/40" />}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  item.onSelect();
                  closeMenu();
                }}
                className={`w-full flex items-center justify-between gap-3 px-3 py-1.5 text-left text-xs ${
                  item.active ? "bg-primary/10 text-primary" : "hover:bg-base-200/70"
                }`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  {item.icon && <item.icon size={14} className="shrink-0" />}
                  <span className="truncate">{item.label}</span>
                </span>
                {item.hotkey && <kbd className="kbd kbd-xs shrink-0">{item.hotkey}</kbd>}
              </button>
            </div>
          ))}
          {footer && <div className="px-3 pt-1.5 mt-1 border-t border-base-300/40">{footer}</div>}
        </div>
      )}
    </div>
  );
}
