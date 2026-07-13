import { describe, it, expect } from "vitest";
import {
  simplifyPolyline,
  markLineLengthM,
  serializeMarkLinesForApi,
  parseMarkLinesFromApi,
  upsertMarkLine,
  removeMarkLine,
  rectPoints,
  circlePoints,
  MIN_MARK_LINE_M,
  MARK_CIRCLE_SEGMENTS,
  type MarkLine,
} from "@/core/mark-lines";

describe("formas de líneas rojas (rect / circle)", () => {
  it("rectPoints: 5 puntos, cerrado, cubre el bbox", () => {
    const p = rectPoints(0, 0, 2, 1);
    expect(p).toHaveLength(5);
    expect(p[0]).toEqual(p[4]);
    expect(p[2]).toEqual({ u: 2, v: 1 });
  });

  it("circlePoints: segments+1 puntos, cerrado e inscrito en el bbox", () => {
    const p = circlePoints(0, 0, 2, 2, 8);
    expect(p).toHaveLength(9);
    expect(p[0].u).toBeCloseTo(p[8].u, 9);
    expect(p[0].v).toBeCloseTo(p[8].v, 9);
    for (const q of p) expect(Math.hypot(q.u - 1, q.v - 1)).toBeCloseTo(1, 6);
  });

  it("circlePoints default usa MARK_CIRCLE_SEGMENTS", () => {
    expect(circlePoints(0, 0, 1, 1)).toHaveLength(MARK_CIRCLE_SEGMENTS + 1);
  });
});

const LINE: MarkLine = {
  id: "mkl-1",
  groupId: 5,
  points: [
    { u: 0, v: 0 },
    { u: 1, v: 0 },
  ],
};

describe("markLineLengthM", () => {
  it("suma los segmentos", () => {
    expect(markLineLengthM(LINE.points)).toBeCloseTo(1, 5);
    expect(markLineLengthM([{ u: 0, v: 0 }, { u: 3, v: 0 }, { u: 3, v: 4 }])).toBeCloseTo(7, 5);
  });
  it("MIN es 2 cm", () => {
    expect(MIN_MARK_LINE_M).toBe(0.02);
  });
});

describe("simplifyPolyline (RDP)", () => {
  it("colapsa puntos casi colineales a los extremos", () => {
    const pts = [
      { u: 0, v: 0 },
      { u: 0.5, v: 0.0005 }, // ruido < tol
      { u: 1, v: 0 },
    ];
    expect(simplifyPolyline(pts, 0.002)).toEqual([{ u: 0, v: 0 }, { u: 1, v: 0 }]);
  });
  it("conserva un vértice real (esquina)", () => {
    const pts = [
      { u: 0, v: 0 },
      { u: 1, v: 1 }, // esquina lejos de la recta 0,0→2,0
      { u: 2, v: 0 },
    ];
    expect(simplifyPolyline(pts, 0.002).length).toBe(3);
  });
  it("no toca líneas de 2 puntos", () => {
    expect(simplifyPolyline(LINE.points, 0.002)).toEqual(LINE.points);
  });
});

describe("serialize / parse round-trip", () => {
  it("mantiene group_id y puntos [u,v]", () => {
    const wire = serializeMarkLinesForApi([LINE]);
    expect(wire[0]).toMatchObject({ id: "mkl-1", group_id: 5, points: [[0, 0], [1, 0]] });
    const back = parseMarkLinesFromApi(wire);
    expect(back[0]).toMatchObject({ id: "mkl-1", groupId: 5 });
    expect(back[0].points).toEqual(LINE.points);
  });
  it("descarta entradas inválidas (sin group_id, <2 puntos)", () => {
    expect(parseMarkLinesFromApi([{ points: [[0, 0], [1, 1]] }])).toEqual([]);
    expect(parseMarkLinesFromApi([{ group_id: 1, points: [[0, 0]] }])).toEqual([]);
  });
});

describe("upsert / remove", () => {
  it("reemplaza por id y borra", () => {
    let lines: MarkLine[] = [];
    lines = upsertMarkLine(lines, LINE);
    lines = upsertMarkLine(lines, { ...LINE, groupId: 9 });
    expect(lines).toHaveLength(1);
    expect(lines[0].groupId).toBe(9);
    lines = removeMarkLine(lines, "mkl-1");
    expect(lines).toHaveLength(0);
  });
});
