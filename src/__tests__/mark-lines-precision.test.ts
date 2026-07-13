import { describe, expect, it } from "vitest";
import {
  getMarkLinePrecisionSpec,
  markLinePointsFromPrecision,
  parseMarkDegreesInput,
  parseMarkMetersInput,
} from "@/core/mark-lines";

describe("markLinePointsFromPrecision", () => {
  const panel = { widthM: 5, heightM: 3 };

  it("coloca línea a 0° (horizontal) de 1 m desde izq. y techo", () => {
    const points = markLinePointsFromPrecision(
      {
        lengthM: 1,
        angleDeg: 0,
        horizontalEdge: "left",
        verticalEdge: "top",
        offsetHorizontalM: 0.5,
        offsetVerticalM: 0.5,
      },
      panel.widthM,
      panel.heightM,
    );

    expect(points).toHaveLength(2);
    expect(points[0].u).toBeCloseTo(0.5);
    expect(points[0].v).toBeCloseTo(2.5);
    expect(points[1].u).toBeCloseTo(1.5);
    expect(points[1].v).toBeCloseTo(2.5);
  });

  it("coloca línea a 90° (vertical) de 1 m desde izq. y techo", () => {
    const points = markLinePointsFromPrecision(
      {
        lengthM: 1,
        angleDeg: 90,
        horizontalEdge: "left",
        verticalEdge: "top",
        offsetHorizontalM: 0.5,
        offsetVerticalM: 0.5,
      },
      panel.widthM,
      panel.heightM,
    );

    expect(points[0].u).toBeCloseTo(0.5);
    expect(points[0].v).toBeCloseTo(2.5);
    expect(points[1].u).toBeCloseTo(0.5);
    expect(points[1].v).toBeCloseTo(3.0); // 2.5 + 1 clamped to panel top → wait, top is height 3, +90 goes up
  });

  it("coloca línea a 45°", () => {
    const points = markLinePointsFromPrecision(
      {
        lengthM: Math.SQRT2,
        angleDeg: 45,
        horizontalEdge: "left",
        verticalEdge: "bottom",
        offsetHorizontalM: 1,
        offsetVerticalM: 1,
      },
      panel.widthM,
      panel.heightM,
    );

    expect(points[0].u).toBeCloseTo(1);
    expect(points[0].v).toBeCloseTo(1);
    expect(points[1].u).toBeCloseTo(2);
    expect(points[1].v).toBeCloseTo(2);
  });
});

describe("getMarkLinePrecisionSpec", () => {
  it("round-trip a 0°", () => {
    const original = {
      lengthM: 1.2,
      angleDeg: 0,
      horizontalEdge: "left" as const,
      verticalEdge: "top" as const,
      offsetHorizontalM: 0.3,
      offsetVerticalM: 0.4,
    };
    const points = markLinePointsFromPrecision(original, 6, 4);
    const again = getMarkLinePrecisionSpec(points, 6, 4, {
      horizontalEdge: "left",
      verticalEdge: "top",
    });

    expect(again?.lengthM).toBeCloseTo(1.2);
    expect(again?.angleDeg).toBeCloseTo(0);
    expect(again?.offsetHorizontalM).toBeCloseTo(0.3);
    expect(again?.offsetVerticalM).toBeCloseTo(0.4);
  });

  it("lee ángulo de una diagonal", () => {
    const again = getMarkLinePrecisionSpec(
      [
        { u: 1, v: 1 },
        { u: 2, v: 2 },
      ],
      6,
      4,
    );
    expect(again?.angleDeg).toBeCloseTo(45);
  });
});

describe("parseMarkMetersInput", () => {
  it("acepta coma decimal", () => {
    expect(parseMarkMetersInput("1,5")).toBeCloseTo(1.5);
  });
});

describe("parseMarkDegreesInput", () => {
  it("normaliza a [0, 360)", () => {
    expect(parseMarkDegreesInput("90")).toBe(90);
    expect(parseMarkDegreesInput("-90")).toBe(270);
    expect(parseMarkDegreesInput("450")).toBe(90);
  });
});
