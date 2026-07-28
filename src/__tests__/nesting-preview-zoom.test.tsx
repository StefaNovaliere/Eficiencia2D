import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider } from "@/context/ThemeContext";
import NestingPreview from "@/components/NestingPreview";
import type { NestingPreviewData } from "@/core/pipeline";
import type { NestingPanel, NestingResult } from "@/core/sheet-nester";

const BOX = 300;

// jsdom no trae ResizeObserver; el lienzo lo usa para medirse.
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", NoopResizeObserver);

function panel(id: string, category: "wall" | "floor"): NestingPanel {
  return {
    id,
    category,
    widthM: 0.4,
    heightM: 0.3,
    edges: [
      { a: { x: 0, y: 0 }, b: { x: 0.4, y: 0 } },
      { a: { x: 0.4, y: 0 }, b: { x: 0.4, y: 0.3 } },
    ],
  };
}

function result(ids: string[], category: "wall" | "floor"): NestingResult {
  return {
    sheets: [
      {
        index: 0,
        utilization: 0.5,
        panels: ids.map((id, i) => ({
          panel: panel(id, category),
          x: 0.1 + i * 0.5,
          y: 0.1,
          rotated: false,
          effectiveW: 0.4,
          effectiveH: 0.3,
        })),
      },
    ],
    config: { widthM: 1.2, heightM: 0.8, gapM: 0.01 },
    scaleDenom: 50,
    unplaced: [],
  };
}

const nesting: NestingPreviewData = {
  wallNesting: result(["M1", "M2"], "wall"),
  floorNesting: result(["P1"], "floor"),
  config: { widthM: 1.2, heightM: 0.8, gapM: 0.01 },
};

function renderPreview() {
  render(
    <ThemeProvider>
      <NestingPreview
        nesting={nesting}
        onConfirm={vi.fn()}
        onBack={vi.fn()}
        sheetConfig={nesting.config}
        onSheetConfigChange={vi.fn()}
        scaleDenom={50}
        onScaleChange={vi.fn()}
        paper="A4"
        onPaperChange={vi.fn()}
        pageMode="single_page"
        onPageModeChange={vi.fn()}
        combineSheets={false}
        onCombineSheetsChange={vi.fn()}
      />
    </ThemeProvider>,
  );

  // El recuadro del lienzo es el contenedor del canvas; jsdom no mide nada.
  const box = document.querySelector("canvas")!.parentElement as HTMLElement;
  box.getBoundingClientRect = () =>
    ({
      left: 0, top: 0, right: 600, bottom: BOX,
      width: 600, height: BOX, x: 0, y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  return box;
}

/** Porcentaje que muestra el control de zoom del primer lienzo (Paredes). */
function zoomLabel() {
  return screen.getAllByText(/%$/)[0].textContent;
}

/** Rueda nativa: React registra `wheel` como pasivo, el componente usa el nativo. */
function wheel(box: HTMLElement, deltaY: number, at = { x: 300, y: 150 }) {
  const e = new Event("wheel", { bubbles: true, cancelable: true });
  Object.assign(e, { deltaY, deltaMode: 0, clientX: at.x, clientY: at.y });
  fireEvent(box, e); // fireEvent envuelve el despacho en act()
  return e;
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
});

describe("NestingPreview — zoom de la previsualización", () => {
  it("la ruedita hacia arriba acerca el lienzo", () => {
    const box = renderPreview();
    expect(zoomLabel()).toBe("100%");

    wheel(box, -200);

    expect(zoomLabel()).not.toBe("100%");
    expect(parseInt(zoomLabel()!, 10)).toBeGreaterThan(100);
  });

  it("la ruedita hacia abajo aleja hasta el encuadre completo y ahí para", () => {
    const box = renderPreview();
    wheel(box, -400);
    expect(parseInt(zoomLabel()!, 10)).toBeGreaterThan(100);

    for (let i = 0; i < 10; i++) wheel(box, 400);
    expect(zoomLabel()).toBe("100%");
  });

  /**
   * El lienzo vive dentro de un panel scrolleable. Si se comiera siempre la
   * rueda, con el dibujo entero a la vista el usuario no podría scrollear la
   * página con el mouse encima de la previsualización.
   */
  it("con el dibujo entero a la vista, alejar deja scrollear la página", () => {
    const box = renderPreview();

    const alejar = wheel(box, 300);
    expect(alejar.defaultPrevented).toBe(false);

    // En cambio acercar sí es nuestro: no debe scrollear la página.
    const acercar = wheel(box, -300);
    expect(acercar.defaultPrevented).toBe(true);
  });

  it("cada lienzo hace zoom por su cuenta", () => {
    renderPreview();
    const [paredes, pisos] = Array.from(document.querySelectorAll("canvas")).map(
      (c) => c.parentElement as HTMLElement,
    );
    for (const el of [paredes, pisos]) {
      el.getBoundingClientRect = () =>
        ({
          left: 0, top: 0, right: 600, bottom: BOX,
          width: 600, height: BOX, x: 0, y: 0, toJSON: () => ({}),
        }) as DOMRect;
    }

    wheel(paredes, -300);

    const etiquetas = screen.getAllByText(/%$/).map((n) => n.textContent);
    expect(parseInt(etiquetas[0]!, 10)).toBeGreaterThan(100);
    expect(etiquetas[1]).toBe("100%");
  });

  it("el botón de ver todo y el doble clic vuelven al encuadre completo", () => {
    const box = renderPreview();
    wheel(box, -400);
    expect(zoomLabel()).not.toBe("100%");

    fireEvent.click(screen.getByLabelText("Ver paredes completo"));
    expect(zoomLabel()).toBe("100%");

    wheel(box, -400);
    fireEvent.doubleClick(box);
    expect(zoomLabel()).toBe("100%");
  });

  it("los botones +/- también hacen zoom, para quien no usa rueda", () => {
    renderPreview();
    const acercar = screen.getByLabelText("Acercar paredes");
    const alejar = screen.getByLabelText("Alejar paredes");

    expect(alejar).toBeDisabled(); // ya está todo a la vista
    fireEvent.click(acercar);
    expect(parseInt(zoomLabel()!, 10)).toBeGreaterThan(100);
    expect(alejar).not.toBeDisabled();

    fireEvent.click(alejar);
    expect(zoomLabel()).toBe("100%");
  });
});
