import { describe, expect, it } from "vitest";
import {
  aplicarDecisionesPorPar,
  decisionesPorPar,
  remapearDecisiones,
} from "@/core/decisiones-por-par";
import type { WallWallJoint } from "@/core/assembly-adjuster";

const junta = (jointIndex: number, groupA: number, groupB: number): WallWallJoint =>
  ({ jointIndex, groupA, groupB }) as WallWallJoint;

describe("decisionesPorPar", () => {
  it("expresa cada decisión con los dos grupos de su junta", () => {
    const juntas = [junta(0, 10, 20), junta(1, 20, 30)];
    expect(decisionesPorPar(new Map([[1, 30]]), juntas)).toEqual([
      { group_a: 20, group_b: 30, yield_group_id: 30 },
    ]);
  });

  it("no inventa pares para decisiones inconsistentes", () => {
    const juntas = [junta(0, 10, 20)];
    // índice que no existe, y un grupo que no es de esa junta
    expect(decisionesPorPar(new Map([[5, 10], [0, 99]]), juntas)).toEqual([]);
  });
});

describe("remapearDecisiones", () => {
  /**
   * El caso que rompía todo: una fusión re-deriva la lista de juntas y los
   * índices se corren. La decisión tiene que seguir a su par de grupos.
   */
  it("una decisión sigue a su par cuando los índices se corren", () => {
    const viejas = [junta(0, 10, 20), junta(1, 20, 30), junta(2, 30, 40)];
    // La junta 10-20 desapareció (fusión): todo se corre un lugar.
    const nuevas = [junta(0, 20, 30), junta(1, 30, 40)];
    const antes = new Map([
      [1, 30], // en 20-30 cede 30
      [2, 40], // en 30-40 cede 40
    ]);
    expect(remapearDecisiones(antes, viejas, nuevas)).toEqual(
      new Map([
        [0, 30],
        [1, 40],
      ]),
    );
  });

  it("el orden de los grupos en la junta no importa", () => {
    const viejas = [junta(0, 10, 20)];
    const nuevas = [junta(3, 20, 10)];
    expect(remapearDecisiones(new Map([[0, 10]]), viejas, nuevas)).toEqual(new Map([[3, 10]]));
  });

  it("se pierden sólo las decisiones cuya junta ya no existe", () => {
    const viejas = [junta(0, 10, 20), junta(1, 20, 30)];
    const nuevas = [junta(0, 20, 30)];
    expect(remapearDecisiones(new Map([[0, 10], [1, 20]]), viejas, nuevas)).toEqual(
      new Map([[0, 20]]),
    );
  });
});

describe("aplicarDecisionesPorPar", () => {
  it("traduce la acción `invertir_cede` al índice actual", () => {
    const juntas = [junta(0, 232, 235), junta(1, 213, 233)];
    const { decisiones, sinJunta } = aplicarDecisionesPorPar(new Map([[0, 232]]), juntas, [
      { group_a: 235, group_b: 232, yield_group_id: 235 },
    ]);
    expect(decisiones).toEqual(new Map([[0, 235]]));
    expect(sinJunta).toEqual([]);
  });

  it("devuelve aparte las que no tienen junta, para mandarlas por par", () => {
    const { sinJunta } = aplicarDecisionesPorPar(new Map(), [junta(0, 1, 2)], [
      { group_a: 7, group_b: 8, yield_group_id: 8 },
    ]);
    expect(sinJunta).toHaveLength(1);
  });
});
