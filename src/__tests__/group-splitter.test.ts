import { describe, expect, it } from "vitest";
import type { Face3D } from "@/core/types";
import type { GeometryGroup } from "@/core/group-classifier";
import { splitGroupAtPanelBridges, splitGroupIntoConnectedComponents } from "@/core/group-splitter";

function wallQuad(x: number, y0: number, z0: number, y1: number, z1: number): Face3D {
  return {
    vertices: [
      { x, y: y0, z: z0 },
      { x, y: y0, z: z1 },
      { x, y: y1, z: z1 },
      { x, y: y1, z: z0 },
    ],
    normal: { x: 1, y: 0, z: 0 },
    innerLoops: [],
  };
}

function mockGroup(faceIndices: number[]): GeometryGroup {
  return {
    id: 1,
    label: "Pared Vertical - Norte #1",
    category: "wall",
    faceIndices,
    totalArea: 10,
    centroid: { x: 0, y: 1, z: 0 },
    orientation: "Vertical - Norte",
    representativeNormal: { x: 1, y: 0, z: 0 },
  };
}

describe("group-splitter", () => {
  it("no divide un panel único triangulado", () => {
    const face = wallQuad(0, 0, 0, 2, 2);
    const tri1: Face3D = {
      vertices: [face.vertices[0], face.vertices[1], face.vertices[2]],
      normal: face.normal,
      innerLoops: [],
    };
    const tri2: Face3D = {
      vertices: [face.vertices[0], face.vertices[2], face.vertices[3]],
      normal: face.normal,
      innerLoops: [],
    };
    const group = mockGroup([0, 1]);
    const { groups } = splitGroupAtPanelBridges([tri1, tri2], group, 2);
    expect(groups).toHaveLength(1);
  });

  it("no divide paneles coplanares conectados en un solo contorno", () => {
    const left = wallQuad(0, 0, 0, 2, 0.3);
    const right = wallQuad(0, 0, 0.3, 2, 1.5);
    const group = mockGroup([0, 1]);
    const { groups } = splitGroupAtPanelBridges([left, right], group, 2);
    expect(groups).toHaveLength(1);
    expect(groups[0].faceIndices).toEqual([0, 1]);
  });

  it("no divide paneles con alturas distintas que forman una sola pieza", () => {
    const tall = wallQuad(0, 0, 0, 3, 0.25);
    const short = wallQuad(0, 0, 0.25, 1.5, 0.8);
    const group = mockGroup([0, 1]);
    const { groups } = splitGroupAtPanelBridges([tall, short], group, 2);
    expect(groups).toHaveLength(1);
  });

  it("no divide una pared lisa en malla de rectángulos", () => {
    const faces: Face3D[] = [];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 4; col++) {
        faces.push(wallQuad(0, row, col * 0.5, row + 1, (col + 1) * 0.5));
      }
    }
    const group = mockGroup(faces.map((_, i) => i));
    const { groups } = splitGroupAtPanelBridges(faces, group, 2);
    expect(groups).toHaveLength(1);
    expect(groups[0].faceIndices).toHaveLength(12);
  });

  it("no divide una pared con ventana en piezas separadas", () => {
    // 4 piezas alrededor de un hueco rectangular (ventana).
    const left = wallQuad(0, 0.8, 0, 1.4, 0.8);
    const right = wallQuad(0, 0.8, 1.4, 1.4, 2.0);
    const bottom = wallQuad(0, 0, 0, 0.8, 2.0);
    const top = wallQuad(0, 1.4, 0, 3.0, 2.0);
    const group = mockGroup([0, 1, 2, 3]);
    const { groups } = splitGroupAtPanelBridges([left, right, bottom, top], group, 4);
    expect(groups).toHaveLength(1);
    expect(groups[0].faceIndices).toHaveLength(4);
  });

  it("divide islas de malla desconectadas en componentes", () => {
    const left = wallQuad(0, 0, 0, 2, 0.3);
    const right = wallQuad(0, 0, 0.5, 2, 1.5);
    const group = mockGroup([0, 1]);
    const { groups } = splitGroupIntoConnectedComponents([left, right], group, 2);
    expect(groups).toHaveLength(2);
  });
});
