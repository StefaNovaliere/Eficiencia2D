import { describe, expect, it } from "vitest";
import {
  findCutAtPoint,
  hitTestCut,
  hitTestCutForMove,
  type UserCut,
} from "@/core/user-cuts";

const rectCut: UserCut = {
  id: "r1",
  groupId: 5,
  kind: "rect",
  u0: 1,
  v0: 1,
  u1: 3,
  v1: 2,
};

const circleCut: UserCut = {
  id: "c1",
  groupId: 5,
  kind: "circle",
  u0: 1,
  v0: 1,
  u1: 3,
  v1: 3,
};

describe("hitTestCutForMove", () => {
  it("detects interior of rect for move", () => {
    expect(hitTestCutForMove(rectCut, 2, 1.5, 10, 10)).toBe(true);
  });

  it("perimeter-only hitTestCut misses rect interior", () => {
    expect(hitTestCut(rectCut, 2, 1.5, 10, 10)).toBe(false);
  });

  it("detects interior of circle for move", () => {
    expect(hitTestCutForMove(circleCut, 2, 2, 10, 10)).toBe(true);
  });

  it("findCutAtPoint prefers selected cut when overlapping", () => {
    const cuts = [rectCut, { ...circleCut, id: "c2", u0: 1.5, v0: 1.5, u1: 2.5, v1: 2.5 }];
    const found = findCutAtPoint(cuts, 5, 2, 1.6, 10, 10, { preferredId: "c2" });
    expect(found?.id).toBe("c2");
  });
});
