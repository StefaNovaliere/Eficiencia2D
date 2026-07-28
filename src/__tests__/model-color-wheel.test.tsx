import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ThemeProvider, useTheme } from "@/context/ThemeContext";
import ModelColorWheel from "@/components/ModelColorWheel";

vi.mock("@/hooks/usePersistedModelColors", () => ({
  usePersistedModelColors: () => {
    const { modelColors, setModelColor, resetModelColors } = useTheme();
    return { modelColors, setModelColor, resetModelColors };
  },
}));

const WHEEL_PX = 168;
const CENTER = WHEEL_PX / 2;

function renderWheel() {
  const utils = render(
    <ThemeProvider>
      <ModelColorWheel />
    </ThemeProvider>,
  );
  const wheel = screen.getByRole("application");
  // jsdom no mide ni implementa la Pointer Capture API.
  wheel.getBoundingClientRect = () =>
    ({
      left: 0, top: 0, right: WHEEL_PX, bottom: WHEEL_PX,
      width: WHEEL_PX, height: WHEEL_PX, x: 0, y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  Object.assign(wheel, {
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
    hasPointerCapture: () => false,
  });
  return { ...utils, wheel };
}

/** Posición en px de la manija de un canal ("Pa" | "Pi" | "Fo"). */
function handleAt(glyph: string) {
  const el = screen.getByText(glyph).parentElement as HTMLElement;
  return { left: parseFloat(el.style.left), top: parseFloat(el.style.top) };
}

/**
 * Punto lejos de todas las manijas: agarrar ahí mueve el canal ACTIVO en vez de
 * la manija más cercana (los colores por defecto son casi grises y se apilan
 * cerca del centro).
 */
const LEJOS: [number, number] = [8, WHEEL_PX - 8];

function drag(wheel: HTMLElement, to: [number, number], from: [number, number] = LEJOS) {
  fireEvent.pointerDown(wheel, { clientX: from[0], clientY: from[1], pointerId: 1 });
  fireEvent.pointerMove(wheel, { clientX: to[0], clientY: to[1], pointerId: 1 });
  fireEvent.pointerUp(wheel, { clientX: to[0], clientY: to[1], pointerId: 1 });
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
});

describe("ModelColorWheel", () => {
  it("monta con las tres manijas (pared/piso/fondo) y el disco interactivo", () => {
    renderWheel();
    expect(screen.getByRole("application")).toBeInTheDocument();
    expect(screen.getByText("Pared")).toBeInTheDocument();
    expect(screen.getByText("Piso")).toBeInTheDocument();
    expect(screen.getByText("Fondo")).toBeInTheDocument();
    cleanup();
  });

  it("el canal Fondo edita el color de fondo del visor", () => {
    renderWheel();
    fireEvent.click(screen.getByText("Fondo"));
    const bgHex = screen.getByLabelText("Código hex de fondo") as HTMLInputElement;
    fireEvent.change(bgHex, { target: { value: "0a0a0a" } });
    expect(
      (screen.getByLabelText("Código hex de fondo") as HTMLInputElement).value,
    ).toBe("0a0a0a");
    cleanup();
  });

  it("el campo hex sigue al canal activo (Pared → Piso)", () => {
    renderWheel();
    const wallHex = screen.getByLabelText("Código hex de pared") as HTMLInputElement;
    const wallValue = wallHex.value;
    // Cambiar al canal Piso.
    fireEvent.click(screen.getByText("Piso"));
    const floorHex = screen.getByLabelText("Código hex de piso") as HTMLInputElement;
    expect(floorHex.value).not.toBe(wallValue);
    cleanup();
  });

  it("editar el hex cambia el color del canal activo", () => {
    renderWheel();
    const wallHex = screen.getByLabelText("Código hex de pared") as HTMLInputElement;
    fireEvent.change(wallHex, { target: { value: "112233" } });
    expect(
      (screen.getByLabelText("Código hex de pared") as HTMLInputElement).value,
    ).toBe("112233");
    cleanup();
  });
});

/**
 * El color se guarda como hex de 8 bits. Ese redondeo pierde matiz y saturación
 * cuando el brillo es bajo (con v=0 TODO h/s colapsa a #000000), así que la
 * manija dejaba de seguir al puntero: se trababa o saltaba.
 */
describe("ModelColorWheel — arrastre", () => {
  it("la manija sigue al puntero aunque el hex no pueda representar el matiz (negro)", () => {
    const { wheel } = renderWheel();
    fireEvent.click(screen.getByText("Fondo"));
    fireEvent.change(screen.getByLabelText("Código hex de fondo"), {
      target: { value: "000000" },
    });

    // Con brillo 0 la manija arranca en el centro (saturación irrecuperable).
    expect(handleAt("Fo")).toEqual({ left: CENTER, top: CENTER });

    // Arrastre al borde derecho: matiz 90°, saturación 1.
    drag(wheel, [WHEEL_PX, CENTER]);

    const pos = handleAt("Fo");
    expect(pos.left).toBeCloseTo(WHEEL_PX, 1);
    expect(pos.top).toBeCloseTo(CENTER, 1);
    cleanup();
  });

  it("la manija llega a donde apunta el mouse, sin quedarse a medio camino", () => {
    const { wheel } = renderWheel();
    fireEvent.click(screen.getByText("Piso"));

    // Borde superior = matiz 0, saturación 1.
    drag(wheel, [CENTER, 0]);

    const pos = handleAt("Pi");
    expect(pos.left).toBeCloseTo(CENTER, 1);
    expect(pos.top).toBeCloseTo(0, 1);
    cleanup();
  });

  it("bajar el brillo a 0 no borra el matiz elegido", () => {
    const { wheel } = renderWheel();
    fireEvent.click(screen.getByText("Piso"));
    drag(wheel, [WHEEL_PX, CENTER]);
    const elegido = handleAt("Pi");

    const brillo = screen.getByLabelText("Brillo de piso");
    fireEvent.change(brillo, { target: { value: "0" } });
    // El color es negro, pero la elección de matiz/saturación se conserva…
    expect(handleAt("Pi")).toEqual(elegido);

    // …y vuelve al subir el brillo.
    fireEvent.change(brillo, { target: { value: "100" } });
    expect(
      (screen.getByLabelText("Código hex de piso") as HTMLInputElement).value,
    ).toBe("80ff00");
    cleanup();
  });

  it("con las manijas apiladas se arrastra la del canal activo", () => {
    const { wheel } = renderWheel();
    // Grises puros: saturación 0 → las tres manijas caen en el centro.
    for (const [canal, campo] of [
      ["Pared", "pared"],
      ["Piso", "piso"],
      ["Fondo", "fondo"],
    ] as const) {
      fireEvent.click(screen.getByText(canal));
      fireEvent.change(screen.getByLabelText(`Código hex de ${campo}`), {
        target: { value: "808080" },
      });
    }

    fireEvent.click(screen.getByText("Pared"));
    // Agarre EN el centro: las tres manijas empatan a distancia 0.
    drag(wheel, [WHEEL_PX, CENTER], [CENTER, CENTER]);

    // Se movió Pared, no la última del array (Fondo).
    expect(handleAt("Pa").left).toBeCloseTo(WHEEL_PX, 1);
    expect(handleAt("Fo")).toEqual({ left: CENTER, top: CENTER });
    cleanup();
  });
});
