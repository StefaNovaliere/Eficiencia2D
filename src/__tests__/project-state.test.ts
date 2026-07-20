import { describe, expect, it } from "vitest";
import {
  buildReviewEditingPatch,
  parseSavedState,
  restoreProjectState,
  savedStateNeedsRecompute,
} from "@/services/project-state";

describe("parseSavedState", () => {
  it("parsea campos del estado guardado en R2", () => {
    const state = parseSavedState({
      nombre: "Mi casa",
      axis: "Y",
      min_area_m2: 1,
      pin_tools: true,
      merges: [[1, 2]],
      splits: [{ group_id: 3, mode: "panels" }],
      overrides: { "5": "wall" },
      wall_wall_decisions: { "10": 11 },
      marks: [4, 7],
      sheet_config: { width_m: 1, height_m: 0.6, gap_m: 0.003 },
      scale_denom: 50,
      paper: "A4",
      page_mode: "one_per_sheet",
    });

    expect(state?.nombre).toBe("Mi casa");
    expect(state?.pin_tools).toBe(true);
    expect(state?.merges).toEqual([[1, 2]]);
    expect(state?.overrides).toEqual({ "5": "wall" });
    expect(state?.sheet_config).toEqual({ width_m: 1, height_m: 0.6, gap_m: 0.003 });
  });
});

describe("restoreProjectState", () => {
  it("convierte el estado guardado al formato del contexto", () => {
    const restored = restoreProjectState({
      overrides: { "5": "wall" },
      marks: [4],
      pin_tools: false,
      sheet_config: { width_m: 1, height_m: 0.6, gap_m: 0.003 },
    });

    expect(restored?.savedOverrides).toEqual([{ groupId: 5, newCategory: "wall" }]);
    expect(restored?.savedMarks).toEqual([4]);
    expect(restored?.pinTools).toBe(false);
    expect(restored?.sheetConfig).toEqual({ widthM: 1, heightM: 0.6, gapM: 0.003 });
  });
});

describe("savedStateNeedsRecompute", () => {
  it("detecta cuando hay que recalcular topología", () => {
    expect(
      savedStateNeedsRecompute({ savedMerges: [[1, 2]] }, "Y"),
    ).toBe(true);
    expect(
      savedStateNeedsRecompute({ axis: "Z" }, "Y"),
    ).toBe(true);
    expect(
      savedStateNeedsRecompute({ savedOverrides: [{ groupId: 1, newCategory: "wall" }] }, "Y"),
    ).toBe(false);
  });
});

describe("buildReviewEditingPatch", () => {
  it("incluye arrays vacíos para poder borrar ediciones en el backend", () => {
    const patch = buildReviewEditingPatch({
      overrides: [],
      wallWallDecisions: new Map(),
      marks: [],
      userCuts: [],
      notes: [],
      markLines: [],
    });

    expect(patch.overrides).toEqual({});
    expect(patch.wall_wall_decisions).toEqual({});
    expect(patch.marks).toEqual([]);
    expect(patch.user_cuts).toEqual([]);
    expect(patch.notes).toEqual([]);
    expect(patch.mark_lines).toEqual([]);
  });
});
