// ============================================================================
// Verificación de la maqueta (`verificacion` de `/nesting-preview`).
//
// El backend mide cada unión entre piezas tal como van a la plancha y entrega
// UN veredicto. Reemplaza a `assembly_warnings`, que era un chequeo sobre el
// modelo y contradecía al de las piezas que se cortan.
//
// Tres estados de la respuesta, que la UI trata distinto:
//   - `undefined`: el backend no conoce la verificación (versión vieja). Se
//     sigue mostrando lo de antes.
//   - `null`:      el backend no pudo verificar. Gris: NUNCA verde.
//   - objeto:      el veredicto.
//
// Ver CONTRATO_verificacion.md.
// ============================================================================

import type { Vec3 } from "./types";

export type EstadoVerificacion = "ok" | "revisar" | "no_arma";
export type Veredicto = "listo" | "revisar" | "no_arma";
export type TipoProblema = "choque" | "luz" | "sin_cubrir" | "superpuestas" | "pieza_fina";

/**
 * Lo que una acción le cambia al estado de la revisión. Mismas claves que ya
 * viajan a `/recompute`, `/nesting-preview` y `/generate`: se guarda tal cual
 * llega (snake_case) para mandarlo de vuelta sin traducir.
 */
export interface AplicarAccion {
  merges?: number[][];
  overrides?: Record<string, string>;
  wall_wall_decisions_by_pair?: DecisionPorPar[];
}

export interface DecisionPorPar {
  group_a: number;
  group_b: number;
  yield_group_id: number;
}

export interface AccionProblema {
  /** `fusionar`, `descartar`, `invertir_cede`, `escala_mas_fina`, `revisar_modelo`… */
  tipo: string;
  etiqueta: string;
  /** `null`: la acción es informativa, no cambia nada. */
  aplicar: AplicarAccion | null;
}

export interface ProblemaVerificacion {
  id: number;
  tipo: TipoProblema | string;
  estado: EstadoVerificacion;
  titulo: string;
  detalle: string;
  cantidad: number;
  /** Milímetros de PLANCHA: lo que se ve en la mano. */
  peorMm: number;
  /** Lo mismo en centímetros de EDIFICIO: la cifra para quien corrige el modelo. */
  peorCmEdificio: number;
  piezas: string[];
  piezaComun: string | null;
  /** Dónde está, en el espacio de `faces_packed`. */
  punto: Vec3 | null;
  uniones: number[];
  acciones: AccionProblema[];
}

export interface UnionVerificacion {
  id: number;
  piezaA: string;
  piezaB: string;
  grupoA: number;
  grupoB: number;
  tipo: string;
  estado: EstadoVerificacion;
  medidaMm: number;
  medidaCmEdificio: number;
  largoM: number;
  prevista: boolean;
  piezaQueAjusta: string | null;
  punto: Vec3 | null;
  /** Los dos extremos del tramo, en coordenadas del mundo. */
  segmento: [Vec3, Vec3] | null;
}

export interface PiezaVerificacion {
  grupo: number;
  categoria: string;
  estado: EstadoVerificacion;
  uniones: number;
  problemas: number;
}

export interface ResumenVerificacion {
  piezas: number;
  piezasOk: number;
  piezasRevisar: number;
  piezasNoArma: number;
  uniones: number;
  unionesOk: number;
  unionesRevisar: number;
  unionesNoArma: number;
  problemas: number;
}

export interface Verificacion {
  version: number;
  escala: number;
  espesorPlacaMm: number;
  toleranciasMm: { ok: number; revisar: number };
  veredicto: Veredicto;
  resumen: ResumenVerificacion;
  /** Por etiqueta de pieza (la misma que `panel_id` en `placements`). */
  piezas: Map<string, PiezaVerificacion>;
  /** Ya vienen agrupados y ordenados: se muestran tal cual. */
  problemas: ProblemaVerificacion[];
  /** Por id. */
  uniones: Map<number, UnionVerificacion>;
}

// ---------------------------------------------------------------------------

type Rec = Record<string, unknown>;

function rec(v: unknown): Rec | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : null;
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : v == null ? fallback : String(v);
}

function vec(v: unknown): Vec3 | null {
  const o = rec(v);
  if (!o) return null;
  const x = Number(o.x);
  const y = Number(o.y);
  const z = Number(o.z);
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) ? { x, y, z } : null;
}

function estado(v: unknown): EstadoVerificacion {
  return v === "ok" || v === "revisar" || v === "no_arma" ? v : "revisar";
}

function veredicto(v: unknown): Veredicto {
  return v === "listo" || v === "revisar" || v === "no_arma" ? v : "revisar";
}

function aplicar(v: unknown): AplicarAccion | null {
  const o = rec(v);
  if (!o) return null;
  const out: AplicarAccion = {};
  if (Array.isArray(o.merges)) {
    out.merges = o.merges
      .filter(Array.isArray)
      .map((m) => (m as unknown[]).map((x) => Number(x)).filter(Number.isFinite));
  }
  const ov = rec(o.overrides);
  if (ov) {
    out.overrides = Object.fromEntries(Object.entries(ov).map(([k, c]) => [k, str(c)]));
  }
  if (Array.isArray(o.wall_wall_decisions_by_pair)) {
    out.wall_wall_decisions_by_pair = o.wall_wall_decisions_by_pair
      .map(rec)
      .filter((d): d is Rec => d !== null)
      .map((d) => ({
        group_a: num(d.group_a, NaN),
        group_b: num(d.group_b, NaN),
        yield_group_id: num(d.yield_group_id, NaN),
      }))
      .filter((d) => [d.group_a, d.group_b, d.yield_group_id].every(Number.isFinite));
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Parsea `verificacion` tal como llega (snake_case). Devuelve `undefined` si
 * la clave no vino, `null` si vino en null o no se pudo leer — en ningún caso
 * se inventa un veredicto.
 */
export function parseVerificacion(raw: unknown): Verificacion | null | undefined {
  if (raw === undefined) return undefined;
  const o = rec(raw);
  if (!o) return null;
  const r = rec(o.resumen);
  if (!r) return null;

  const piezas = new Map<string, PiezaVerificacion>();
  for (const [label, val] of Object.entries(rec(o.piezas) ?? {})) {
    const p = rec(val);
    if (!p) continue;
    piezas.set(label, {
      grupo: num(p.grupo, NaN),
      categoria: str(p.categoria),
      estado: estado(p.estado),
      uniones: num(p.uniones),
      problemas: num(p.problemas),
    });
  }

  const problemas: ProblemaVerificacion[] = (Array.isArray(o.problemas) ? o.problemas : [])
    .map(rec)
    .filter((p): p is Rec => p !== null)
    .map((p, i) => ({
      id: num(p.id, i),
      tipo: str(p.tipo),
      estado: estado(p.estado),
      titulo: str(p.titulo),
      detalle: str(p.detalle),
      cantidad: num(p.cantidad, 1),
      peorMm: num(p.peor_mm),
      peorCmEdificio: num(p.peor_cm_edificio),
      piezas: Array.isArray(p.piezas) ? p.piezas.map((x) => str(x)) : [],
      piezaComun: p.pieza_comun == null ? null : str(p.pieza_comun),
      punto: vec(p.punto),
      uniones: Array.isArray(p.uniones) ? p.uniones.map((x) => num(x, NaN)).filter(Number.isFinite) : [],
      acciones: (Array.isArray(p.acciones) ? p.acciones : [])
        .map(rec)
        .filter((a): a is Rec => a !== null)
        .map((a) => ({ tipo: str(a.tipo), etiqueta: str(a.etiqueta), aplicar: aplicar(a.aplicar) })),
    }));

  const uniones = new Map<number, UnionVerificacion>();
  for (const val of Array.isArray(o.uniones) ? o.uniones : []) {
    const u = rec(val);
    if (!u) continue;
    const id = num(u.id, NaN);
    if (!Number.isFinite(id)) continue;
    const seg = Array.isArray(u.segmento) ? u.segmento.map(vec) : [];
    uniones.set(id, {
      id,
      piezaA: str(u.pieza_a),
      piezaB: str(u.pieza_b),
      grupoA: num(u.grupo_a, NaN),
      grupoB: num(u.grupo_b, NaN),
      tipo: str(u.tipo),
      estado: estado(u.estado),
      medidaMm: num(u.medida_mm),
      medidaCmEdificio: num(u.medida_cm_edificio),
      largoM: num(u.largo_m),
      prevista: u.prevista === true,
      piezaQueAjusta: u.pieza_que_ajusta == null ? null : str(u.pieza_que_ajusta),
      punto: vec(u.punto),
      segmento: seg.length === 2 && seg[0] && seg[1] ? [seg[0], seg[1]] : null,
    });
  }

  const tol = rec(o.tolerancias_mm);
  return {
    version: num(o.version, 1),
    escala: num(o.escala),
    espesorPlacaMm: num(o.espesor_placa_mm),
    toleranciasMm: { ok: num(tol?.ok, 0.2), revisar: num(tol?.revisar, 0.75) },
    veredicto: veredicto(o.veredicto),
    resumen: {
      piezas: num(r.piezas),
      piezasOk: num(r.piezas_ok),
      piezasRevisar: num(r.piezas_revisar),
      piezasNoArma: num(r.piezas_no_arma),
      uniones: num(r.uniones),
      unionesOk: num(r.uniones_ok),
      unionesRevisar: num(r.uniones_revisar),
      unionesNoArma: num(r.uniones_no_arma),
      problemas: num(r.problemas),
    },
    piezas,
    problemas,
    uniones,
  };
}

/** `287 de 295 piezas verificadas · 8 para revisar` — el titular del contrato. */
export function titularVerificacion(v: Verificacion): string {
  const { piezas, piezasOk } = v.resumen;
  const pendientes = Math.max(piezas - piezasOk, 0);
  return pendientes > 0
    ? `${piezasOk} de ${piezas} piezas verificadas · ${pendientes} para revisar`
    : `${piezas} de ${piezas} piezas verificadas`;
}

/** `1.4 mm · 14 cm de edificio`. */
export function medidaProblema(p: Pick<ProblemaVerificacion, "peorMm" | "peorCmEdificio">): string {
  const mm = p.peorMm.toLocaleString("es-AR", { maximumFractionDigits: 1 });
  const cm = p.peorCmEdificio.toLocaleString("es-AR", { maximumFractionDigits: 0 });
  return p.peorCmEdificio > 0 ? `${mm} mm · ${cm} cm de edificio` : `${mm} mm`;
}

/** Segmentos de las uniones de un problema, para dibujarlos en el visor. */
export function segmentosDeProblema(
  v: Verificacion,
  p: ProblemaVerificacion,
): Array<{ a: Vec3; b: Vec3; estado: EstadoVerificacion }> {
  const out: Array<{ a: Vec3; b: Vec3; estado: EstadoVerificacion }> = [];
  for (const id of p.uniones) {
    const u = v.uniones.get(id);
    if (u?.segmento) out.push({ a: u.segmento[0], b: u.segmento[1], estado: u.estado });
  }
  return out;
}
