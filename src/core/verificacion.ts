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
 * Quién arregla un nudo (v2): `decidir` = hay una acción del usuario que cambia
 * el resultado; `escala` = sale de cuánto edificio ocupa la placa; `modelo` =
 * el backend probó lo que podía y no cierra.
 */
export type Quien = "decidir" | "escala" | "modelo";

/**
 * Lo que una acción le cambia al estado de la revisión. Mismas claves que ya
 * viajan a `/recompute`, `/nesting-preview` y `/generate`: se guarda tal cual
 * llega (snake_case) para mandarlo de vuelta sin traducir.
 */
export interface AplicarAccion {
  /** v2: cambiar la escala de la revisión a este valor. */
  scale_denom?: number;
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
  /** `fusionar`, `descartar`, `invertir_cede`, `cambiar_escala`, `revisar_modelo`… (v1: `escala_mas_fina`) */
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
  /** v2. `null` en las terminaciones y en respuestas v1. */
  quien: Quien | null;
  quienTexto: string | null;
  /** v2: escala a la que este problema deja de existir (sale de una cuenta, no se probó). */
  escalaSugerida: number | null;
}

/** Una placa en el dibujo 2D de un nudo. Coordenadas `[a, b]` en metros de edificio. */
export interface PlacaDetalle {
  pieza: string;
  grupo: number;
  /** `contexto` = vecina sin problema en este nudo: va en gris. */
  estado: EstadoVerificacion | "contexto";
  poligono: Array<[number, number]>;
  /** Dónde rotular: el backend ya lo corre si dos placas caerían en el mismo punto. */
  centro: [number, number];
}

export interface CotaDetalle {
  union: number;
  tipo: string;
  piezas: string[];
  mm: number;
  cmEdificio: number;
  /** Medición exacta de la unión: NO recalcular a partir de `desde`/`hasta`. */
  texto: string;
  desde: [number, number];
  hasta: [number, number];
}

/** Corte de las placas alrededor de un nudo, para dibujar en 2D (v2 §2.2.1). */
export interface DetalleNudo {
  vista: "planta" | "corte";
  /** El dibujo va de -ventanaM a +ventanaM en los dos ejes. */
  ventanaM: number;
  espesorM: number;
  ejes: { a: Vec3; b: Vec3 };
  placas: PlacaDetalle[];
  solapes: Array<{ piezas: string[]; poligono: Array<[number, number]> }>;
  cotas: CotaDetalle[];
}

/** Un LUGAR donde algo falla: una esquina, una T, un apoyo (v2 §2.2). */
export interface NudoVerificacion {
  id: number;
  estado: EstadoVerificacion;
  quien: Quien;
  quienTexto: string;
  titulo: string;
  tipos: string[];
  peorMm: number;
  peorCmEdificio: number;
  /** Las piezas con problema acá: al abrir el nudo se muestran SÓLO éstas. */
  piezas: string[];
  punto: Vec3 | null;
  uniones: number[];
  /** Uniones de canto en el mismo lugar: contexto, no problema. */
  terminaciones: number[];
  problemas: number[];
  acciones: AccionProblema[];
  /** `null` en casos raros: mostrar sólo el 3D. */
  detalle: DetalleNudo | null;
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
  segmento: [Vec3, Vec3] | null;  /** v2: `true` sólo en `sin_cubrir` (avisos de terminación). */
  terminacion: boolean;
  quien: Quien | null;
}

export interface PiezaVerificacion {
  grupo: number;
  categoria: string;
  estado: EstadoVerificacion;
  uniones: number;
  problemas: number;
  terminaciones: number;
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
  /** v2. En respuestas v1 valen 0. */
  nudos: number;
  nudosPorQuien: Record<Quien, number>;
  terminaciones: number;
  resueltasSolas: number;
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
  /** Agrupados por CAUSA. En v2 la lista principal es `nudos`. */
  problemas: ProblemaVerificacion[];
  /** v2: agrupados por LUGAR, ordenados (primero no_arma, y dentro los de `decidir`). */
  nudos: NudoVerificacion[];
  /** v2: uniones de canto. Arman igual; no cambian el veredicto. */
  terminaciones: ProblemaVerificacion[];
  /** Por id. */
  uniones: Map<number, UnionVerificacion>;
  /** v2: quién cede, decidido por el backend donde la sugerencia fallaba. */
  decisionesAutomaticas: DecisionPorPar[];
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

function quien(v: unknown): Quien | null {
  return v === "decidir" || v === "escala" || v === "modelo" ? v : null;
}

function punto2(v: unknown): [number, number] | null {
  if (!Array.isArray(v) || v.length < 2) return null;
  const a = Number(v[0]);
  const b = Number(v[1]);
  return Number.isFinite(a) && Number.isFinite(b) ? [a, b] : null;
}

function poligono(v: unknown): Array<[number, number]> {
  return Array.isArray(v) ? v.map(punto2).filter((p): p is [number, number] => p !== null) : [];
}

function numeros(v: unknown): number[] {
  return Array.isArray(v) ? v.map((x) => num(x, NaN)).filter(Number.isFinite) : [];
}

function decisionesPar(v: unknown): DecisionPorPar[] {
  return (Array.isArray(v) ? v : [])
    .map(rec)
    .filter((d): d is Rec => d !== null)
    .map((d) => ({
      group_a: num(d.group_a, NaN),
      group_b: num(d.group_b, NaN),
      yield_group_id: num(d.yield_group_id, NaN),
    }))
    .filter((d) => [d.group_a, d.group_b, d.yield_group_id].every(Number.isFinite));
}

function acciones(v: unknown): AccionProblema[] {
  return (Array.isArray(v) ? v : [])
    .map(rec)
    .filter((a): a is Rec => a !== null)
    .map((a) => ({ tipo: str(a.tipo), etiqueta: str(a.etiqueta), aplicar: aplicar(a.aplicar) }));
}

function detalle(v: unknown): DetalleNudo | null {
  const d = rec(v);
  if (!d) return null;
  const ejes = rec(d.ejes);
  const a = vec(ejes?.a);
  const b = vec(ejes?.b);
  if (!a || !b) return null;
  return {
    vista: d.vista === "corte" ? "corte" : "planta",
    ventanaM: num(d.ventana_m, 1.5),
    espesorM: num(d.espesor_m),
    ejes: { a, b },
    placas: (Array.isArray(d.placas) ? d.placas : [])
      .map(rec)
      .filter((p): p is Rec => p !== null)
      .map((p) => {
        const pol = poligono(p.poligono);
        return {
          pieza: str(p.pieza),
          grupo: num(p.grupo, NaN),
          estado: p.estado === "contexto" ? ("contexto" as const) : estado(p.estado),
          poligono: pol,
          centro: punto2(p.centro) ?? pol[0] ?? [0, 0],
        };
      })
      .filter((p) => p.poligono.length >= 3),
    solapes: (Array.isArray(d.solapes) ? d.solapes : [])
      .map(rec)
      .filter((x): x is Rec => x !== null)
      .map((x) => ({
        piezas: Array.isArray(x.piezas) ? x.piezas.map((y) => str(y)) : [],
        poligono: poligono(x.poligono),
      }))
      .filter((x) => x.poligono.length >= 3),
    cotas: (Array.isArray(d.cotas) ? d.cotas : [])
      .map(rec)
      .filter((c): c is Rec => c !== null)
      .map((c) => ({
        union: num(c.union, NaN),
        tipo: str(c.tipo),
        piezas: Array.isArray(c.piezas) ? c.piezas.map((y) => str(y)) : [],
        mm: num(c.mm),
        cmEdificio: num(c.cm_edificio),
        texto: str(c.texto),
        desde: punto2(c.desde) ?? [0, 0],
        hasta: punto2(c.hasta) ?? punto2(c.desde) ?? [0, 0],
      })),
  };
}

function problema(p: Rec, i: number): ProblemaVerificacion {
  return {
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
    uniones: numeros(p.uniones),
    acciones: acciones(p.acciones),
    quien: quien(p.quien),
    quienTexto: p.quien_texto == null ? null : str(p.quien_texto),
    escalaSugerida: p.escala_sugerida == null ? null : num(p.escala_sugerida, NaN) || null,
  };
}

function aplicar(v: unknown): AplicarAccion | null {
  const o = rec(v);
  if (!o) return null;
  const out: AplicarAccion = {};
  const escala = Number(o.scale_denom);
  if (Number.isFinite(escala) && escala > 0) out.scale_denom = escala;
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
    out.wall_wall_decisions_by_pair = decisionesPar(o.wall_wall_decisions_by_pair);
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
      terminaciones: num(p.terminaciones),
    });
  }

  const lista = (v: unknown) =>
    (Array.isArray(v) ? v : []).map(rec).filter((p): p is Rec => p !== null);
  const problemas = lista(o.problemas).map(problema);
  const terminaciones = lista(o.terminaciones).map(problema);
  const nudos: NudoVerificacion[] = lista(o.nudos).map((n, i) => ({
    id: num(n.id, i),
    estado: estado(n.estado),
    // Un nudo sin `quien` reconocible se trata como del modelo: es el único
    // que no promete un arreglo.
    quien: quien(n.quien) ?? "modelo",
    quienTexto: str(n.quien_texto),
    titulo: str(n.titulo),
    tipos: Array.isArray(n.tipos) ? n.tipos.map((x) => str(x)) : [],
    peorMm: num(n.peor_mm),
    peorCmEdificio: num(n.peor_cm_edificio),
    piezas: Array.isArray(n.piezas) ? n.piezas.map((x) => str(x)) : [],
    punto: vec(n.punto),
    uniones: numeros(n.uniones),
    terminaciones: numeros(n.terminaciones),
    problemas: numeros(n.problemas),
    acciones: acciones(n.acciones),
    detalle: detalle(n.detalle),
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
      terminacion: u.terminacion === true,
      quien: quien(u.quien),
    });
  }

  const tol = rec(o.tolerancias_mm);
  const pq = rec(r.nudos_por_quien);

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
      nudos: num(r.nudos, nudos.length),
      nudosPorQuien: {
        decidir: num(pq?.decidir),
        escala: num(pq?.escala),
        modelo: num(pq?.modelo),
      },
      terminaciones: num(r.terminaciones),
      resueltasSolas: num(r.resueltas_solas),
    },
    piezas,
    problemas,
    nudos,
    terminaciones,
    uniones,
    decisionesAutomaticas: decisionesPar(o.decisiones_automaticas),
  };
}

/**
 * El titular. v2: `206 de 295 piezas verificadas · 50 lugares para mirar ·
 * 27 uniones resueltas automáticamente · 68 avisos de terminación` — cuenta
 * lugares (nudos) y no piezas pendientes, porque eso es lo que hay que mirar.
 * v1: `287 de 295 piezas verificadas · 8 para revisar`.
 */
export function titularVerificacion(v: Verificacion): string {
  const { piezas, piezasOk } = v.resumen;
  const base = `${piezasOk} de ${piezas} piezas verificadas`;
  if (v.version >= 2) {
    const { nudos, resueltasSolas, terminaciones } = v.resumen;
    const partes = [base];
    if (nudos > 0) partes.push(nudos === 1 ? "1 lugar para mirar" : `${nudos} lugares para mirar`);
    if (resueltasSolas > 0)
      partes.push(
        resueltasSolas === 1
          ? "1 unión resuelta automáticamente"
          : `${resueltasSolas} uniones resueltas automáticamente`,
      );
    if (terminaciones > 0)
      partes.push(
        terminaciones === 1 ? "1 aviso de terminación" : `${terminaciones} avisos de terminación`,
      );
    return partes.join(" · ");
  }
  const pendientes = Math.max(piezas - piezasOk, 0);
  return pendientes > 0 ? `${base} · ${pendientes} para revisar` : base;
}

/** `1.4 mm · 14 cm de edificio`. */
export function medidaProblema(p: Pick<ProblemaVerificacion, "peorMm" | "peorCmEdificio">): string {
  const mm = p.peorMm.toLocaleString("es-AR", { maximumFractionDigits: 1 });
  const cm = p.peorCmEdificio.toLocaleString("es-AR", { maximumFractionDigits: 0 });
  return p.peorCmEdificio > 0 ? `${mm} mm · ${cm} cm de edificio` : `${mm} mm`;
}

/** Segmentos de las uniones de un problema o de un nudo, para dibujarlos en el visor. */
export function segmentosDeProblema(
  v: Verificacion,
  p: { uniones: number[] },
): Array<{ a: Vec3; b: Vec3; estado: EstadoVerificacion }> {
  const out: Array<{ a: Vec3; b: Vec3; estado: EstadoVerificacion }> = [];
  for (const id of p.uniones) {
    const u = v.uniones.get(id);
    if (u?.segmento) out.push({ a: u.segmento[0], b: u.segmento[1], estado: u.estado });
  }
  return out;
}

/**
 * Lo que el visor tiene que mirar: un nudo (v2) o un problema (v1, o uno de v2
 * que no es de un lugar, como `pieza_fina`). La clave lleva el tipo para que
 * los ids de nudos y problemas no se confundan.
 */
export interface FocoVerificacion {
  clave: string;
  titulo: string;
  piezas: string[];
  punto: Vec3 | null;
  uniones: number[];
  /**
   * v2, nudo: se muestran SÓLO estas piezas, en su posición (§2.2). En un
   * problema se atenúa el resto, como en v1.
   */
  soloEstas: boolean;
}

export const claveNudo = (id: number) => `n:${id}`;
export const claveProblema = (id: number) => `p:${id}`;

export function focoDe(v: Verificacion | null | undefined, clave: string | null): FocoVerificacion | null {
  if (!v || !clave) return null;
  const id = Number(clave.slice(2));
  if (clave.startsWith("n:")) {
    const n = v.nudos.find((x) => x.id === id);
    return n
      ? { clave, titulo: n.titulo, piezas: n.piezas, punto: n.punto, uniones: n.uniones, soloEstas: true }
      : null;
  }
  const p = v.problemas.find((x) => x.id === id) ?? null;
  return p
    ? { clave, titulo: p.titulo, piezas: p.piezas, punto: p.punto, uniones: p.uniones, soloEstas: false }
    : null;
}

/**
 * Problemas que no son de un lugar (no los cita ningún nudo), como
 * `pieza_fina`: sólo aparecen en `problemas`, y sin esto no se mostrarían.
 */
export function problemasSinNudo(v: Verificacion): ProblemaVerificacion[] {
  const citados = new Set(v.nudos.flatMap((n) => n.problemas));
  return v.problemas.filter((p) => !citados.has(p.id));
}
