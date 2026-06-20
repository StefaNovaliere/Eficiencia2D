import { describe, it, expect } from "vitest";
import {
  formatAreaM2,
  formatMeters,
  groupMeasureSummary,
  measureDragLabel,
  measurePinnedLabel,
  resolveMeasureDrag,
} from "@/core/measure-tool";

describe("measure-tool", () => {
  it("formatea metros y área", () => {
    expect(formatMeters(1.5)).toBe("1,50 m");
    expect(formatAreaM2(6)).toBe("6,00 m²");
  });

  it("mide distancia en línea", () => {
    const label = measureDragLabel({
      groupId: 1,
      kind: "line",
      u0: 0,
      v0: 0,
      u1: 3,
      v1: 4,
      shiftKey: false,
    });
    expect(label).toBe("5,00 m");
  });

  it("mide área en rectángulo", () => {
    const label = measureDragLabel({
      groupId: 1,
      kind: "rect",
      u0: 0,
      v0: 0,
      u1: 2,
      v1: 3,
      shiftKey: false,
    });
    expect(label).toContain("2,00 m × 3,00 m");
    expect(label).toContain("6,00 m²");
  });

  it("⇧ fuerza línea ortogonal", () => {
    const r = resolveMeasureDrag({
      groupId: 1,
      kind: "line",
      u0: 0,
      v0: 0,
      u1: 2,
      v1: 1,
      shiftKey: true,
    });
    expect(r.v1).toBe(0);
  });

  it("resume dimensiones del componente", () => {
    expect(
      groupMeasureSummary("Pared A", 6, { widthM: 2, heightM: 3 }),
    ).toBe("Pared A · 6,00 m² · 2,00 m × 3,00 m");
  });

  it("etiqueta fija compacta para línea y rectángulo", () => {
    expect(
      measurePinnedLabel({
        groupId: 1,
        kind: "line",
        u0: 0,
        v0: 0,
        u1: 3,
        v1: 4,
        shiftKey: false,
      }),
    ).toBe("5,00 m");

    const rect = measurePinnedLabel({
      groupId: 1,
      kind: "rect",
      u0: 0,
      v0: 0,
      u1: 2,
      v1: 3,
      shiftKey: false,
    });
    expect(rect).toBe("2,00 m × 3,00 m · 6,00 m²");
  });

  it("etiqueta en escala de impresión", () => {
    expect(
      measurePinnedLabel(
        {
          groupId: 1,
          kind: "line",
          u0: 0,
          v0: 0,
          u1: 5,
          v1: 0,
          shiftKey: false,
        },
        { scaleDenom: 100 },
      ),
    ).toBe("5,00 cm");

    expect(
      measurePinnedLabel(
        {
          groupId: 1,
          kind: "rect",
          u0: 0,
          v0: 0,
          u1: 2,
          v1: 3,
          shiftKey: false,
        },
        { scaleDenom: 100 },
      ),
    ).toBe("2,00 cm × 3,00 cm · 6,00 cm²");
  });
});
