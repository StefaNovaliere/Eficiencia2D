import { describe, expect, it } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ThemeProvider } from "@/context/ThemeContext";
import ModelColorWheel from "@/components/ModelColorWheel";

function renderWheel() {
  return render(
    <ThemeProvider>
      <ModelColorWheel />
    </ThemeProvider>,
  );
}

describe("ModelColorWheel", () => {
  it("monta con las dos manijas y el disco interactivo", () => {
    renderWheel();
    expect(screen.getByRole("application")).toBeInTheDocument();
    expect(screen.getByText("Pared")).toBeInTheDocument();
    expect(screen.getByText("Piso")).toBeInTheDocument();
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
