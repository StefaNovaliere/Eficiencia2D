"use client";

import { Waves } from "lucide-react";
import { useProjectContext } from "@/context/ProjectContext";
import {
  FLEX_METHODS,
  FLEX_METHOD_LABEL,
  FLEX_SPACING_MAX_M,
  FLEX_SPACING_MIN_M,
  defaultFlexSpec,
  findFlexForGroup,
  isAuxetic,
  removeFlexForGroup,
  upsertFlexSpec,
  type FlexMethod,
} from "@/core/flex-bending";

/**
 * Panel por-componente para superficies curvas: aplica Kerf bending o un patrón
 * auxético al grupo seleccionado y ajusta el espaciado. El preview en el visor es
 * ESQUEMÁTICO; la geometría real la genera el backend (CONTRATO_kerf_auxetico.md).
 */
export default function FlexControls({
  groupId,
  label,
}: {
  groupId: number;
  label: string;
}) {
  const { savedFlex, setSavedFlex } = useProjectContext();
  const spec = findFlexForGroup(savedFlex, groupId);
  const spacingMm = spec ? Math.round(spec.spacingM * 1000) : 0;
  const spacingLabel = spec && isAuxetic(spec.method) ? "ligamentos" : "columnas";

  function setMethod(value: string) {
    if (value === "none") {
      setSavedFlex(removeFlexForGroup(savedFlex, groupId));
      return;
    }
    const method = value as FlexMethod;
    // Conserva el espaciado si ya había un spec; si no, usa el default del método.
    const base = defaultFlexSpec(groupId, method);
    setSavedFlex(
      upsertFlexSpec(savedFlex, {
        ...base,
        spacingM: spec?.spacingM ?? base.spacingM,
      }),
    );
  }

  function setSpacingMm(mm: number) {
    if (!spec) return;
    setSavedFlex(upsertFlexSpec(savedFlex, { ...spec, spacingM: mm / 1000 }));
  }

  return (
    <div className="px-4 py-3 border-b border-base-300/30 space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-base-content/45 flex items-center gap-1.5">
        <Waves size={12} className="text-info" />
        Curvar · {label}
      </p>

      <label className="form-control w-full">
        <span className="text-xs text-base-content/60 mb-1">Patrón de flexión</span>
        <select
          className="select select-bordered select-sm w-full"
          value={spec?.method ?? "none"}
          onChange={(e) => setMethod(e.target.value)}
        >
          <option value="none">Ninguno (plano)</option>
          {FLEX_METHODS.map((m) => (
            <option key={m} value={m}>
              {FLEX_METHOD_LABEL[m]}
            </option>
          ))}
        </select>
      </label>

      {spec && (
        <label className="form-control w-full">
          <span className="text-xs text-base-content/60 mb-1 flex items-center justify-between">
            <span>Distancia entre {spacingLabel}</span>
            <span className="font-mono text-base-content/80">{spacingMm} mm</span>
          </span>
          <input
            type="range"
            className="range range-primary range-xs"
            min={Math.round(FLEX_SPACING_MIN_M * 1000)}
            max={Math.round(FLEX_SPACING_MAX_M * 1000)}
            step={1}
            value={spacingMm}
            onChange={(e) => setSpacingMm(Number(e.target.value))}
          />
        </label>
      )}

      <p className="text-[10px] text-base-content/40 leading-snug">
        Preview esquemático. El corte real (ranuras/celdas) y el desarrollo de la
        superficie los genera el servidor al generar los planos.
      </p>
    </div>
  );
}
