"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Minus,
  RectangleHorizontal,
  Ruler,
  Trash2,
  X,
} from "lucide-react";
import type { GeometryGroup } from "@/core/group-classifier";
import {
  measurePinnedLabel,
  type MeasureLabelOptions,
  type MeasureShapeKind,
  type UserMeasure,
} from "@/core/measure-tool";
import { formatMeasureScaleOption } from "@/core/print-scale";
import MeasureScaleSelect from "@/components/MeasureScaleSelect";

const KIND_LABELS: Record<MeasureShapeKind, string> = {
  line: "Distancia",
  rect: "Área",
};

const KIND_ICONS: Record<MeasureShapeKind, typeof Minus> = {
  line: Minus,
  rect: RectangleHorizontal,
};

export interface MeasureListProps {
  measures: UserMeasure[];
  groups: GeometryGroup[];
  labelOptions: MeasureLabelOptions;
  measureScaleDenom: number;
  onMeasureScaleChange: (scaleDenom: number) => void;
  selectedMeasureId: string | null;
  onSelectMeasure: (id: string) => void;
  onRemoveMeasure: (id: string) => void;
  onClearMeasures: () => void;
}

export default function MeasureList({
  measures,
  groups,
  labelOptions,
  measureScaleDenom,
  onMeasureScaleChange,
  selectedMeasureId,
  onSelectMeasure,
  onRemoveMeasure,
  onClearMeasures,
}: MeasureListProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (measures.length === 0) return null;

  const groupById = new Map(groups.map((g) => [g.id, g]));
  const scaleHint = formatMeasureScaleOption(measureScaleDenom);

  return (
    <div
      className={`flex flex-col shrink-0 min-h-0 border-b border-base-300/30 bg-sky-500/[0.03] ${
        collapsed ? "" : "max-h-[min(42%,14rem)]"
      }`}
    >
      <div className="flex items-center gap-2 px-3 py-2 shrink-0">
        <button
          type="button"
          className="btn btn-ghost btn-xs btn-square h-7 min-h-7 rounded-lg shrink-0 text-base-content/60"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expandir medidas" : "Contraer medidas"}
          title={collapsed ? "Expandir" : "Contraer"}
        >
          {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
        </button>

        <Ruler size={14} className="text-sky-600 dark:text-sky-400 shrink-0" />

        <button
          type="button"
          className="flex-1 min-w-0 text-left"
          onClick={() => setCollapsed((c) => !c)}
        >
          <h3 className="font-semibold text-sm tracking-tight text-base-content leading-tight">
            Medidas
            <span className="ml-1.5 font-mono text-[11px] font-normal text-base-content/45">
              ({measures.length})
            </span>
          </h3>
          {collapsed && (
            <p className="text-[10px] text-base-content/45 truncate mt-0.5">{scaleHint}</p>
          )}
        </button>

        <MeasureScaleSelect
          value={measureScaleDenom}
          onChange={onMeasureScaleChange}
          onClick={(e) => e.stopPropagation()}
          selectClassName="select select-bordered select-xs h-7 min-h-7 w-[5.75rem] bg-base-100 font-mono text-[10px] shrink-0"
        />

        <button
          type="button"
          className="btn btn-ghost btn-xs btn-square h-7 min-h-7 rounded-lg text-base-content/50 hover:text-error shrink-0"
          onClick={onClearMeasures}
          title="Borrar todas las medidas"
          aria-label="Borrar todas las medidas"
        >
          <Trash2 size={13} />
        </button>
      </div>

      {!collapsed && (
        <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 space-y-1 custom-scrollbar">
          {measures.map((measure, index) => {
            const group = groupById.get(measure.groupId);
            const Icon = KIND_ICONS[measure.kind];
            const isSelected = selectedMeasureId === measure.id;
            const valueLabel = measurePinnedLabel(measure, labelOptions);

            return (
              <div
                key={measure.id}
                className={`group flex items-start gap-2 p-2 rounded-xl cursor-pointer transition-all border ${
                  isSelected
                    ? "bg-sky-500/15 border-sky-400/40 shadow-sm ring-1 ring-sky-400/25"
                    : "bg-base-100/80 border-base-300/30 hover:border-sky-400/30 hover:bg-sky-500/5"
                }`}
                onClick={() => onSelectMeasure(measure.id)}
                title="Clic para resaltar en el visor"
              >
                <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-300 shrink-0 mt-0.5">
                  <Icon size={14} />
                </div>

                <div className="flex-1 min-w-0">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-base-content/45">
                    #{index + 1} · {KIND_LABELS[measure.kind]}
                  </span>
                  <p className="text-sm font-mono font-semibold text-sky-700 dark:text-sky-300 mt-0.5 truncate">
                    {valueLabel}
                  </p>
                  <p className="text-[11px] text-base-content/45 mt-0.5 truncate">
                    {group?.label ?? `Componente ${measure.groupId}`}
                  </p>
                </div>

                <button
                  type="button"
                  className="btn btn-ghost btn-xs btn-square rounded-lg shrink-0 opacity-60 group-hover:opacity-100 hover:text-error"
                  title="Borrar esta medida"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveMeasure(measure.id);
                  }}
                  aria-label={`Borrar medida ${index + 1}`}
                >
                  <X size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
