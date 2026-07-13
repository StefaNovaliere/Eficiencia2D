import { describe, expect, it } from "vitest";
import {
  cutCoordsFromPrecision,
  getCutPrecisionSpec,
  parseCutMetersInput,
  type CutPrecisionSpec,
} from "@/core/user-cuts";

describe("cutCoordsFromPrecision", () => {
  const panel = { widthM: 5, heightM: 3 };

  it("coloca respecto a izquierda y techo", () => {
    const coords = cutCoordsFromPrecision(
      {
        widthM: 2,
        heightM: 2,
        horizontalEdge: "left",
        verticalEdge: "top",
        offsetHorizontalM: 0.5,
        offsetVerticalM: 0.5,
      },
      panel.widthM,
      panel.heightM,
    );

    expect(coords.u0).toBeCloseTo(0.5);
    expect(coords.u1).toBeCloseTo(2.5);
    expect(coords.v1).toBeCloseTo(2.5); // 3 - 0.5
    expect(coords.v0).toBeCloseTo(0.5); // 2.5 - 2
  });

  it("coloca respecto a derecha e inferior", () => {
    const coords = cutCoordsFromPrecision(
      {
        widthM: 1,
        heightM: 0.8,
        horizontalEdge: "right",
        verticalEdge: "bottom",
        offsetHorizontalM: 0.2,
        offsetVerticalM: 0.1,
      },
      panel.widthM,
      panel.heightM,
    );

    expect(coords.u1).toBeCloseTo(4.8);
    expect(coords.u0).toBeCloseTo(3.8);
    expect(coords.v0).toBeCloseTo(0.1);
    expect(coords.v1).toBeCloseTo(0.9);
  });

  it("clampa si el tamaño no cabe en el panel", () => {
    const coords = cutCoordsFromPrecision(
      {
        widthM: 10,
        heightM: 10,
        horizontalEdge: "left",
        verticalEdge: "bottom",
        offsetHorizontalM: 0,
        offsetVerticalM: 0,
      },
      panel.widthM,
      panel.heightM,
    );

    expect(coords.u0).toBe(0);
    expect(coords.u1).toBe(5);
    expect(coords.v0).toBe(0);
    expect(coords.v1).toBe(3);
  });
});

describe("getCutPrecisionSpec", () => {
  it("lee tamaño y offsets del corte", () => {
    const spec = getCutPrecisionSpec(
      { kind: "rect", u0: 0.5, v0: 0.5, u1: 2.5, v1: 2.5 },
      5,
      3,
      { horizontalEdge: "left", verticalEdge: "top" },
    );

    expect(spec.widthM).toBeCloseTo(2);
    expect(spec.heightM).toBeCloseTo(2);
    expect(spec.offsetHorizontalM).toBeCloseTo(0.5);
    expect(spec.offsetVerticalM).toBeCloseTo(0.5);
  });

  it("round-trip con bordes preferidos", () => {
    const original: CutPrecisionSpec = {
      widthM: 1.2,
      heightM: 0.8,
      horizontalEdge: "right",
      verticalEdge: "bottom",
      offsetHorizontalM: 0.3,
      offsetVerticalM: 0.4,
    };
    const coords = cutCoordsFromPrecision(original, 6, 4);
    const again = getCutPrecisionSpec(
      { kind: "rect", ...coords },
      6,
      4,
      {
        horizontalEdge: "right",
        verticalEdge: "bottom",
      },
    );

    expect(again.widthM).toBeCloseTo(1.2);
    expect(again.heightM).toBeCloseTo(0.8);
    expect(again.offsetHorizontalM).toBeCloseTo(0.3);
    expect(again.offsetVerticalM).toBeCloseTo(0.4);
  });
});

describe("parseCutMetersInput", () => {
  it("acepta coma decimal", () => {
    expect(parseCutMetersInput("2,73")).toBeCloseTo(2.73);
  });

  it("rechaza negativos", () => {
    expect(parseCutMetersInput("-1")).toBeNull();
  });
});
