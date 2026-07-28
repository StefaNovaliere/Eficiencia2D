import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/context/ThemeContext";
import { usePersistedModelColors } from "@/hooks/usePersistedModelColors";

const updateSettings = vi.fn(async () => ({}) as never);
let settings: { preferencias_interfaz: Record<string, unknown> } | null = null;

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ token: "tok-1", isLoadingAuth: false }),
}));
vi.mock("@/context/SettingsContext", () => ({
  useSettings: () => ({ settings, updateSettings, isLoadingSettings: false }),
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <ThemeProvider>{children}</ThemeProvider>
);

/** Colores que mandó el último PATCH. */
function lastPatchedColors() {
  const call = updateSettings.mock.lastCall as unknown as [
    { preferencias_interfaz: { colores_modelo: unknown } },
  ];
  return call[0].preferencias_interfaz.colores_modelo;
}

beforeEach(() => {
  vi.useFakeTimers();
  updateSettings.mockClear();
  settings = { preferencias_interfaz: { colores_modelo: null } };
  localStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe("usePersistedModelColors", () => {
  /**
   * Arrastrar la rueda emite un color por `pointermove`. Cuando cada uno
   * disparaba su PATCH, un gesto normal generaba decenas de pedidos y el visor
   * se trababa.
   */
  it("un arrastre entero manda UN solo PATCH, con el color final", () => {
    const { result } = renderHook(() => usePersistedModelColors(), { wrapper });

    act(() => {
      for (const hex of ["#111111", "#222222", "#333333", "#444444"]) {
        result.current.setModelColor("wall", hex);
      }
    });

    // Durante el gesto no viaja nada.
    expect(updateSettings).not.toHaveBeenCalled();
    // Pero el color local ya se ve en el visor: la vista previa es inmediata.
    expect(result.current.modelColors.wall).toBe("#444444");

    act(() => void vi.advanceTimersByTime(1000));

    expect(updateSettings).toHaveBeenCalledTimes(1);
    expect(lastPatchedColors()).toMatchObject({ wall: "#444444" });
  });

  it("acumula los tres canales en el mismo PATCH", () => {
    const { result } = renderHook(() => usePersistedModelColors(), { wrapper });

    act(() => {
      result.current.setModelColor("wall", "#aa0000");
      result.current.setModelColor("floor", "#00bb00");
      result.current.setModelColor("background", "#0000cc");
    });
    act(() => void vi.advanceTimersByTime(1000));

    expect(updateSettings).toHaveBeenCalledTimes(1);
    expect(lastPatchedColors()).toMatchObject({
      wall: "#aa0000",
      floor: "#00bb00",
      background: "#0000cc",
    });
  });

  /**
   * La respuesta del backend llegaba tarde y se rehidrataba encima del color en
   * curso: la manija saltaba sola a una posición vieja en pleno arrastre.
   */
  it("una respuesta tardía del backend no pisa el color que el usuario acaba de elegir", () => {
    settings = { preferencias_interfaz: { colores_modelo: { wall: "#111111" } } };
    const { result, rerender } = renderHook(() => usePersistedModelColors(), { wrapper });

    // Carga inicial de la cuenta.
    expect(result.current.modelColors.wall).toBe("#111111");

    act(() => result.current.setModelColor("wall", "#abcdef"));
    expect(result.current.modelColors.wall).toBe("#abcdef");

    // Llega la respuesta de un PATCH anterior, con el color viejo.
    settings = { preferencias_interfaz: { colores_modelo: { wall: "#111111" } } };
    act(() => rerender());

    expect(result.current.modelColors.wall).toBe("#abcdef");
  });

  it("restablecer guarda enseguida, sin esperar el debounce", () => {
    const { result } = renderHook(() => usePersistedModelColors(), { wrapper });

    act(() => result.current.setModelColor("wall", "#abcdef"));
    act(() => result.current.resetModelColors());

    expect(updateSettings).toHaveBeenCalledTimes(1);
    expect(lastPatchedColors()).toBeNull();
    expect(result.current.modelColors.wall).toBeNull();
  });
});
