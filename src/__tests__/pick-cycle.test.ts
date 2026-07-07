import { describe, it, expect } from "vitest";
import { uniqueOrdered, sameIdSet, advanceCycle } from "@/core/pick-cycle";

describe("uniqueOrdered / sameIdSet", () => {
  it("dedup preservando orden", () => {
    expect(uniqueOrdered([3, 3, 1, 2, 1])).toEqual([3, 1, 2]);
  });
  it("sameIdSet compara orden y contenido", () => {
    expect(sameIdSet([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(sameIdSet([1, 2, 3], [1, 3, 2])).toBe(false);
    expect(sameIdSet([1, 2], [1, 2, 3])).toBe(false);
  });
});

describe("advanceCycle", () => {
  const ids = [10, 20, 30];

  it("primer click ⇒ arranca en defaultIndex", () => {
    const s = advanceCycle(null, 100, 100, ids, 1);
    expect(s.index).toBe(1);
    expect(s.ids).toEqual(ids);
  });

  it("mismo píxel + mismo set ⇒ avanza (con wrap)", () => {
    let s = advanceCycle(null, 100, 100, ids, 0); // index 0
    s = advanceCycle(s, 102, 101, ids, 0); // ~mismo píxel → 1
    expect(s.index).toBe(1);
    s = advanceCycle(s, 100, 100, ids, 0); // → 2
    expect(s.index).toBe(2);
    s = advanceCycle(s, 100, 100, ids, 0); // wrap → 0
    expect(s.index).toBe(0);
  });

  it("píxel lejano ⇒ resetea a defaultIndex", () => {
    let s = advanceCycle(null, 100, 100, ids, 0);
    s = advanceCycle(s, 300, 300, ids, 2); // lejos → default 2
    expect(s.index).toBe(2);
  });

  it("distinto set ⇒ resetea", () => {
    let s = advanceCycle(null, 100, 100, ids, 0);
    s = advanceCycle(s, 100, 100, [10, 20], 0); // otro set
    expect(s.index).toBe(0);
    expect(s.ids).toEqual([10, 20]);
  });
});
