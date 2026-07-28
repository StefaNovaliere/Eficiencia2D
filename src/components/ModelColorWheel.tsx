"use client";

import { useCallback, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { useViewerPalette } from "@/context/ThemeContext";
import { usePersistedModelColors } from "@/hooks/usePersistedModelColors";
import {
  type Hsv,
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

  const isCustom =
    modelColors.wall != null ||
    modelColors.floor != null ||
    modelColors.background != null;

  /**
   * HSV "en curso" del canal que se está editando. El color se guarda como hex
   * de 8 bits, y ese redondeo destruye matiz y saturación cuando el brillo es
   * bajo: con `v = 0` todo h/s colapsa a `#000000`, así que la manija quedaba
   * clavada en el centro. Guardando el HSV que originó el hex, la manija sigue
   * al puntero aunque el hex no pueda representar la diferencia.
   *
   * El borrador vale sólo mientras el color guardado siga siendo el que produjo:
   * cualquier edición externa (campo hex, restablecer, cambio de tema) lo
   * invalida sola.
   */
  const draftRef = useRef<{ ch: Channel; hex: string; hsv: Hsv } | null>(null);

  const hsvOf = useCallback(
    (ch: Channel): Hsv => {
      const draft = draftRef.current;
      if (draft && draft.ch === ch && draft.hex === colors[ch]) return draft.hsv;
      return hexToHsv(colors[ch]);
    },
    [colors.wall, colors.floor, colors.background],
  );

  /** Guarda el color y recuerda el HSV exacto que lo generó. */
  const commit = useCallback(
    (ch: Channel, next: Hsv) => {
      const hex = hsvToHex(next.h, next.s, next.v);
      draftRef.current = { ch, hex, hsv: next };
      setModelColor(ch, hex);
    },
    [setModelColor],
  );

  const handlePos = useCallback(
    (ch: Channel) => {
      const { h, s } = hsvOf(ch);
      const { x, y } = hsvToWheelXY(h, s);
      const r = WHEEL_PX / 2;
      return { left: r + x * r, top: r + y * r };
    },
    [hsvOf],
  );

  /** Puntero → coordenadas del disco nominal (por si el contenedor está escalado). */
  const wheelPoint = useCallback((clientX: number, clientY: number) => {
    const rect = wheelRef.current!.getBoundingClientRect();
    const scale = rect.width / WHEEL_PX || 1;
    return { px: (clientX - rect.left) / scale, py: (clientY - rect.top) / scale };
  }, []);

  const applyFromPointer = useCallback(
    (ch: Channel, clientX: number, clientY: number) => {
      if (!wheelRef.current) return;
      const r = WHEEL_PX / 2;
      const { px, py } = wheelPoint(clientX, clientY);
      const { h, s } = wheelXYToHs((px - r) / r, (py - r) / r);
      commit(ch, { h, s, v: hsvOf(ch).v });
    },
    [wheelPoint, commit, hsvOf],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = wheelRef.current;
      if (!el) return;
      const { px, py } = wheelPoint(e.clientX, e.clientY);

      // ¿Se agarró una manija concreta? Si no, se mueve la activa. Las manijas
      // se apilan cuando los colores son grises (saturación 0 = centro), así
      // que ante un empate tiene que ganar la activa: si no, tocar la de Pared
      // terminaba arrastrando la de Fondo.
      const byPriority: Channel[] = [active, ...CHANNELS.filter((c) => c !== active)];
      let target: Channel = active;
      let best = GRAB_PX;
      for (const ch of byPriority) {
        const pos = handlePos(ch);
        const d = Math.hypot(px - pos.left, py - pos.top);
        if (d < best) {
          best = d;
          target = ch;
        }
      }

      draggingRef.current = target;
      setActive(target);
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* sin captura el arrastre sigue funcionando dentro del disco */
      }
      applyFromPointer(target, e.clientX, e.clientY);
    },
    [active, wheelPoint, handlePos, applyFromPointer],
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
    const el = wheelRef.current;
    // `releasePointerCapture` tira NotFoundError si la captura ya se soltó sola.
    if (el?.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
  }, []);

  const setValue = useCallback(
    (v: number) => {
      // Conserva h/s: bajar el brillo a 0 no debe borrar el matiz elegido.
      commit(active, { ...hsvOf(active), v });
    },
    [active, hsvOf, commit],
  );

  const onHexInput = useCallback(
    (raw: string) => {
      const norm = normalizeHex(raw);
      if (!norm) return;
      draftRef.current = null;
      setModelColor(active, norm);
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
          value={Math.round(hsvOf(active).v * 100)}
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
