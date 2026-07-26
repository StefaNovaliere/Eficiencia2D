import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import GuidedTour from "@/components/tour/GuidedTour";
import ReviewTour from "@/components/tour/ReviewTour";
import { REVIEW_TOUR_SEEN_KEY } from "@/core/guided-tour";
import type { TourStep } from "@/core/guided-tour";

const STEPS: TourStep[] = [
  { id: "s1", target: "t1", title: "Paso uno", body: "cuerpo 1" },
  { id: "s2", target: "t2", title: "Paso dos", body: "cuerpo 2" },
];

function mountAnchors() {
  const holder = document.createElement("div");
  holder.innerHTML = `<div data-tour="t1"></div><div data-tour="t2"></div>
    <div data-tour="viewer-3d"></div>`;
  document.body.appendChild(holder);
  return holder;
}

beforeEach(() => {
  cleanup();
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("GuidedTour", () => {
  it("navega Siguiente → Terminar y reporta completed", () => {
    mountAnchors();
    const onClose = vi.fn();
    render(<GuidedTour steps={STEPS} onClose={onClose} />);

    expect(screen.getByText("Paso uno")).toBeInTheDocument();
    expect(screen.getByText("1 / 2")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Siguiente"));
    expect(screen.getByText("Paso dos")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Terminar"));
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it("salta anclas ausentes y cierra con la X sin completar", () => {
    // Sólo existe t2 → el tour arranca directamente en el paso dos, 1/1.
    const holder = document.createElement("div");
    holder.innerHTML = `<div data-tour="t2"></div>`;
    document.body.appendChild(holder);

    const onClose = vi.fn();
    render(<GuidedTour steps={STEPS} onClose={onClose} />);
    expect(screen.getByText("Paso dos")).toBeInTheDocument();
    expect(screen.getByText("1 / 1")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Cerrar tour"));
    expect(onClose).toHaveBeenCalledWith(false);
  });
});

describe("ReviewTour (primera visita)", () => {
  it("invita la primera vez; 'Ahora no' marca visto y no vuelve a invitar", () => {
    mountAnchors();
    render(<ReviewTour />);
    expect(screen.getByText("¿Primera vez en el visor?")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Ahora no"));
    expect(localStorage.getItem(REVIEW_TOUR_SEEN_KEY)).toBe("1");
    expect(screen.queryByText("¿Primera vez en el visor?")).not.toBeInTheDocument();

    cleanup();
    render(<ReviewTour />);
    expect(screen.queryByText("¿Primera vez en el visor?")).not.toBeInTheDocument();
  });

  it("'Ver el tour' arranca el tour con los pasos de Revisión", () => {
    mountAnchors();
    render(<ReviewTour />);
    fireEvent.click(screen.getByText("Ver el tour"));
    // Con sólo el ancla del visor montada, arranca en "El visor 3D".
    expect(screen.getByText("El visor 3D")).toBeInTheDocument();
  });

  it("si ya fue visto, no invita pero se relanza con launchNonce", () => {
    mountAnchors();
    localStorage.setItem(REVIEW_TOUR_SEEN_KEY, "1");
    const { rerender } = render(<ReviewTour launchNonce={0} />);
    expect(screen.queryByText("¿Primera vez en el visor?")).not.toBeInTheDocument();

    rerender(<ReviewTour launchNonce={1} />);
    expect(screen.getByText("El visor 3D")).toBeInTheDocument();
  });
});
