"use client";

import {
  formatCutMetersInput,
  parseCutMetersInput,
  type CutHorizontalEdge,
  type CutPrecisionSpec,
  type CutVerticalEdge,
} from "@/core/user-cuts";

interface CutPrecisionPanelProps {
  spec: CutPrecisionSpec;
  disabled?: boolean;
  liveFromDrag?: boolean;
  onChange: (next: CutPrecisionSpec) => void;
}

function MeterField({
  label,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  value: number;
  disabled?: boolean;
  onCommit: (n: number) => void;
}) {
  return (
    <label className="form-control w-full min-w-0">
      <span className="label py-0.5">
        <span className="label-text text-[10px] uppercase tracking-wide text-base-content/55">
          {label}
        </span>
      </span>
      <div className="relative">
        <input
          type="text"
          inputMode="decimal"
          disabled={disabled}
          className="input input-bordered input-xs w-full font-mono pr-7"
          defaultValue={formatCutMetersInput(value)}
          key={`${label}-${formatCutMetersInput(value)}`}
          onBlur={(e) => {
            const parsed = parseCutMetersInput(e.target.value);
            if (parsed == null) {
              e.target.value = formatCutMetersInput(value);
              return;
            }
            onCommit(parsed);
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }}
        />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-base-content/40">
          m
        </span>
      </div>
    </label>
  );
}

export default function CutPrecisionPanel({
  spec,
  disabled = false,
  liveFromDrag = false,
  onChange,
}: CutPrecisionPanelProps) {
  const patch = (partial: Partial<CutPrecisionSpec>) => {
    onChange({ ...spec, ...partial });
  };
  const fieldsDisabled = disabled || liveFromDrag;

  return (
    <div
      data-viewer-chrome
      className="absolute bottom-3 right-3 z-30 w-[min(100%-1.5rem,19rem)] rounded-xl border border-base-300/70 bg-base-100/95 shadow-xl backdrop-blur-sm p-3 space-y-2 pointer-events-auto"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-primary/80">
          Medidas precisas
        </p>
        {liveFromDrag && (
          <span className="badge badge-warning badge-outline badge-xs shrink-0">En vivo</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <MeterField
          label="Ancho"
          value={spec.widthM}
          disabled={fieldsDisabled}
          onCommit={(widthM) => patch({ widthM })}
        />
        <MeterField
          label="Alto"
          value={spec.heightM}
          disabled={fieldsDisabled}
          onCommit={(heightM) => patch({ heightM })}
        />
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
            value={spec.horizontalEdge}
            onChange={(e) =>
              patch({ horizontalEdge: e.target.value as CutHorizontalEdge })
            }
          >
            <option value="left">Izquierda</option>
            <option value="right">Derecha</option>
          </select>
        </label>
        <MeterField
          label={spec.horizontalEdge === "left" ? "Desde izq." : "Desde der."}
          value={spec.offsetHorizontalM}
          disabled={fieldsDisabled}
          onCommit={(offsetHorizontalM) => patch({ offsetHorizontalM })}
        />
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
            value={spec.verticalEdge}
            onChange={(e) =>
              patch({ verticalEdge: e.target.value as CutVerticalEdge })
            }
          >
            <option value="top">Techo / arriba</option>
            <option value="bottom">Piso / abajo</option>
          </select>
        </label>
        <MeterField
          label={spec.verticalEdge === "top" ? "Desde arriba" : "Desde abajo"}
          value={spec.offsetVerticalM}
          disabled={fieldsDisabled}
          onCommit={(offsetVerticalM) => patch({ offsetVerticalM })}
        />
      </div>
    </div>
  );
}
