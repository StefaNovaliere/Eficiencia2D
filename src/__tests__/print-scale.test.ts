import { describe, it, expect } from "vitest";
import {
  PRINT_SCALE_OPTIONS,
  formatMeasureScaleOption,
  formatPrintArea,
  formatPrintLength,
  formatPrintScaleRatio,
  isOriginalMeasureScale,
  realAreaToPrintM2,
  realLengthToPrintM,
} from "@/core/print-scale";

describe("print-scale", () => {
  it("expone escalas de impresión estándar", () => {
    expect(PRINT_SCALE_OPTIONS).toContain(100);
    expect(PRINT_SCALE_OPTIONS).toContain(50);
  });

  it("convierte metros reales a tamaño en hoja", () => {
    expect(realLengthToPrintM(5, 100)).toBeCloseTo(0.05);
    expect(formatPrintLength(0.05)).toBe("5,00 cm");
    expect(formatPrintScaleRatio(100)).toBe("1:100");
  });

  it("convierte área real a área en hoja", () => {
    expect(realAreaToPrintM2(6, 100)).toBeCloseTo(0.0006);
    expect(formatPrintArea(0.0006)).toBe("6,00 cm²");
  });

  it("formatea opción original y de impresión", () => {
    expect(formatMeasureScaleOption(1)).toBe("Original (1:1)");
    expect(formatMeasureScaleOption(100)).toBe("1:100");
    expect(isOriginalMeasureScale(1)).toBe(true);
    expect(isOriginalMeasureScale(100)).toBe(false);
  });
});
