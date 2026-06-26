import { describe, expect, it } from "vitest";
import {
  BACKEND_TEMA_CLARO,
  BACKEND_TEMA_OSCURO,
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
