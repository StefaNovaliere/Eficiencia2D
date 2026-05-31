import { describe, it, expect } from "vitest";
import { parseObj } from "@/core/obj-parser";
import { classifyIntoGroups } from "@/core/group-classifier";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a closed thin slab box (a flat plate) as an OBJ string.
 * Footprint = sx × sz, sitting at y=[base, base+t]. Top skin normal +Y,
 * bottom skin normal -Y, and 4 vertical rim faces forming the thickness band.
 * `o` is the global vertex-index offset (0 for the first object in the file).
 */
function slabFaces(base: number, t: number, sx = 4, sz = 4, o = 0): string {
  const v = [
    `v 0 ${base} 0`,
    `v ${sx} ${base} 0`,
    `v ${sx} ${base} ${sz}`,
    `v 0 ${base} ${sz}`,
    `v 0 ${base + t} 0`,
    `v ${sx} ${base + t} 0`,
    `v ${sx} ${base + t} ${sz}`,
    `v 0 ${base + t} ${sz}`,
  ].join("\n");
  const i = (n: number) => o + n;
  const f = [
    `f ${i(1)} ${i(2)} ${i(3)} ${i(4)}`, // bottom skin (-Y)
    `f ${i(8)} ${i(7)} ${i(6)} ${i(5)}`, // top skin (+Y)
    `f ${i(1)} ${i(2)} ${i(6)} ${i(5)}`, // rim front
    `f ${i(2)} ${i(3)} ${i(7)} ${i(6)}`, // rim right
    `f ${i(3)} ${i(4)} ${i(8)} ${i(7)}`, // rim back
    `f ${i(4)} ${i(1)} ${i(5)} ${i(8)}`, // rim left
  ].join("\n");
  return `${v}\n${f}`;
}

// ---------------------------------------------------------------------------
// Slab edge detection — absorb the vertical thickness band into the floor
// ---------------------------------------------------------------------------

describe("slab edge detection", () => {
  it("absorbs a closed slab's rim faces into a single floor group with measured thickness", () => {
    const groups = classifyIntoGroups(parseObj(slabFaces(0, 0.2)).faces);

    const real = groups.filter((g) => g.category !== "discard");
    expect(real.length).toBe(1);
    expect(real[0].category).toBe("floor");
    // 2 skins + 4 rim faces, all in one piece.
    expect(real[0].faceIndices.length).toBe(6);
    expect(real[0].thickness).toBeCloseTo(0.2, 3);

    // No vertical face survives as a wall.
    expect(groups.some((g) => g.category.startsWith("wall"))).toBe(false);
    // Nothing left as a leftover discard rim either.
    expect(groups.some((g) => g.category === "discard")).toBe(false);
  });

  it("does NOT absorb a genuine wall standing on the slab", () => {
    // Slab (verts 1..8) + a 3m-tall wall (separate object, its own verts 9..12)
    // resting on the slab's top front edge. Its top edge reaches the ceiling,
    // not a second slab skin, so the rim-vs-wall discriminator keeps it a wall.
    const obj = `
${slabFaces(0, 0.2)}
v 0 0.2 0
v 4 0.2 0
v 4 3.2 0
v 0 3.2 0
f 9 10 11 12
`;
    const groups = classifyIntoGroups(parseObj(obj).faces);

    const floors = groups.filter((g) => g.category === "floor");
    const walls = groups.filter((g) => g.category.startsWith("wall"));

    expect(floors.length).toBe(1);
    expect(floors[0].faceIndices.length).toBe(6); // slab only, wall not pulled in
    expect(floors[0].thickness).toBeCloseTo(0.2, 3);

    // The tall wall stays its own component.
    expect(walls.length).toBe(1);
    expect(walls[0].faceIndices.length).toBe(1);
  });

  it("leaves a single-surface floor (no bottom, no rim) untouched", () => {
    const obj = `
v 0 0 0
v 4 0 0
v 4 0 4
v 0 0 4
f 1 2 3 4
`;
    const groups = classifyIntoGroups(parseObj(obj).faces);
    const real = groups.filter((g) => g.category !== "discard");
    expect(real.length).toBe(1);
    expect(real[0].category).toBe("floor");
    expect(real[0].thickness).toBeUndefined();
  });

  it("detects each slab independently in a multi-storey model", () => {
    // Two stacked slab boxes; no connecting geometry. Rims must not cross-match.
    const obj = `
${slabFaces(0, 0.2, 4, 4, 0)}
${slabFaces(3, 0.25, 4, 4, 8)}
`;
    const groups = classifyIntoGroups(parseObj(obj).faces);
    const floors = groups.filter((g) => g.category === "floor");

    expect(floors.length).toBe(2);
    for (const f of floors) expect(f.faceIndices.length).toBe(6);
    const thicks = floors.map((f) => f.thickness ?? -1).sort();
    expect(thicks[0]).toBeCloseTo(0.2, 3);
    expect(thicks[1]).toBeCloseTo(0.25, 3);
    expect(groups.some((g) => g.category.startsWith("wall"))).toBe(false);
  });

  it("recognises the slab regardless of thickness (no hardcoded height cutoff)", () => {
    // A thin 2cm rim and a thick 50cm rim are both recognised by the same
    // code path: the decision is topological, not a height threshold.
    for (const t of [0.02, 0.2, 0.5]) {
      const groups = classifyIntoGroups(parseObj(slabFaces(0, t)).faces);
      const real = groups.filter((g) => g.category !== "discard");
      expect(real.length, `thickness ${t}`).toBe(1);
      expect(real[0].category, `thickness ${t}`).toBe("floor");
      expect(real[0].faceIndices.length, `thickness ${t}`).toBe(6);
      expect(real[0].thickness, `thickness ${t}`).toBeCloseTo(t, 3);
      expect(
        groups.some((g) => g.category.startsWith("wall")),
        `thickness ${t}`,
      ).toBe(false);
    }
  });

  it("does NOT absorb a tall wall that is coplanar with a slab rim", () => {
    // Slab (verts 1..8) whose +Z rim sits on plane z=4, plus a 3m-tall wall in
    // the SAME plane z=4 but with its own vertices (9..12). The wall must not be
    // dragged into the floor, and the slab thickness must still be measured.
    const obj = `
${slabFaces(0, 0.2)}
v 0 0 4
v 4 0 4
v 4 3 4
v 0 3 4
f 9 10 11 12
`;
    const groups = classifyIntoGroups(parseObj(obj).faces);
    const floors = groups.filter((g) => g.category === "floor");
    const walls = groups.filter((g) => g.category.startsWith("wall"));

    expect(floors.length).toBe(1);
    expect(floors[0].faceIndices.length).toBe(6); // slab only
    expect(floors[0].thickness).toBeCloseTo(0.2, 3);
    expect(walls.length).toBe(1);
    expect(walls[0].faceIndices.length).toBe(1);
  });

  it("does NOT treat a room's wall (floor-below + ceiling-above) as a slab rim", () => {
    // A room: floor at y=0 facing UP, ceiling at y=3 facing DOWN, and a wall
    // sharing edges with both. The rim bracket requires an UP-skin on top and a
    // DOWN-skin below (a slab's outward skins); a room has the reverse, so the
    // wall is rejected by orientation — no false slab, the wall stays a wall.
    const obj = `
v 0 0 0
v 4 0 0
v 4 0 4
v 0 0 4
v 0 3 0
v 4 3 0
v 4 3 4
v 0 3 4
f 4 3 2 1
f 5 6 7 8
f 1 2 6 5
`;
    const groups = classifyIntoGroups(parseObj(obj).faces);
    const walls = groups.filter((g) => g.category.startsWith("wall"));
    expect(walls.length).toBe(1);
    expect(walls[0].faceIndices.length).toBe(1);
    // Neither the floor nor the ceiling is mistaken for a thin slab.
    expect(groups.every((g) => g.thickness == null)).toBe(true);
  });

  it("rejects a storey-height wall between two wide floor slabs (regression)", () => {
    // Simulates the friend's building bug: a wide multi-storey building (12m)
    // with a wall spanning from the ground-floor slab bottom (y=0, DOWN-facing)
    // to the upper-floor slab top (y=3, UP-facing). The wall shares edges with
    // both slabs. Without MAX_SLAB_THICKNESS, this would pass the bracket test
    // AND the plate ratio (3.0/12 = 0.25 was < old threshold 0.25).
    // With the fix: t=3.0 > MAX_SLAB_THICKNESS=1.0 → immediately rejected.
    const obj = `
v 0 0 0
v 12 0 0
v 12 0 8
v 0 0 8
v 0 3 0
v 12 3 0
v 12 3 8
v 0 3 8
f 1 2 3 4
f 8 7 6 5
f 1 2 6 5
`;
    // Face 1: bottom skin at y=0 (DOWN-facing, winding 1→2→3→4 from below)
    // Face 2: top skin at y=3 (UP-facing, winding 8→7→6→5 from above)
    // Face 3: wall from y=0 to y=3, sharing edges with both skins
    const groups = classifyIntoGroups(parseObj(obj).faces);
    const walls = groups.filter((g) => g.category.startsWith("wall"));
    expect(walls.length).toBe(1);
    expect(walls[0].faceIndices.length).toBe(1);
    // No slab thickness detected — the wall is NOT mistaken for a rim.
    expect(groups.every((g) => g.thickness == null)).toBe(true);
  });

  it("still detects a real slab even when the model also has storey-height walls", () => {
    // A model with BOTH: a thin ground-floor slab (0.2m) AND a 3m-tall wall.
    // The slab must be detected normally; the wall must stay a wall.
    // This tests per-piece fault isolation.
    const obj = `
${slabFaces(0, 0.2, 6, 6, 0)}
v 0 0.2 0
v 6 0.2 0
v 6 3.2 0
v 0 3.2 0
f 9 10 11 12
`;
    const groups = classifyIntoGroups(parseObj(obj).faces);
    const floors = groups.filter((g) => g.category === "floor");
    const walls = groups.filter((g) => g.category.startsWith("wall"));

    expect(floors.length).toBe(1);
    expect(floors[0].faceIndices.length).toBe(6); // slab (2 skins + 4 rims)
    expect(floors[0].thickness).toBeCloseTo(0.2, 3);
    expect(walls.length).toBe(1); // wall stays separate
  });
});
