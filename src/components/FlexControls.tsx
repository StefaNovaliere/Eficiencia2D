"use client";

import { AlertTriangle, Waves } from "lucide-react";
import { useProjectContext } from "@/context/ProjectContext";
import type { GroupCurvature } from "@/core/pipeline";
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

/** Método sugerido según la curvatura detectada por el backend. */
function suggestedMethod(curvature?: GroupCurvature): FlexMethod {
  return curvature?.kind === "double" ? "auxetic_rotating" : "kerf";
}

/**
 * Panel por-componente para superficies curvas: aplica Kerf bending o un patrón
 * auxético al grupo (pared) seleccionado y ajusta el espaciado (mm físicos sobre
 * la plancha). El preview en el visor es ESQUEMÁTICO; la geometría real la genera
 * el backend (CONTRATO_kerf_auxetico.md / CONTRATO_flex_FRONT.md).
 */
export default function FlexControls({
  groupId,
  label,
  coplanarWarning = false,
  curvature,
}: {
  groupId: number;
  label: string;
  coplanarWarning?: boolean;
  curvature?: GroupCurvature;
}) {
  const { savedFlex, setSavedFlex } = useProjectContext();
  const spec = findFlexForGroup(savedFlex, groupId);
  // spacing en mm FÍSICOS de maqueta (2–6 mm); paso 0.5 mm.
  const spacingMm = spec ? Math.round(spec.spacingM * 1000 * 2) / 2 : 0;
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
      upsertFlexSpec(savedFlex, { ...base, spacingM: spec?.spacingM ?? base.spacingM }),
    );
  }

  function applySuggested() {
    const method = suggestedMethod(curvature);
    setSavedFlex(upsertFlexSpec(savedFlex, defaultFlexSpec(groupId, method)));
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

      {curvature?.curved && (
        <div className="flex items-center gap-2 text-[11px] text-info bg-info/10 rounded-lg px-2 py-1">
          <span>
            Curvo · {curvature.kind === "double" ? "doble" : "simple"} curvatura
            {curvature.bendRadiusM ? ` · r≈${(curvature.bendRadiusM * 100).toFixed(0)} cm` : ""}
          </span>
          {!spec && (
            <button
              type="button"
              className="btn btn-xs btn-info btn-outline ml-auto"
              onClick={applySuggested}
            >
              Sugerido: {curvature.kind === "double" ? "auxético" : "kerf"}
            </button>
          )}
        </div>
      )}

      {coplanarWarning && (
        <div className="flex items-start gap-1.5 text-[11px] text-warning bg-warning/10 rounded-lg px-2 py-1.5">
          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
          <span>
            Fusión de paredes no coplanares: el patrón se genera sobre un panel
            "fantasma" que abarca un lado entero. Conviene aplicar flex por pared o
            fusionar sólo paredes coplanares.
          </span>
        </div>
      )}

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
            min={FLEX_SPACING_MIN_M * 1000}
            max={FLEX_SPACING_MAX_M * 1000}
            step={0.5}
            value={spacingMm}
            onChange={(e) => setSpacingMm(Number(e.target.value))}
          />
          <span className="text-[10px] text-base-content/40 mt-0.5">
            mm sobre la plancha (material físico). Más distancia ⇒ ranura más ancha
            (se quita más material).
          </span>
        </label>
      )}

      <p className="text-[10px] text-base-content/40 leading-snug">
        Preview esquemático. El patrón <strong>quita material</strong>: abre ranuras
        rectangulares (huecos) para que la pieza pueda plegarse. Los huecos reales y el
        desarrollo de la superficie los genera el servidor al generar los planos.
      </p>
    </div>
  );
}
