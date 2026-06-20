/**
 * Escalas de impresión del proyecto (1:N).
 * Usadas en nesting, PDF y medición en pantalla de revisión.
 */

export const PRINT_SCALE_OPTIONS = [
  20, 25, 50, 75, 100, 125, 150, 200, 250, 500,
] as const;

export type PrintScaleDenom = (typeof PRINT_SCALE_OPTIONS)[number];

/** 1 = medidas en tamaño real del modelo (sin escala de impresión). */
export const MEASURE_SCALE_ORIGINAL = 1;

export function isOriginalMeasureScale(scaleDenom: number): boolean {
  return scaleDenom <= MEASURE_SCALE_ORIGINAL;
}

export function formatMeasureScaleOption(scaleDenom: number): string {
  if (isOriginalMeasureScale(scaleDenom)) return "Original (1:1)";
  return formatPrintScaleRatio(scaleDenom);
}

export function formatPrintScaleRatio(scaleDenom: number): string {
  return `1:${scaleDenom}`;
}

/** Metros reales → metros en la hoja impresa a escala 1:N. */
export function realLengthToPrintM(lengthM: number, scaleDenom: number): number {
  if (scaleDenom <= 0) return lengthM;
  return lengthM / scaleDenom;
}

/** m² reales → m² en la hoja impresa a escala 1:N. */
export function realAreaToPrintM2(areaM2: number, scaleDenom: number): number {
  if (scaleDenom <= 0) return areaM2;
  return areaM2 / (scaleDenom * scaleDenom);
}

function fmtNum(n: number, decimals: number): string {
  return Math.abs(n).toFixed(decimals).replace(".", ",");
}

/** Longitud en la hoja impresa (entrada en metros sobre el papel). */
export function formatPrintLength(lengthOnPaperM: number): string {
  const cm = lengthOnPaperM * 100;
  if (cm >= 1) return `${fmtNum(cm, 2)} cm`;
  return `${fmtNum(lengthOnPaperM * 1000, 1)} mm`;
}

/** Área en la hoja impresa (entrada en m² sobre el papel). */
export function formatPrintArea(areaOnPaperM2: number): string {
  const cm2 = areaOnPaperM2 * 10_000;
  if (cm2 >= 1) return `${fmtNum(cm2, 2)} cm²`;
  return `${fmtNum(areaOnPaperM2 * 1_000_000, 0)} mm²`;
}
