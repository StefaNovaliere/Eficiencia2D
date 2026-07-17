import { describe, it, expect } from "vitest";
import {
  normalizeHex,
  hexToHsv,
  hsvToHex,
  hsvToWheelXY,
  wheelXYToHs,
} from "@/core/color";

describe("normalizeHex", () => {
  it("expande formato corto y baja a minúsculas", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex("FFF")).toBe("#ffffff");
    expect(normalizeHex("#12ab34")).toBe("#12ab34");
  });
  it("rechaza entradas inválidas", () => {
    expect(normalizeHex("#12")).toBeNull();
    expect(normalizeHex("xyzxyz")).toBeNull();
    expect(normalizeHex("")).toBeNull();
  });
});

describe("hex ↔ hsv round-trip", () => {
  const samples = ["#c4c4c4", "#8b6da6", "#cf9567", "#ff0000", "#00ff00", "#0000ff", "#000000", "#ffffff"];
  for (const hex of samples) {
    it(`preserva ${hex}`, () => {
      const { h, s, v } = hexToHsv(hex);
      expect(hsvToHex(h, s, v)).toBe(hex);
    });
  }

  it("gris puro tiene saturación 0", () => {
    expect(hexToHsv("#808080").s).toBe(0);
  });

  it("rojo puro es matiz 0", () => {
    const { h, s, v } = hexToHsv("#ff0000");
    expect(h).toBe(0);
    expect(s).toBe(1);
    expect(v).toBe(1);
  });
});

describe("rueda ↔ hue/sat", () => {
  it("matiz 0 (rojo) queda arriba", () => {
    const { x, y } = hsvToWheelXY(0, 1);
    expect(x).toBeCloseTo(0, 5);
    expect(y).toBeCloseTo(-1, 5);
  });

  it("matiz 90 queda a la derecha", () => {
    const { x, y } = hsvToWheelXY(90, 1);
    expect(x).toBeCloseTo(1, 5);
    expect(y).toBeCloseTo(0, 5);
  });

  it("round-trip posición → (h,s)", () => {
    for (const [h, s] of [[45, 0.5], [200, 0.8], [330, 0.3]] as const) {
      const { x, y } = hsvToWheelXY(h, s);
      const back = wheelXYToHs(x, y);
      expect(back.h).toBeCloseTo(h, 4);
      expect(back.s).toBeCloseTo(s, 4);
    }
  });

  it("clampa el radio al borde del disco", () => {
    const { s } = wheelXYToHs(2, 0);
    expect(s).toBe(1);
  });
});
