"use client";

import { useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  Hand,
  Mouse,
  Move,
  Rotate3d,
  ZoomIn,
  type LucideIcon,
} from "lucide-react";
import { useCameraNavigation } from "@/context/CameraNavigationContext";
import {
  CAMERA_NAVIGATION_PRESETS,
  CAMERA_NAVIGATION_STYLES,
  type CameraNavigationStyle,
  type NavigationCommandIcon,
} from "@/core/camera-navigation";

const COMMAND_ICONS: Record<NavigationCommandIcon, LucideIcon> = {
  rotate: Rotate3d,
  pan: Move,
  zoom: ZoomIn,
  "mouse-middle": Mouse,
  "mouse-right": Mouse,
  "mouse-left": Mouse,
  shift: Move,
  pinch: Hand,
  touch: Hand,
};

function CommandList({
  style,
  compact = false,
}: {
  style: CameraNavigationStyle;
  compact?: boolean;
}) {
  const preset = CAMERA_NAVIGATION_PRESETS[style];
  return (
    <ul className={`space-y-1.5 ${compact ? "text-[10px]" : "text-xs"}`}>
      {preset.commands.map((cmd) => {
        const Icon = COMMAND_ICONS[cmd.icon];
        return (
          <li key={cmd.label} className="flex items-start gap-2 text-base-content/80">
            <Icon size={compact ? 12 : 14} className="shrink-0 mt-0.5 opacity-70" />
            <span>{cmd.label}</span>
          </li>
        );
      })}
    </ul>
  );
}

export interface CameraNavigationSelectProps {
  /** `settings` = panel de configuración; `toolbar` = barra del visor 3D; `toolbar-bottom` = barra inferior (abre hacia arriba). */
  variant?: "settings" | "toolbar" | "toolbar-bottom";
  className?: string;
}

export default function CameraNavigationSelect({
  variant = "settings",
  className = "",
}: CameraNavigationSelectProps) {
  const { navigationStyle, handleChange, isSaving } = useCameraNavigation();
  const [open, setOpen] = useState(false);

  const activePreset = CAMERA_NAVIGATION_PRESETS[navigationStyle];

  const tooltipText = useMemo(
    () => activePreset.commands.map((c) => c.label).join(" · "),
    [activePreset.commands],
  );

  const isToolbar = variant === "toolbar" || variant === "toolbar-bottom";
  const triggerClass =
    isToolbar
      ? "btn btn-sm btn-ghost gap-1.5 rounded-lg h-8 min-h-8 px-2.5 font-normal"
      : "btn btn-outline btn-sm rounded-xl border-base-300 gap-2 h-9 min-h-9 font-normal w-full sm:w-auto justify-between";

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className={`dropdown dropdown-top ${open ? "dropdown-open" : ""}`}>
        <button
          type="button"
          tabIndex={0}
          role="button"
          disabled={isSaving}
          className={triggerClass}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label="Estilo de navegación de cámara"
          onClick={() => setOpen((v) => !v)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              setOpen(false);
            }
          }}
        >
          <Rotate3d size={isToolbar ? 15 : 16} className="shrink-0 opacity-80" />
          <span className={isToolbar ? "hidden md:inline text-sm" : "text-sm"}>
            {activePreset.label}
          </span>
          <ChevronDown size={14} className="opacity-60 shrink-0" />
        </button>

        <ul
          tabIndex={0}
          role="listbox"
          aria-label="Estilos de navegación"
          className="dropdown-content menu z-[70] mt-1.5 w-72 rounded-2xl border border-base-300/60 bg-base-100/98 p-1.5 shadow-xl backdrop-blur-md"
        >
          {CAMERA_NAVIGATION_STYLES.map((style) => {
            const preset = CAMERA_NAVIGATION_PRESETS[style];
            const selected = style === navigationStyle;
            const optionTip = preset.commands.map((c) => c.label).join("\n");
            return (
              <li key={style} role="option" aria-selected={selected}>
                <button
                  type="button"
                  title={optionTip}
                  className={`flex flex-col items-start gap-0.5 rounded-xl px-3 py-2.5 text-left w-full ${
                    selected ? "bg-primary/10 text-primary" : "hover:bg-base-200/70"
                  }`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    void handleChange(style);
                    setOpen(false);
                  }}
                >
                  <span className="flex items-center gap-2 w-full">
                    <span className={`text-sm ${selected ? "font-semibold" : "font-medium"}`}>
                      {preset.label}
                    </span>
                    {selected && <Check size={14} className="ml-auto shrink-0" />}
                  </span>
                  <span className="text-[11px] text-base-content/50 leading-snug">
                    {preset.summary}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {variant === "settings" && (
        <div className="hidden lg:block flex-1 min-w-0 rounded-xl border border-base-300/40 bg-base-200/30 px-3 py-2.5">
          <p className="text-[11px] font-medium text-base-content/55 mb-1.5">
            Atajos — {activePreset.label}
          </p>
          <CommandList style={navigationStyle} />
        </div>
      )}
    </div>
  );
}
