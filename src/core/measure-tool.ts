/**
 * Measure tool — panel-local distances and component dimensions (preview only).
 */

import {
  formatPrintArea,
  formatPrintLength,
  isOriginalMeasureScale,
  realAreaToPrintM2,
  realLengthToPrintM,
} from "@/core/print-scale";

export type MeasureShapeKind = "line" | "rect";

export interface MeasureLabelOptions {
  /** 1 = tamaño real; N = tamaño en hoja a escala 1:N. */
  scaleDenom: number;
}

export const DEFAULT_MEASURE_LABEL_OPTIONS: MeasureLabelOptions = {
  scaleDenom: 1,
};

export interface MeasureDragState {
  groupId: number;
  kind: MeasureShapeKind;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  shiftKey: boolean;
}

export interface UserMeasure extends MeasureDragState {
  id: string;
}

export function createMeasureId(): string {
  return `measure-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function minMeasureSize(
  kind: MeasureShapeKind,
  r: Pick<MeasureDragState, "u0" | "v0" | "u1" | "v1">,
): number {
  if (kind === "line") return Math.hypot(r.u1 - r.u0, r.v1 - r.v0);
  return Math.min(Math.abs(r.u1 - r.u0), Math.abs(r.v1 - r.v0));
}

export function formatMeters(n: number): string {
  return `${Math.abs(n).toFixed(2).replace(".", ",")} m`;
}

export function formatAreaM2(n: number): string {
  return `${Math.abs(n).toFixed(2).replace(".", ",")} m²`;
}

/** Resolve drag end with Shift constraints (line ortho / rect square). */
export function resolveMeasureDrag(
  state: MeasureDragState,
): Pick<MeasureDragState, "u0" | "v0" | "u1" | "v1"> {
  let { u0, v0, u1, v1, kind, shiftKey } = state;
  const du = u1 - u0;
  const dv = v1 - v0;

  if (kind === "line" && shiftKey) {
    if (Math.abs(du) >= Math.abs(dv)) v1 = v0;
    else u1 = u0;
  } else if (kind === "rect" && shiftKey) {
    const side = Math.max(Math.abs(du), Math.abs(dv));
    u1 = u0 + Math.sign(du || 1) * side;
    v1 = v0 + Math.sign(dv || 1) * side;
  }

  return { u0, v0, u1, v1 };
}

export function measureDragLabel(
  state: MeasureDragState,
  panelSize?: { widthM: number; heightM: number },
): string {
  const resolved = resolveMeasureDrag(state);
  const du = resolved.u1 - resolved.u0;
  const dv = resolved.v1 - resolved.v0;

  if (state.kind === "line") {
    return formatMeters(Math.hypot(du, dv));
  }

  const w = Math.abs(du);
  const h = Math.abs(dv);
  const area = w * h;
  let label = `${formatMeters(w)} × ${formatMeters(h)} · ${formatAreaM2(area)}`;

  if (panelSize) {
    const minU = Math.min(resolved.u0, resolved.u1);
    const maxU = Math.max(resolved.u0, resolved.u1);
    const minV = Math.min(resolved.v0, resolved.v1);
    const maxV = Math.max(resolved.v0, resolved.v1);
    label += ` · ↑ ${formatMeters(Math.max(0, panelSize.heightM - maxV))} · ← ${formatMeters(Math.max(0, minU))}`;
  }

  return label;
}

/** Compact label pinned beside the measure geometry in the 3D view. */
export function measurePinnedLabel(
  state: MeasureDragState,
  options: MeasureLabelOptions = DEFAULT_MEASURE_LABEL_OPTIONS,
): string {
  const resolved = resolveMeasureDrag(state);
  const du = resolved.u1 - resolved.u0;
  const dv = resolved.v1 - resolved.v0;

  if (!isOriginalMeasureScale(options.scaleDenom)) {
    const denom = options.scaleDenom;
    if (state.kind === "line") {
      const onPaper = realLengthToPrintM(Math.hypot(du, dv), denom);
      return formatPrintLength(onPaper);
    }
    const w = realLengthToPrintM(Math.abs(du), denom);
    const h = realLengthToPrintM(Math.abs(dv), denom);
    const area = realAreaToPrintM2(Math.abs(du) * Math.abs(dv), denom);
    return `${formatPrintLength(w)} × ${formatPrintLength(h)} · ${formatPrintArea(area)}`;
  }

  if (state.kind === "line") {
    return formatMeters(Math.hypot(du, dv));
  }

  const w = Math.abs(du);
  const h = Math.abs(dv);
  return `${formatMeters(w)} × ${formatMeters(h)} · ${formatAreaM2(w * h)}`;
}

export function groupMeasureSummary(
  label: string,
  totalAreaM2: number,
  panelSize: { widthM: number; heightM: number } | null,
): string {
  const parts = [label, formatAreaM2(totalAreaM2)];
  if (panelSize) {
    parts.push(`${formatMeters(panelSize.widthM)} × ${formatMeters(panelSize.heightM)}`);
  }
  return parts.join(" · ");
}
