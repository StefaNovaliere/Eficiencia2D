import { describe, expect, it } from "vitest";
import {
  claveHueco,
  claveNudo,
  esAvisoAberturasCerradas,
  focoDe,
  gruposDeClave,
  mismaSeleccion,
  parseVerificacion,
  tituloHueco,
  titularVerificacion,
} from "@/core/verificacion";
// Respuestas REALES del backend (demo.obj, 1:100).
import real from "./fixtures/verificacion-v2-demo.json";
import { warnings } from "./fixtures/verificacion-warnings-demo.json";

const v = parseVerificacion(real)!;

describe("huecos que quedan en la maqueta (§2.6)", () => {
  it("lee la lista y su cuenta, del más grande al más chico", () => {
    expect(v.resumen.huecos).toBe(2);
    expect(v.huecos.map((h) => h.piezas)).toEqual([
      ["A12", "B1"],
      ["A1", "A18"],
    ]);
    const h = v.huecos[0];
    expect(h).toMatchObject({
      id: 0,
      grupos: [245, 89],
      medidaCmEdificio: 27.7,
      medidaMm: 2.77,
      largoCmEdificio: 422.3,
    });
    expect(h.punto).toEqual({ x: 5.699, y: 0.432, z: 0.765 });
    // Textos listos para mostrar, tal cual.
    expect(h.texto).toMatch(/^A12 y B1 casi se tocan/);
    expect(h.pregunta).toMatch(/^¿Tienen que encontrarse\?/);
  });

  it("no cambian el veredicto ni el titular", () => {
    expect(v.veredicto).toBe("no_arma");
    expect(titularVerificacion(v)).not.toMatch(/hueco/i);
  });

  it("título corto para la lista y el visor", () => {
    expect(tituloHueco(v.huecos[0])).toBe("A12 · B1: hueco de 28 cm");
  });

  it("al abrirlo se ven sólo sus dos piezas, con la cámara en su punto", () => {
    expect(focoDe(v, claveHueco(0))).toEqual({
      clave: "h:0",
      titulo: "A12 · B1: hueco de 28 cm",
      piezas: ["A12", "B1"],
      punto: { x: 5.699, y: 0.432, z: 0.765 },
      uniones: [],
      soloEstas: true,
    });
    expect(focoDe(v, claveHueco(99))).toBeNull();
  });

  it("se vuelve a encontrar por sus grupos en otro reporte, aunque cambie su id", () => {
    const grupos = gruposDeClave(v, claveHueco(1))!;
    expect(grupos).toEqual([233, 192]);
    const otro = { ...v, huecos: [...v.huecos].reverse().map((h, i) => ({ ...h, id: 10 + i })) };
    expect(mismaSeleccion(otro, "h", grupos)).toBe("h:10");
    // Un hueco no se confunde con un nudo de las mismas piezas.
    expect(mismaSeleccion({ ...v, huecos: [] }, "h", grupos)).toBeNull();
  });

  it("los nudos se siguen encontrando igual", () => {
    expect(gruposDeClave(v, claveNudo(0))).toEqual([180, 182]);
    expect(mismaSeleccion(v, "n", [182, 180])).toBe("n:0");
    expect(gruposDeClave(v, "p:0")).toBeNull();
  });

  it("un backend sin huecos deja la lista vacía y la cuenta en 0", () => {
    const { huecos: _h, ...sinHuecos } = real as Record<string, unknown>;
    const resumen = { ...(real.resumen as Record<string, unknown>) };
    delete resumen.huecos;
    const viejo = parseVerificacion({ ...sinHuecos, resumen })!;
    expect(viejo.huecos).toEqual([]);
    expect(viejo.resumen.huecos).toBe(0);
  });
});

describe("aberturas que salen cerradas (§0.4)", () => {
  it("reconoce el aviso entre los warnings reales, y sólo ése", () => {
    const cerradas = warnings.filter(esAvisoAberturasCerradas);
    expect(cerradas).toHaveLength(1);
    expect(cerradas[0]).toMatch(/^5 abertura\(s\) salen CERRADAS/);
  });
});
