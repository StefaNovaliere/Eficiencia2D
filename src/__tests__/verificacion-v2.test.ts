import { describe, expect, it } from "vitest";
import {
  claveNudo,
  claveProblema,
  focoDe,
  mismoNudo,
  parseVerificacion,
  problemasSinNudo,
  segmentosDeProblema,
  titularVerificacion,
} from "@/core/verificacion";
// Recorte de una respuesta REAL v2 de /nesting-preview (demo.obj, 1:100).
import real from "./fixtures/verificacion-v2-demo.json";
import realV1 from "./fixtures/verificacion-demo.json";

const v = parseVerificacion(real)!;

describe("verificación v2", () => {
  it("lee nudos, terminaciones y decisiones automáticas", () => {
    expect(v.version).toBe(2);
    expect(v.nudos.map((n) => n.quien)).toEqual(["decidir", "modelo"]);
    expect(v.terminaciones[0].tipo).toBe("sin_cubrir");
    expect(v.terminaciones[0].estado).toBe("ok");
    expect(v.decisionesAutomaticas.length).toBe(10);
    expect(v.resumen.resueltasSolas).toBe(10);
    expect(v.resumen.nudosPorQuien).toEqual({ decidir: 2, escala: 0, modelo: 4 });
  });

  it("lee el detalle 2D tal como viene", () => {
    const d = v.nudos[0].detalle!;
    expect(d.vista).toBe("planta");
    expect(d.ventanaM).toBe(1.5);
    expect(d.placas.map((p) => p.pieza).sort()).toEqual(["A14", "A9"]);
    expect(d.solapes).toHaveLength(1);
    // La medida de la cota es la de la unión: se muestra tal cual.
    expect(d.cotas[0].texto).toBe("2.9 mm");
  });

  it("titular de la v2", () => {
    expect(titularVerificacion(v)).toBe(
      "15 de 29 piezas verificadas · 6 lugares para mirar (2 para decidir) · 10 uniones resueltas automáticamente · 10 avisos de terminación",
    );
  });

  it("la v1 sigue con su titular", () => {
    expect(titularVerificacion(parseVerificacion(realV1)!)).toBe(
      "9 de 32 piezas verificadas · 23 para revisar",
    );
  });

  /**
   * `pieza_fina` no es de un lugar: ningún nudo la cita y sólo viene en
   * `problemas`. Si la lista mostrara sólo nudos, desaparecería.
   */
  it("encuentra los problemas que no están en ningún nudo", () => {
    expect(problemasSinNudo(v).map((p) => p.tipo)).toEqual(["pieza_fina"]);
    expect(problemasSinNudo(v)[0].quien).toBe("escala");
    expect(problemasSinNudo(v)[0].escalaSugerida).toBe(75);
  });

  it("un nudo muestra sólo sus piezas; un problema atenúa el resto", () => {
    const n = focoDe(v, claveNudo(0))!;
    expect(n.soloEstas).toBe(true);
    expect(n.piezas).toEqual(["A9", "A14"]);
    expect(segmentosDeProblema(v, n)).toHaveLength(1);
    expect(focoDe(v, claveProblema(4))!.soloEstas).toBe(false);
    expect(focoDe(v, null)).toBeNull();
    expect(focoDe(v, claveNudo(999))).toBeNull();
  });

  it("`cambiar_escala` puede traer la escala en `aplicar`", () => {
    const pf = v.problemas.find((p) => p.tipo === "pieza_fina")!;
    const a = pf.acciones.find((x) => x.tipo === "cambiar_escala")!;
    expect(a.aplicar).toEqual({ scale_denom: 75 });
  });
  describe("identidad de un nudo por sus grupos (§2.2)", () => {
    it("lee los grupos de cada nudo", () => {
      expect(v.nudos.map((n) => n.grupos)).toEqual([
        [180, 182],
        [180, 245],
      ]);
    });

    it("encuentra el mismo nudo aunque haya cambiado de id y de orden de grupos", () => {
      const renumerado = {
        ...v,
        nudos: v.nudos.map((n, i) => ({ ...n, id: 10 + i, grupos: [...n.grupos].reverse() })),
      };
      expect(mismoNudo(renumerado, [180, 182])?.id).toBe(10);
      expect(mismoNudo(renumerado, [245, 180])?.id).toBe(11);
    });

    it("un nudo que ya no está no se confunde con otro", () => {
      expect(mismoNudo(v, [180])).toBeNull();
      expect(mismoNudo(v, [180, 182, 245])).toBeNull();
      expect(mismoNudo(v, [])).toBeNull();
    });

    it("un backend sin grupos no deja seleccionar por grupos", () => {
      const sinGrupos = parseVerificacion({
        ...real,
        nudos: (real as { nudos: object[] }).nudos.map((n) => ({ ...n, grupos: undefined })),
      })!;
      expect(sinGrupos.nudos.every((n) => n.grupos.length === 0)).toBe(true);
      expect(mismoNudo(sinGrupos, [])).toBeNull();
    });
  });
});
