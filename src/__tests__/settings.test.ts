import { describe, expect, it } from "vitest";
import {
  BACKEND_TEMA_CLARO,
  BACKEND_TEMA_OSCURO,
  coloresModeloFromOverrides,
  parseColoresModeloFromSettings,
  parseTemaColorToThemeId,
  themeIdToTemaColor,
} from "@/services/settings";

describe("settings tema_color mapping", () => {
  it("convierte oscuro/claro del backend al visor", () => {
    expect(parseTemaColorToThemeId(BACKEND_TEMA_OSCURO)).toBe("dark");
    expect(parseTemaColorToThemeId(BACKEND_TEMA_CLARO)).toBe("light");
  });

  it("convierte ThemeId al formato del backend", () => {
    expect(themeIdToTemaColor("dark")).toBe(BACKEND_TEMA_OSCURO);
    expect(themeIdToTemaColor("light")).toBe(BACKEND_TEMA_CLARO);
    expect(themeIdToTemaColor("neon")).toBe("neon");
  });

  it("preserva ids extendidos del visor", () => {
    expect(parseTemaColorToThemeId("aqua")).toBe("aqua");
    expect(themeIdToTemaColor("sunset")).toBe("sunset");
  });
});

describe("colores_modelo settings", () => {
  it("parsea colores del backend", () => {
    expect(
      parseColoresModeloFromSettings({
        wall: "#4ADE80",
        floor: null,
        background: "#0f172a",
      }),
    ).toEqual({
      wall: "#4ade80",
      floor: null,
      background: "#0f172a",
    });
  });

  it("null en colores_modelo resetea overrides", () => {
    expect(parseColoresModeloFromSettings(null)).toEqual({
      wall: null,
      floor: null,
      background: null,
    });
  });

  it("serializa overrides a patch (null si vacío)", () => {
    expect(
      coloresModeloFromOverrides({
        wall: "#111111",
        floor: null,
        background: null,
      }),
    ).toEqual({ wall: "#111111", floor: null, background: null });

    expect(
      coloresModeloFromOverrides({
        wall: null,
        floor: null,
        background: null,
      }),
    ).toBeNull();
  });
});
