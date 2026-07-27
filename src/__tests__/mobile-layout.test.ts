import { describe, it, expect } from "vitest";
import {
  COMPACT_MIN_SIDE,
  isCompactViewport,
  isPortrait,
  shouldPromptRotate,
  sidebarSizing,
} from "@/core/mobile-layout";

/** Viewports reales, para que los umbrales no sean números al azar. */
const PHONE_PORTRAIT = { width: 390, height: 844 };
const PHONE_LANDSCAPE = { width: 844, height: 390 };
const PHONE_SMALL_PORTRAIT = { width: 360, height: 620 }; // con barra del navegador
const TABLET_PORTRAIT = { width: 820, height: 1180 };
const LAPTOP = { width: 1440, height: 900 };

describe("clasificación del viewport", () => {
  it("un celular es compacto en LAS DOS orientaciones", () => {
    // Es el punto del enfoque: al girar el teléfono el layout no vuelve al de
    // escritorio, sólo cambia de orientación.
    expect(isCompactViewport(PHONE_PORTRAIT)).toBe(true);
    expect(isCompactViewport(PHONE_LANDSCAPE)).toBe(true);
    expect(isCompactViewport(PHONE_SMALL_PORTRAIT)).toBe(true);
  });

  it("tablet y laptop NO son compactos", () => {
    expect(isCompactViewport(TABLET_PORTRAIT)).toBe(false);
    expect(isCompactViewport(LAPTOP)).toBe(false);
  });

  it("el umbral mide el lado menor", () => {
    expect(isCompactViewport({ width: COMPACT_MIN_SIDE, height: 2000 })).toBe(true);
    expect(isCompactViewport({ width: COMPACT_MIN_SIDE + 1, height: 2000 })).toBe(false);
  });

  it("detecta orientación", () => {
    expect(isPortrait(PHONE_PORTRAIT)).toBe(true);
    expect(isPortrait(PHONE_LANDSCAPE)).toBe(false);
    // Cuadrado exacto: no es vertical.
    expect(isPortrait({ width: 500, height: 500 })).toBe(false);
  });
});

describe("aviso de girar el celular", () => {
  it("se muestra en un celular táctil en vertical", () => {
    expect(shouldPromptRotate({ ...PHONE_PORTRAIT, coarsePointer: true })).toBe(true);
  });

  it("NO se muestra una vez girado", () => {
    expect(shouldPromptRotate({ ...PHONE_LANDSCAPE, coarsePointer: true })).toBe(false);
  });

  it("NO se muestra en una ventana de escritorio angosta: no hay nada que girar", () => {
    expect(shouldPromptRotate({ width: 420, height: 900, coarsePointer: false })).toBe(false);
  });

  it("NO se muestra en una tablet vertical: el layout ya entra", () => {
    expect(shouldPromptRotate({ ...TABLET_PORTRAIT, coarsePointer: true })).toBe(false);
  });
});

describe("medidas del panel lateral", () => {
  it("en compacto arranca oculto para que el lienzo ocupe todo", () => {
    expect(sidebarSizing(true).startsHidden).toBe(true);
    expect(sidebarSizing(false).startsHidden).toBe(false);
  });

  it("en compacto el panel es más angosto que en escritorio", () => {
    expect(sidebarSizing(true).defaultSize).toBeLessThan(sidebarSizing(false).defaultSize);
    expect(sidebarSizing(true).maxSize).toBeLessThan(sidebarSizing(false).maxSize);
  });

  it("abierto en un celular acostado deja MÁS de la mitad al visor 3D", () => {
    // 844px es el lado largo de un celular típico: con el panel abierto al
    // máximo el modelo tiene que seguir siendo lo dominante en pantalla.
    const { maxSize } = sidebarSizing(true);
    expect(PHONE_LANDSCAPE.width - maxSize).toBeGreaterThan(PHONE_LANDSCAPE.width / 2);
  });

  it("las medidas son coherentes (min ≤ default ≤ max)", () => {
    for (const compact of [true, false]) {
      const s = sidebarSizing(compact);
      expect(s.minSize).toBeLessThanOrEqual(s.defaultSize);
      expect(s.defaultSize).toBeLessThanOrEqual(s.maxSize);
    }
  });
});
