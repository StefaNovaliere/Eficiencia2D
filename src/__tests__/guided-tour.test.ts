import { describe, it, expect, beforeEach } from "vitest";
import {
  computeTooltipPosition,
  hasSeenReviewTour,
  markReviewTourSeen,
  resolveTourSteps,
  REVIEW_TOUR_SEEN_KEY,
  REVIEW_TOUR_STEPS,
  tourTargetSelector,
  type TourStep,
} from "@/core/guided-tour";

const VIEWPORT = { width: 1280, height: 720 };
const CARD = { width: 300, height: 170 };

describe("computeTooltipPosition", () => {
  const target = { left: 500, top: 300, width: 200, height: 100 };

  it("ubica abajo del ancla con placement bottom", () => {
    const pos = computeTooltipPosition(target, CARD, VIEWPORT, "bottom");
    expect(pos.placement).toBe("bottom");
    expect(pos.top).toBeGreaterThan(target.top + target.height);
    // Centrada horizontalmente sobre el ancla.
    expect(pos.left).toBeCloseTo(500 + 100 - 150, 5);
  });

  it("voltea al lado opuesto cuando no entra", () => {
    // Ancla pegada al fondo: bottom no entra → top.
    const low = { left: 500, top: 640, width: 200, height: 60 };
    const pos = computeTooltipPosition(low, CARD, VIEWPORT, "bottom");
    expect(pos.placement).toBe("top");
    expect(pos.top + CARD.height).toBeLessThanOrEqual(low.top);
  });

  it("clampa dentro del viewport", () => {
    const corner = { left: 0, top: 0, width: 40, height: 40 };
    const pos = computeTooltipPosition(corner, CARD, VIEWPORT, "left");
    expect(pos.left).toBeGreaterThanOrEqual(0);
    expect(pos.top).toBeGreaterThanOrEqual(0);
    expect(pos.left + CARD.width).toBeLessThanOrEqual(VIEWPORT.width);
    expect(pos.top + CARD.height).toBeLessThanOrEqual(VIEWPORT.height);
  });
});

describe("persistencia de primera visita", () => {
  beforeEach(() => localStorage.removeItem(REVIEW_TOUR_SEEN_KEY));

  it("no visto → visto tras marcar", () => {
    expect(hasSeenReviewTour()).toBe(false);
    markReviewTourSeen();
    expect(hasSeenReviewTour()).toBe(true);
    expect(localStorage.getItem(REVIEW_TOUR_SEEN_KEY)).toBe("1");
  });
});

describe("resolveTourSteps", () => {
  const steps: TourStep[] = [
    { id: "a", target: "exists", title: "A", body: "…" },
    { id: "b", target: "missing", title: "B", body: "…" },
  ];

  it("salta pasos cuyo ancla no está en el DOM", () => {
    document.body.innerHTML = `<div data-tour="exists"></div>`;
    const resolved = resolveTourSteps(steps, document);
    expect(resolved.map((s) => s.id)).toEqual(["a"]);
    document.body.innerHTML = "";
  });

  it("los pasos del tour de Revisión usan selectores válidos", () => {
    for (const s of REVIEW_TOUR_STEPS) {
      expect(() => document.querySelector(tourTargetSelector(s.target))).not.toThrow();
    }
  });
});
