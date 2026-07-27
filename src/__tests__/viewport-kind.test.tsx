import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { useViewportKind } from "@/hooks/useViewportKind";
import RotateDevicePrompt from "@/components/RotateDevicePrompt";

/** Simula un viewport concreto (tamaño + tipo de puntero). */
function setViewport(width: number, height: number, coarsePointer: boolean) {
  Object.defineProperty(window, "innerWidth", { value: width, writable: true, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: height, writable: true, configurable: true });
  window.matchMedia = ((query: string) => ({
    matches: query.includes("pointer: coarse") ? coarsePointer : false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

const originalMatchMedia = window.matchMedia;

describe("useViewportKind", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => {
    vi.useRealTimers();
    window.matchMedia = originalMatchMedia;
  });

  it("en un celular vertical pide girar", () => {
    setViewport(390, 844, true);
    const { result } = renderHook(() => useViewportKind());
    expect(result.current.compact).toBe(true);
    expect(result.current.promptRotate).toBe(true);
  });

  it("al girar el celular deja de pedirlo pero SIGUE compacto", () => {
    // El caso del pedido: "que se pueda usar el visor volteando el celular".
    setViewport(390, 844, true);
    const { result } = renderHook(() => useViewportKind());
    expect(result.current.promptRotate).toBe(true);

    act(() => {
      setViewport(844, 390, true);
      window.dispatchEvent(new Event("orientationchange"));
      vi.advanceTimersByTime(300);
    });

    expect(result.current.promptRotate).toBe(false);
    expect(result.current.compact).toBe(true);
  });

  it("en escritorio no es compacto ni pide girar", () => {
    setViewport(1440, 900, false);
    const { result } = renderHook(() => useViewportKind());
    expect(result.current.compact).toBe(false);
    expect(result.current.promptRotate).toBe(false);
  });
});

describe("RotateDevicePrompt", () => {
  it("es una sugerencia, no un bloqueo: se puede seguir en vertical", () => {
    const onDismiss = vi.fn();
    render(<RotateDevicePrompt onDismiss={onDismiss} />);

    expect(screen.getByText("Girá el celular")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /seguir en vertical/i }));

    expect(onDismiss).toHaveBeenCalledOnce();
    expect(screen.queryByText("Girá el celular")).not.toBeInTheDocument();
  });
});
