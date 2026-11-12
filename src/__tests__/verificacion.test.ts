import { describe, expect, it } from "vitest";
import {
  medidaProblema,
  parseVerificacion,
  segmentosDeProblema,
  titularVerificacion,
} from "@/core/verificacion";
// Recorte de una respuesta REAL de /nesting-preview (demo.obj, 1:100).
import real from "./fixtures/verificacion-demo.json";

describe("parseVerificacion", () => {
  /**
   * Tres casos que la UI trata distinto. Confundir "no vino" con "no se pudo
   * verificar" mostraría la lista vieja de avisos, o peor, un verde que nadie
   * comprobó.
   */
  it("distingue ausente, null y objeto", () => {
    expect(parseVerificacion(undefined)).toBeUndefined();
    expect(parseVerificacion(null)).toBeNull();
    expect(parseVerificacion({ veredicto: "listo" })).toBeNull(); // sin resumen: no se inventa
    expect(parseVerificacion(real)).not.toBeNull();
  });

  it("lee la respuesta real del backend", () => {
    const v = parseVerificacion(real)!;
    expect(v.veredicto).toBe("no_arma");
    expect(v.escala).toBe(100);
    expect(v.resumen.piezas).toBe(32);
    expect(v.toleranciasMm).toEqual({ ok: 0.2, revisar: 0.75 });

    const a11 = v.piezas.get("A11")!;
    expect(a11.grupo).toBe(179);
    expect(a11.estado).toBe("no_arma");

    const sup = v.problemas.find((p) => p.tipo === "superpuestas")!;
    expect(sup.piezas).toEqual(["A11", "A22"]);
    expect(sup.peorMm).toBeCloseTo(1.45);
    expect(sup.peorCmEdificio).toBeCloseTo(14.5);
    expect(sup.punto).not.toBeNull();
  });

  /**
   * `aplicar` se le devuelve al backend tal cual: si se camelizara,
   * `wall_wall_decisions_by_pair` llegaría como una clave que nadie lee.
   */
  it("conserva `aplicar` en snake_case, listo para mandarlo de vuelta", () => {
    const v = parseVerificacion(real)!;
    const acciones = v.problemas.flatMap((p) => p.acciones);
    expect(acciones.find((a) => a.tipo === "fusionar")?.aplicar).toEqual({ merges: [[179, 211]] });
    expect(acciones.find((a) => a.tipo === "descartar")?.aplicar?.overrides).toBeDefined();
    const inv = acciones.find((a) => a.tipo === "invertir_cede")!;
    expect(inv.aplicar?.wall_wall_decisions_by_pair?.[0]).toHaveProperty("yield_group_id");
    // Las informativas no traen nada que aplicar.
    expect(acciones.find((a) => a.tipo === "escala_mas_fina")?.aplicar).toBeNull();
  });

  it("arma los segmentos de las uniones de un problema", () => {
    const v = parseVerificacion(real)!;
    const sup = v.problemas.find((p) => p.tipo === "superpuestas")!;
    const segs = segmentosDeProblema(v, sup);
    expect(segs).toHaveLength(sup.uniones.length);
    expect(segs[0].estado).toBe("no_arma");
  });
});

describe("textos", () => {
  it("titular del contrato", () => {
    const v = parseVerificacion(real)!;
    expect(titularVerificacion(v)).toBe("9 de 32 piezas verificadas · 23 para revisar");
  });

  it("titular sin pendientes", () => {
    const v = parseVerificacion({
      ...real,
      veredicto: "listo",
      resumen: { ...real.resumen, piezas: 5, piezas_ok: 5 },
    })!;
    expect(titularVerificacion(v)).toBe("5 de 5 piezas verificadas");
  });

  it("medida en plancha y en edificio", () => {
    expect(medidaProblema({ peorMm: 1.45, peorCmEdificio: 14.5 })).toBe("1,5 mm · 15 cm de edificio");
    expect(medidaProblema({ peorMm: 2, peorCmEdificio: 0 })).toBe("2 mm");
  });
});
