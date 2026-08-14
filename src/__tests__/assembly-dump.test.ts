import { describe, expect, it } from "vitest";
import {
  buildAssemblyDump,
  checkCoplanarity,
  cornerHits,
  trianglesAreaM2,
  type Frame,
} from "@/core/assembly-dump";
import type { AssemblySequencePiece } from "@/core/assembly-sequence";
import type { NestingPlacement } from "@/core/final-pieces";

/** Muro de 4 × 3 m en el plano XY, normal +Z. */
const marco: Frame = {
  origin: { x: 0, y: 0, z: 2 },
  uAxis: { x: 1, y: 0, z: 0 },
  vAxis: { x: 0, y: 1, z: 0 },
  normal: { x: 0, y: 0, z: 1 },
};

describe("checkCoplanarity", () => {
  it("con un marco ortonormal las cuatro esquinas caen en el mismo plano", () => {
    const c = checkCoplanarity(marco, 4, 3);
    expect(c.ok).toBe(true);
    expect(c.spreadM).toBeLessThan(1e-9);
    for (const d of c.dots) expect(d).toBeCloseTo(2, 9);
  });

  /**
   * Es la comprobación que separa "el front mapea mal" de "el marco no
   * corresponde a la pieza": el front aplica la fórmula del contrato literal,
   * así que un spread grande sólo puede venir de los ejes.
   */
  it("detecta un marco cuyos ejes no están en el plano de la normal", () => {
    const torcido: Frame = { ...marco, vAxis: { x: 0, y: 1, z: 0.5 } };
    const c = checkCoplanarity(torcido, 4, 3);
    expect(c.ok).toBe(false);
    expect(c.spreadM).toBeCloseTo(1.5, 6);
  });
});

describe("trianglesAreaM2", () => {
  it("suma el área de cada triángulo", () => {
    // Dos triángulos que forman un cuadrado de 1 m².
    const positions = [
      0, 0, 0, 1, 0, 0, 1, 1, 0,
      0, 0, 0, 1, 1, 0, 0, 1, 0,
    ];
    expect(trianglesAreaM2(positions)).toBeCloseTo(1, 9);
  });

  it("sin triángulos da cero", () => {
    expect(trianglesAreaM2([])).toBe(0);
  });

  /**
   * El caso del faldón: la caja que lo contiene tiene el doble de superficie.
   * Si el ratio contra `area_m2` da ~2, se está dibujando el rectángulo.
   */
  it("un triángulo da la mitad que su rectángulo", () => {
    const faldon = [0, 0, 0, 4, 0, 0, 4, 3, 0];
    expect(trianglesAreaM2(faldon)).toBeCloseTo(6, 9);
  });
});

describe("cornerHits", () => {
  const vecina = {
    label: "A2",
    // Muro perpendicular en x = 4, desplazado media placa (9 mm).
    frame: {
      origin: { x: 4.009, y: 0, z: 0 },
      uAxis: { x: 0, y: 0, z: 1 },
      vAxis: { x: 0, y: 1, z: 0 },
      normal: { x: 1, y: 0, z: 0 },
    },
    widthM: 4,
    heightM: 3,
  };

  it("mide la esquina contra el plano medio de la vecina que la contiene", () => {
    const hits = cornerHits(marco, 4, 3, [vecina]);
    // Esquinas 1 y 2 son las del borde x = 4; caen a −9 mm del plano de A2.
    expect(hits[1][0].vecina).toBe("A2");
    expect(hits[1][0].distanciaM).toBeCloseTo(-0.009, 9);
    expect(hits[2][0].distanciaM).toBeCloseTo(-0.009, 9);
  });

  /**
   * Sin el filtro de "cae dentro del rectángulo", el plano infinito de
   * cualquier pared lejana pasa cerca de cualquier punto y el número no sirve.
   */
  it("ignora vecinas cuyo rectángulo no contiene la esquina", () => {
    const lejana = { ...vecina, label: "A9", widthM: 0.2, heightM: 0.2 };
    expect(cornerHits(marco, 4, 3, [lejana])[1]).toHaveLength(0);
  });
});

describe("buildAssemblyDump", () => {
  function pieza(over: Partial<AssemblySequencePiece> = {}): AssemblySequencePiece {
    return {
      id: "A1",
      stepIndex: 0,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      normal: { x: 0, y: 0, z: 1 },
      width_m: 4,
      height_m: 3,
      depth_m: 0.018,
      category: "wall",
      ...over,
    };
  }

  const placement: NestingPlacement = {
    panelId: "A1",
    origin: marco.origin,
    uAxis: marco.uAxis,
    vAxis: marco.vAxis,
    normal: marco.normal,
    widthM: 4,
    heightM: 3,
    mirrored: false,
    areaM2: 12,
  };

  /**
   * Es el dato que más pidió el backend: el reparto por fuente dice si el visor
   * dibujó los contornos recortados o cayó a la malla cruda del modelo.
   */
  it("cuenta el reparto por fuente sobre TODAS las piezas, no sólo las filtradas", () => {
    const dump = buildAssemblyDump(
      [
        pieza({ id: "A1", liftSource: "outline" }),
        pieza({ id: "A2", liftSource: "faces" }),
        pieza({ id: "A3", liftSource: "box" }),
      ],
      { labelToGroupId: new Map() },
      "A1",
    );
    expect(dump.porFuente).toMatchObject({ outline: 1, faces: 1, box: 1 });
    expect(dump.total).toBe(3);
    expect(dump.piezas).toHaveLength(1);
    expect(dump.piezas[0].panelId).toBe("A1");
  });

  it("una pieza sin liftSource cuenta como caja", () => {
    const dump = buildAssemblyDump([pieza()], { labelToGroupId: new Map() }, "*");
    expect(dump.porFuente.box).toBe(1);
    expect(dump.piezas[0].fuente).toBe("box");
  });

  it("cruza el placement del grupo y calcula las comprobaciones", () => {
    const dump = buildAssemblyDump(
      [
        pieza({
          liftSource: "outline",
          depthFromBackend: true,
          lifted: {
            positions: [0, 0, 2, 4, 0, 2, 4, 3, 2, 0, 0, 2, 4, 3, 2, 0, 3, 2],
            openings: [],
            hasHoles: false,
          },
        }),
      ],
      {
        labelToGroupId: new Map([["A1", 7]]),
        placementByGroupId: new Map([[7, placement]]),
      },
      "A1",
    );

    const p = dump.piezas[0];
    expect(p.groupId).toBe(7);
    expect(p.triangulos).toBe(2);
    expect(p.espesorDelBackend).toBe(true);
    expect(p.coplanaridad?.ok).toBe(true);
    expect(p.areaDibujadaM2).toBeCloseTo(12, 6);
    expect(p.areaDeclaradaM2).toBe(12);
  });

  it("sin placement no inventa comprobaciones", () => {
    const dump = buildAssemblyDump(
      [pieza({ liftSource: "faces" })],
      { labelToGroupId: new Map([["A1", 7]]) },
      "*",
    );
    expect(dump.piezas[0].placement).toBeNull();
    expect(dump.piezas[0].coplanaridad).toBeNull();
    expect(dump.piezas[0].esquinas).toBeNull();
  });
});
