"use client";

import {
  MEASURE_SCALE_ORIGINAL,
  PRINT_SCALE_OPTIONS,
  formatMeasureScaleOption,
} from "@/core/print-scale";

export interface MeasureScaleSelectProps {
  value: number;
  onChange: (scaleDenom: number) => void;
  className?: string;
  selectClassName?: string;
  "aria-label"?: string;
  onClick?: (e: React.MouseEvent<HTMLSelectElement>) => void;
}

export default function MeasureScaleSelect({
  value,
  onChange,
  className = "",
  selectClassName = "select select-bordered select-xs h-8 min-h-8 bg-base-100 font-mono text-[11px]",
  "aria-label": ariaLabel = "Escala de medición",
  onClick,
}: MeasureScaleSelectProps) {
  return (
    <div className={className}>
      <select
        className={selectClassName}
        value={value}
        onClick={onClick}
        onChange={(e) => {
          e.stopPropagation();
          onChange(Number(e.target.value));
        }}
        aria-label={ariaLabel}
        title="Escala de medición"
      >
        <option value={MEASURE_SCALE_ORIGINAL}>
          {formatMeasureScaleOption(MEASURE_SCALE_ORIGINAL)}
        </option>
        {PRINT_SCALE_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {formatMeasureScaleOption(s)}
          </option>
        ))}
      </select>
    </div>
  );
}
