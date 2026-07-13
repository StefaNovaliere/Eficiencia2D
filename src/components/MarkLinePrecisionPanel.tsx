"use client";

import { useEffect, useState } from "react";
import {
  formatMarkDegreesInput,
  formatMarkMetersInput,
  parseMarkDegreesInput,
  parseMarkMetersInput,
  type MarkHorizontalEdge,
  type MarkLinePrecisionSpec,
  type MarkVerticalEdge,
} from "@/core/mark-lines";

interface MarkLinePrecisionPanelProps {
  spec: MarkLinePrecisionSpec;
  disabled?: boolean;
  liveFromDrag?: boolean;
  canAccept?: boolean;
  onChange: (next: MarkLinePrecisionSpec) => void;
  onAccept: (spec: MarkLinePrecisionSpec) => void;
  onNewLine?: () => void;
}

export default function MarkLinePrecisionPanel({
  spec,
  disabled = false,
  liveFromDrag = false,
  canAccept = true,
  onChange,
  onAccept,
  onNewLine,
}: MarkLinePrecisionPanelProps) {
  const [local, setLocal] = useState(spec);
  const [lengthText, setLengthText] = useState(() => formatMarkMetersInput(spec.lengthM));
  const [angleText, setAngleText] = useState(() => formatMarkDegreesInput(spec.angleDeg));
  const [offsetHText, setOffsetHText] = useState(() =>
    formatMarkMetersInput(spec.offsetHorizontalM),
  );
  const [offsetVText, setOffsetVText] = useState(() =>
    formatMarkMetersInput(spec.offsetVerticalM),
  );

  useEffect(() => {
    setLocal(spec);
    setLengthText(formatMarkMetersInput(spec.lengthM));
    setAngleText(formatMarkDegreesInput(spec.angleDeg));
    setOffsetHText(formatMarkMetersInput(spec.offsetHorizontalM));
    setOffsetVText(formatMarkMetersInput(spec.offsetVerticalM));
  }, [spec]);

  const commit = (next: MarkLinePrecisionSpec) => {
    setLocal(next);
    onChange(next);
  };

  const fieldsDisabled = disabled || liveFromDrag;

  const flushAndAccept = () => {
    const lengthM = parseMarkMetersInput(lengthText) ?? local.lengthM;
    const angleDeg = parseMarkDegreesInput(angleText) ?? local.angleDeg;
    const offsetHorizontalM = parseMarkMetersInput(offsetHText) ?? local.offsetHorizontalM;
    const offsetVerticalM = parseMarkMetersInput(offsetVText) ?? local.offsetVerticalM;
    const next: MarkLinePrecisionSpec = {
      ...local,
      lengthM,
      angleDeg,
      offsetHorizontalM,
      offsetVerticalM,
    };
    setLocal(next);
    onAccept(next);
  };

  return (
    <div
      data-viewer-chrome
      className="absolute bottom-3 right-3 z-30 w-[min(100%-1.5rem,19rem)] rounded-xl border border-error/30 bg-base-100/95 shadow-xl backdrop-blur-sm p-3 space-y-2 pointer-events-auto"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-error/80">
          Línea roja precisa
        </p>
        {liveFromDrag && (
          <span className="badge badge-error badge-outline badge-xs shrink-0">En vivo</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="form-control w-full min-w-0">
          <span className="label py-0.5">
            <span className="label-text text-[10px] uppercase tracking-wide text-base-content/55">
              Largo
            </span>
          </span>
          <div className="relative">
            <input
              type="text"
              inputMode="decimal"
              disabled={fieldsDisabled}
              className="input input-bordered input-xs w-full font-mono pr-7"
              value={lengthText}
              onChange={(e) => {
                setLengthText(e.target.value);
                const parsed = parseMarkMetersInput(e.target.value);
                if (parsed != null) commit({ ...local, lengthM: parsed });
              }}
            />
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-base-content/40">
              m
            </span>
          </div>
        </label>

        <label className="form-control w-full min-w-0">
          <span className="label py-0.5">
            <span className="label-text text-[10px] uppercase tracking-wide text-base-content/55">
              Ángulo
            </span>
          </span>
          <div className="relative">
            <input
              type="text"
              inputMode="decimal"
              disabled={fieldsDisabled}
              className="input input-bordered input-xs w-full font-mono pr-7"
              value={angleText}
              onChange={(e) => {
                setAngleText(e.target.value);
                const parsed = parseMarkDegreesInput(e.target.value);
                if (parsed != null) commit({ ...local, angleDeg: parsed });
              }}
            />
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-base-content/40">
              °
            </span>
          </div>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="form-control w-full min-w-0">
          <span className="label py-0.5">
            <span className="label-text text-[10px] uppercase tracking-wide text-base-content/55">
              Borde horiz.
            </span>
          </span>
          <select
            className="select select-bordered select-xs w-full"
            disabled={fieldsDisabled}
            value={local.horizontalEdge}
            onChange={(e) =>
              commit({ ...local, horizontalEdge: e.target.value as MarkHorizontalEdge })
            }
          >
            <option value="left">Izquierda</option>
            <option value="right">Derecha</option>
          </select>
        </label>
        <label className="form-control w-full min-w-0">
          <span className="label py-0.5">
            <span className="label-text text-[10px] uppercase tracking-wide text-base-content/55">
              {local.horizontalEdge === "left" ? "Desde izq." : "Desde der."}
            </span>
          </span>
          <div className="relative">
            <input
              type="text"
              inputMode="decimal"
              disabled={fieldsDisabled}
              className="input input-bordered input-xs w-full font-mono pr-7"
              value={offsetHText}
              onChange={(e) => {
                setOffsetHText(e.target.value);
                const parsed = parseMarkMetersInput(e.target.value);
                if (parsed != null) commit({ ...local, offsetHorizontalM: parsed });
              }}
            />
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-base-content/40">
              m
            </span>
          </div>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="form-control w-full min-w-0">
          <span className="label py-0.5">
            <span className="label-text text-[10px] uppercase tracking-wide text-base-content/55">
              Borde vert.
            </span>
          </span>
          <select
            className="select select-bordered select-xs w-full"
            disabled={fieldsDisabled}
            value={local.verticalEdge}
            onChange={(e) =>
              commit({ ...local, verticalEdge: e.target.value as MarkVerticalEdge })
            }
          >
            <option value="top">Techo / arriba</option>
            <option value="bottom">Piso / abajo</option>
          </select>
        </label>
        <label className="form-control w-full min-w-0">
          <span className="label py-0.5">
            <span className="label-text text-[10px] uppercase tracking-wide text-base-content/55">
              {local.verticalEdge === "top" ? "Desde arriba" : "Desde abajo"}
            </span>
          </span>
          <div className="relative">
            <input
              type="text"
              inputMode="decimal"
              disabled={fieldsDisabled}
              className="input input-bordered input-xs w-full font-mono pr-7"
              value={offsetVText}
              onChange={(e) => {
                setOffsetVText(e.target.value);
                const parsed = parseMarkMetersInput(e.target.value);
                if (parsed != null) commit({ ...local, offsetVerticalM: parsed });
              }}
            />
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-base-content/40">
              m
            </span>
          </div>
        </label>
      </div>

      <div className="flex gap-2">
        {onNewLine && (
          <button
            type="button"
            className="btn btn-ghost btn-xs flex-1 rounded-lg"
            disabled={disabled || liveFromDrag}
            onClick={onNewLine}
          >
            Nueva
          </button>
        )}
        <button
          type="button"
          className="btn btn-error btn-xs flex-1 rounded-lg"
          disabled={disabled || liveFromDrag || !canAccept}
          onMouseDown={(e) => {
            e.preventDefault();
            flushAndAccept();
          }}
        >
          Aceptar
        </button>
      </div>
      {!canAccept && (
        <p className="text-[10px] text-base-content/50">Seleccioná o clicá una pared</p>
      )}
    </div>
  );
}
