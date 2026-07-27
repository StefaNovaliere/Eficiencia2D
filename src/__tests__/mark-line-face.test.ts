import { describe, it, expect } from "vitest";
import { computeMarkLines3D } from "@/core/mark-preview";
import type { MarkLine } from "@/core/mark-lines";
import type { Face3D } from "@/core/types";
import type { GeometryGroup } from "@/core/group-classifier";

/**
 * Una marca roja debe dibujarse sobre la CARA que el usuario clickeó. Antes se
 * anclaba siempre a la normal representativa del grupo, así que una marca hecha
 * en la cara interior aparecía en la exterior.
 */

// Pared vertical en el plano z=0, normal +Z.
const wall: Face3D = {
  vertices: [
    { x: 0, y: 0, z: 0 },
    { x: 4, y: 0, z: 0 },
    { x: 4, y: 3, z: 0 },
    { x: 0, y: 3, z: 0 },
  ],
  normal: { x: 0, y: 0, z: 1 },
} as Face3D;

const group = {
  id: 1,
  label: "Pared",
  category: "wall",
  faceIndices: [0],
  totalArea: 12,
  centroid: { x: 2, y: 1.5, z: 0 },
  orientation: "N",
  representativeNormal: { x: 0, y: 0, z: 1 },
} as unknown as GeometryGroup;

const line = (surfaceNormal?: { x: number; y: number; z: number }): MarkLine => ({
  id: "mkl-1",
  groupId: 1,
  points: [
    { u: 1, v: 1 },
    { u: 2, v: 1 },
  ],
  ...(surfaceNormal ? { surfaceNormal } : {}),
});

describe("computeMarkLines3D — cara de la marca", () => {
  it("sin cara guardada usa la normal del grupo (comportamiento previo)", () => {
    const out = computeMarkLines3D([wall], [group], [line()], "Y");
    expect(out).toHaveLength(1);
    expect(out[0].normal.z).toBeCloseTo(1, 5);
    // El trazo se separa hacia +Z.
    expect(out[0].segments[0].a.z).toBeGreaterThan(0);
  });

  it("marcando la cara FRONTAL (+Z) dibuja del lado +Z", () => {
    const out = computeMarkLines3D([wall], [group], [line({ x: 0, y: 0, z: 1 })], "Y");
    expect(out[0].normal.z).toBeCloseTo(1, 5);
    expect(out[0].segments[0].a.z).toBeGreaterThan(0);
  });

  it("marcando la cara TRASERA (−Z) dibuja del lado −Z, no del opuesto", () => {
    const out = computeMarkLines3D([wall], [group], [line({ x: 0, y: 0, z: -1 })], "Y");
    expect(out[0].normal.z).toBeCloseTo(-1, 5);
    // Regresión: antes esto daba > 0 (se dibujaba en la cara equivocada).
    expect(out[0].segments[0].a.z).toBeLessThan(0);
  });

  it("dos marcas en caras opuestas salen en grupos separados", () => {
    const front = { ...line({ x: 0, y: 0, z: 1 }), id: "mkl-front" };
    const back = { ...line({ x: 0, y: 0, z: -1 }), id: "mkl-back" };
    const out = computeMarkLines3D([wall], [group], [front, back], "Y");
    expect(out).toHaveLength(2);
    const normals = out.map((o) => Math.sign(o.normal.z)).sort();
    expect(normals).toEqual([-1, 1]);
  });
});
