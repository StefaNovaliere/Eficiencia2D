"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { useViewerPalette } from "@/context/ThemeContext";
import { usePersistedModelColors } from "@/hooks/usePersistedModelColors";
import {
  hexToHsv,
  hsvToHex,
  hsvToWheelXY,
  normalizeHex,
  wheelXYToHs,
} from "@/core/color";

type Channel = "wall" | "floor" | "background";

const CHANNELS: Channel[] = ["wall", "floor", "background"];
const LABEL: Record<Channel, string> = {
  wall: "Pared",
  floor: "Piso",
  background: "Fondo",
};
/** Etiqueta corta de 2 letras dentro de cada manija (legible a 8px). */
const GLYPH: Record<Channel, string> = {
  wall: "Pa",
  floor: "Pi",
  background: "Fo",
};

const WHEEL_PX = 168;
const HANDLE_PX = 20;
const GRAB_PX = 24;

const WHEEL_BG =
  "radial-gradient(circle closest-side, #ffffff, rgba(255,255,255,0)), " +
  "conic-gradient(from 0deg, hsl(0 100% 50%), hsl(60 100% 50%), hsl(120 100% 50%), " +
  "hsl(180 100% 50%), hsl(240 100% 50%), hsl(300 100% 50%), hsl(0 100% 50%))";

/**
 * Rueda HSV con DOS manijas (pared + piso) sobre el mismo disco. Se arrastra
 * cualquiera de las dos; el slider de brillo y el campo hex siguen a la manija
 * activa. Escribe los overrides en ThemeContext (accesibilidad daltónica).
 */
export default function ModelColorWheel() {
  const palette = useViewerPalette();
  const { modelColors, setModelColor, resetModelColors } = usePersistedModelColors();
  const [active, setActive] = useState<Channel>("wall");
  const wheelRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<Channel | null>(null);

  // Color efectivo por canal: override del usuario o el default del tema.
  const colors: Record<Channel, string> = {
    wall: modelColors.wall ?? palette.wall,
    floor: modelColors.floor ?? palette.floor,
    background: modelColors.background ?? palette.background,
  };

  const hsv: Record<Channel, ReturnType<typeof hexToHsv>> = useMemo(
    () => ({
      wall: hexToHsv(colors.wall),
      floor: hexToHsv(colors.floor),
      background: hexToHsv(colors.background),
    }),
    [colors.wall, colors.floor, colors.background],
  );

  const isCustom =
    modelColors.wall != null ||
    modelColors.floor != null ||
    modelColors.background != null;

  const handlePos = useCallback((ch: Channel) => {
    const { x, y } = hsvToWheelXY(hsv[ch].h, hsv[ch].s);
    const r = WHEEL_PX / 2;
    return { left: r + x * r, top: r + y * r };
  }, [hsv]);

  const applyFromPointer = useCallback(
    (ch: Channel, clientX: number, clientY: number) => {
      const el = wheelRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const r = rect.width / 2;
      const nx = (clientX - rect.left - r) / r;
      const ny = (clientY - rect.top - r) / r;
      const { h, s } = wheelXYToHs(nx, ny);
      setModelColor(ch, hsvToHex(h, s, hsv[ch].v));
    },
    [hsv, setModelColor],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = wheelRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;

      // ¿Se agarró una manija concreta? Si no, se mueve la activa.
      let target: Channel = active;
      let best = GRAB_PX;
      for (const ch of CHANNELS) {
        const pos = handlePos(ch);
        const d = Math.hypot(px - pos.left, py - pos.top);
        if (d <= best) {
          best = d;
          target = ch;
        }
      }

      draggingRef.current = target;
      setActive(target);
      el.setPointerCapture(e.pointerId);
      applyFromPointer(target, e.clientX, e.clientY);
    },
    [active, handlePos, applyFromPointer],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const ch = draggingRef.current;
      if (!ch) return;
      applyFromPointer(ch, e.clientX, e.clientY);
    },
    [applyFromPointer],
  );

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = null;
    wheelRef.current?.releasePointerCapture?.(e.pointerId);
  }, []);

  const setValue = useCallback(
    (v: number) => {
      const cur = hsv[active];
      setModelColor(active, hsvToHex(cur.h, cur.s, v));
    },
    [active, hsv, setModelColor],
  );

  const onHexInput = useCallback(
    (raw: string) => {
      const norm = normalizeHex(raw);
      if (norm) setModelColor(active, norm);
    },
    [active, setModelColor],
  );

  return (
    <div className="flex flex-col items-center gap-3 px-1 pt-0.5">
      {/* Rueda */}
      <div
        ref={wheelRef}
        role="application"
        aria-label="Rueda de color: arrastrá la manija de pared o de piso"
        className="relative touch-none cursor-crosshair rounded-full shadow-inner ring-1 ring-base-content/10"
        style={{ width: WHEEL_PX, height: WHEEL_PX, background: WHEEL_BG }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {CHANNELS.map((ch) => {
          const pos = handlePos(ch);
          const isActive = ch === active;
          return (
            <div
              key={ch}
              className={`absolute grid place-items-center rounded-full border-2 shadow-md transition-[width,height] ${
                isActive ? "border-white z-20" : "border-white/80 z-10"
              }`}
              style={{
                width: isActive ? HANDLE_PX + 4 : HANDLE_PX,
                height: isActive ? HANDLE_PX + 4 : HANDLE_PX,
                left: pos.left,
                top: pos.top,
                transform: "translate(-50%, -50%)",
                background: colors[ch],
                outline: isActive ? "2px solid rgba(0,0,0,0.15)" : "none",
              }}
            >
              <span className="text-[8px] font-bold text-white mix-blend-difference select-none">
                {GLYPH[ch]}
              </span>
            </div>
          );
        })}
      </div>

      {/* Selector de canal (leyenda + qué controla el brillo) */}
      <div className="flex w-full gap-1">
        {CHANNELS.map((ch) => {
          const isActive = ch === active;
          return (
            <button
              key={ch}
              type="button"
              onClick={() => setActive(ch)}
              className={`flex flex-1 items-center justify-center gap-1 rounded-xl border px-1.5 py-1.5 text-xs transition-colors ${
                isActive
                  ? "border-primary/40 bg-primary/10 text-base-content"
                  : "border-base-300/40 text-base-content/60 hover:bg-base-200/60"
              }`}
            >
              <span
                className="h-3 w-3 shrink-0 rounded-full ring-1 ring-base-content/15"
                style={{ background: colors[ch] }}
              />
              <span className="font-medium">{LABEL[ch]}</span>
            </button>
          );
        })}
      </div>

      {/* Brillo del canal activo */}
      <div className="flex w-full items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-base-content/40 shrink-0">
          Brillo
        </span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(hsv[active].v * 100)}
          onChange={(e) => setValue(Number(e.target.value) / 100)}
          className="range range-primary range-xs flex-1"
          aria-label={`Brillo de ${LABEL[active].toLowerCase()}`}
        />
      </div>

      {/* Hex del canal activo + reset */}
      <div className="flex w-full items-center gap-2">
        <label className="flex flex-1 items-center gap-1.5 rounded-lg border border-base-300/50 px-2 py-1">
          <span className="text-xs text-base-content/40">#</span>
          <input
            type="text"
            value={colors[active].replace(/^#/, "")}
            onChange={(e) => onHexInput(e.target.value)}
            spellCheck={false}
            maxLength={6}
            className="w-full bg-transparent font-mono text-xs uppercase outline-none"
            aria-label={`Código hex de ${LABEL[active].toLowerCase()}`}
          />
        </label>
        <button
          type="button"
          onClick={resetModelColors}
          disabled={!isCustom}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-base-content/60 transition-colors enabled:hover:bg-base-200/70 enabled:hover:text-base-content disabled:opacity-40"
          title="Volver a los colores del tema"
        >
          <RotateCcw size={12} />
          Restablecer
        </button>
      </div>
    </div>
  );
}
