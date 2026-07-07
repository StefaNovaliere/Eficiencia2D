/**
 * Flex specs for curved components: kerf bending + auxetic patterns.
 *
 * El FRONT captura, por componente (grupo), qué patrón aplicar y con qué
 * parámetros, y dibuja un preview ESQUEMÁTICO (no autoritativo). El BACKEND
 * desarrolla la superficie curva a plano y genera la geometría real del patrón
 * (ranuras kerf / celdas auxéticas) en el DXF/PDF/nesting.
 *
 * Backend: se envía como `flex` en POST /api/nesting-preview y /api/generate.
 * Ver CONTRATO_kerf_auxetico.md.
 */

export type FlexMethod =
  | "kerf"
  | "auxetic_rotating" // cuadrados rotatorios
  | "auxetic_reentrant" // re-entrante / honeycomb (bow-tie)
  | "auxetic_chiral"; // quiral

export const FLEX_METHODS: FlexMethod[] = [
  "kerf",
  "auxetic_rotating",
  "auxetic_reentrant",
  "auxetic_chiral",
];

/** Un spec por grupo: el componente se corta con este patrón para poder doblarse. */
export interface FlexSpec {
  groupId: number;
  method: FlexMethod;
  /** Distancia entre columnas (kerf) o entre ligamentos / pitch de celda (auxético), en metros. */
  spacingM: number;
  /** Ancho del ligamento / puente que queda sin cortar (m). Opcional. */
  ligamentM?: number;
  /** Ancho de la ranura de corte (kerf) en m. Opcional (el back usa el del material). */
  kerfWidthM?: number;
  /** Orientación del doblez (grados): dirección de las columnas kerf en el marco del panel. */
  axisDeg?: number;
}

/**
 * Espaciado en **metros FÍSICOS de la maqueta** (material a cortar), NO metros del
 * edificio. El backend lo escala por `scale_denom`. Rango útil kerf 2–6 mm.
 */
export const FLEX_SPACING_MIN_M = 0.002;
export const FLEX_SPACING_MAX_M = 0.006;
/** Ligamento (puente sin cortar), en metros de maqueta: 0.8–3 mm. */
export const FLEX_LIGAMENT_MIN_M = 0.0008;
export const FLEX_LIGAMENT_MAX_M = 0.003;

export const FLEX_METHOD_LABEL: Record<FlexMethod, string> = {
  kerf: "Kerf bending",
  auxetic_rotating: "Auxético · cuadrados rotatorios",
  auxetic_reentrant: "Auxético · re-entrante",
  auxetic_chiral: "Auxético · quiral",
};

/**
 * Defaults por método, en mm físicos de maqueta: kerf 3 mm, auxético 6 mm,
 * ligamento 1.5 mm. El back puede recomendar según radio/espesor.
 */
export function defaultFlexSpec(groupId: number, method: FlexMethod): FlexSpec {
  if (method === "kerf") {
    return { groupId, method, spacingM: 0.003, ligamentM: 0.0015, kerfWidthM: 0.0015, axisDeg: 0 };
  }
  return { groupId, method, spacingM: 0.006, ligamentM: 0.0015 };
}

export function clampSpacing(m: number): number {
  if (!Number.isFinite(m)) return 0.003;
  return Math.min(FLEX_SPACING_MAX_M, Math.max(FLEX_SPACING_MIN_M, m));
}

export function isAuxetic(method: FlexMethod): boolean {
  return method !== "kerf";
}

/**
 * Máximo ángulo (grados) entre las normales dadas. Para detectar fusiones de
 * paredes NO coplanares (panel "fantasma") antes de aplicar flex.
 */
export function maxNormalSpreadDeg(
  normals: readonly { x: number; y: number; z: number }[],
): number {
  const ang = (a: { x: number; y: number; z: number }, b: typeof a) => {
    const la = Math.hypot(a.x, a.y, a.z);
    const lb = Math.hypot(b.x, b.y, b.z);
    if (la < 1e-9 || lb < 1e-9) return 0;
    const c = Math.min(1, Math.max(-1, (a.x * b.x + a.y * b.y + a.z * b.z) / (la * lb)));
    return (Math.acos(c) * 180) / Math.PI;
  };
  let spread = 0;
  for (let i = 0; i < normals.length; i++) {
    for (let j = i + 1; j < normals.length; j++) {
      spread = Math.max(spread, ang(normals[i], normals[j]));
    }
  }
  return spread;
}

// ---------------------------------------------------------------------------
// Upsert / remove helpers (savedFlex es una lista con un spec por grupo).
// ---------------------------------------------------------------------------
export function findFlexForGroup(specs: FlexSpec[], groupId: number): FlexSpec | null {
  return specs.find((s) => s.groupId === groupId) ?? null;
}

export function upsertFlexSpec(specs: FlexSpec[], spec: FlexSpec): FlexSpec[] {
  const next = specs.filter((s) => s.groupId !== spec.groupId);
  next.push({ ...spec, spacingM: clampSpacing(spec.spacingM) });
  return next;
}

export function removeFlexForGroup(specs: FlexSpec[], groupId: number): FlexSpec[] {
  return specs.filter((s) => s.groupId !== groupId);
}

// ---------------------------------------------------------------------------
// Serialización para el backend (snake_case, sólo campos del contrato).
// ---------------------------------------------------------------------------
export function serializeFlexForApi(specs: FlexSpec[]): Record<string, unknown>[] {
  return specs.map((s) => ({
    group_id: s.groupId,
    method: s.method,
    spacing_m: clampSpacing(s.spacingM),
    ...(s.ligamentM != null ? { ligament_m: s.ligamentM } : {}),
    ...(s.kerfWidthM != null ? { kerf_width_m: s.kerfWidthM } : {}),
    ...(s.axisDeg != null ? { axis_deg: s.axisDeg } : {}),
  }));
}

export function parseFlexFromApi(raw: unknown): FlexSpec[] {
  if (!Array.isArray(raw)) return [];
  const out: FlexSpec[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (typeof o.group_id !== "number") continue;
    const method = String(o.method) as FlexMethod;
    if (!FLEX_METHODS.includes(method)) continue;
    out.push({
      groupId: o.group_id,
      method,
      spacingM: clampSpacing(Number(o.spacing_m)),
      ...(o.ligament_m != null ? { ligamentM: Number(o.ligament_m) } : {}),
      ...(o.kerf_width_m != null ? { kerfWidthM: Number(o.kerf_width_m) } : {}),
      ...(o.axis_deg != null ? { axisDeg: Number(o.axis_deg) } : {}),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Preview ESQUEMÁTICO en el marco 2D del panel (NO autoritativo, sólo referencia
// visual). Devuelve segmentos [u0,v0,u1,v1] en metros.
// ---------------------------------------------------------------------------
export type Segment2D = { u0: number; v0: number; u1: number; v1: number };

// El preview usa un **pitch VISUAL acotado** (nº de columnas según el tamaño del
// panel), NO el spacing físico literal (2–6 mm): a escala de edificio ese spacing
// daría miles de ranuras. Pero SÍ reacciona al spacing dentro de un rango acotado
// para que mover la barra se vea: más spacing ⇒ menos columnas y ranuras más anchas.
const VISUAL_KERF_COLUMNS_MIN = 8; // a spacing máximo (6 mm)
const VISUAL_KERF_COLUMNS_MAX = 16; // a spacing mínimo (2 mm)
const VISUAL_KERF_SLOTFRAC_MIN = 0.3; // ancho de ranura / pitch, a spacing mínimo
const VISUAL_KERF_SLOTFRAC_MAX = 0.6; // a spacing máximo
const VISUAL_AUX_CELLS = 7;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Peine (comb) de RANURAS RECTANGULARES que se remueven — living hinge tipo
 * acordeón/lattice. Cada ranura es un contorno cerrado (4 aristas) que se lee como
 * HUECO (material quitado), no como una línea. Columnas interdigitadas: alternan el
 * extremo con puente (par arriba / impar abajo). Orientado por `axisDeg`.
 * El nº de columnas y el ancho de ranura escalan (acotados) con `spec.spacingM`.
 * NO autoritativo: la geometría real (huecos en plancha/DXF) la genera el backend.
 */
function kerfSegments(spec: FlexSpec, widthM: number, heightM: number, axisDeg = 0): Segment2D[] {
  const angle = (axisDeg * Math.PI) / 180;
  const dir = { x: Math.cos(angle), y: Math.sin(angle) }; // largo de la ranura
  const step = { x: -Math.sin(angle), y: Math.cos(angle) }; // avance entre columnas (eje de doblez)
  const cx = widthM / 2;
  const cy = heightM / 2;
  // Medio-extensiones del panel (bbox) proyectadas sobre dir/step.
  const halfAlong = 0.5 * (Math.abs(widthM * dir.x) + Math.abs(heightM * dir.y));
  const halfAcross = 0.5 * (Math.abs(widthM * step.x) + Math.abs(heightM * step.y));
  // t = 0 en spacing mínimo (2 mm), 1 en máximo (6 mm).
  const span = FLEX_SPACING_MAX_M - FLEX_SPACING_MIN_M;
  const t = span > 0 ? (clampSpacing(spec.spacingM) - FLEX_SPACING_MIN_M) / span : 0;
  const columns = Math.round(lerp(VISUAL_KERF_COLUMNS_MAX, VISUAL_KERF_COLUMNS_MIN, t));
  const slotFrac = lerp(VISUAL_KERF_SLOTFRAC_MIN, VISUAL_KERF_SLOTFRAC_MAX, t);
  const pitch = Math.max((2 * halfAcross) / columns, 1e-4);
  const slotW = pitch * slotFrac; // ancho del hueco (ranura removida) — crece con el spacing
  const bridge = 2 * halfAlong * 0.15; // puente sin cortar en un extremo
  const cols = Math.ceil(halfAcross / pitch);

  const segs: Segment2D[] = [];
  const toUV = (al: number, ac: number) => ({
    u: cx + al * dir.x + ac * step.x,
    v: cy + al * dir.y + ac * step.y,
  });
  const rect = (aMin: number, aMax: number, acMin: number, acMax: number) => {
    const c0 = toUV(aMin, acMin);
    const c1 = toUV(aMax, acMin);
    const c2 = toUV(aMax, acMax);
    const c3 = toUV(aMin, acMax);
    segs.push({ u0: c0.u, v0: c0.v, u1: c1.u, v1: c1.v });
    segs.push({ u0: c1.u, v0: c1.v, u1: c2.u, v1: c2.v });
    segs.push({ u0: c2.u, v0: c2.v, u1: c3.u, v1: c3.v });
    segs.push({ u0: c3.u, v0: c3.v, u1: c0.u, v1: c0.v });
  };

  for (let i = -cols; i <= cols; i++) {
    const ac = i * pitch;
    // Ranura larga a lo largo de `dir`, con puente alternado en un extremo.
    const aMin = i % 2 === 0 ? -halfAlong : -halfAlong + bridge;
    const aMax = i % 2 === 0 ? halfAlong - bridge : halfAlong;
    rect(aMin, aMax, ac - slotW / 2, ac + slotW / 2);
  }
  return segs;
}

/** Teselado RALO de celdas (cuadrados rotatorios) — representativo, no autoritativo. */
function auxeticSegments(_spec: FlexSpec, widthM: number, heightM: number): Segment2D[] {
  const maxDim = Math.max(widthM, heightM);
  const pitch = Math.max(maxDim / VISUAL_AUX_CELLS, 1e-4);
  const cols = Math.max(1, Math.round(widthM / pitch));
  const rows = Math.max(1, Math.round(heightM / pitch));
  const cw = widthM / cols;
  const ch = heightM / rows;
  const s = Math.min(cw, ch) * 0.6; // lado del corte dentro de la celda (deja ligamento)
  const segs: Segment2D[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = (c + 0.5) * cw;
      const cy = (r + 0.5) * ch;
      const rot = (r + c) % 2 === 0 ? Math.PI / 4 : 0;
      const pts: { x: number; y: number }[] = [];
      for (let k = 0; k < 4; k++) {
        const a = rot + (k * Math.PI) / 2 + Math.PI / 4;
        pts.push({ x: cx + Math.cos(a) * s * 0.5, y: cy + Math.sin(a) * s * 0.5 });
      }
      for (let k = 0; k < 4; k++) {
        const p = pts[k];
        const q = pts[(k + 1) % 4];
        segs.push({ u0: p.x, v0: p.y, u1: q.x, v1: q.y });
      }
    }
  }
  return segs;
}

/**
 * Segmentos del patrón en el marco del panel (metros). ESQUEMÁTICO: comunica
 * densidad/orientación; la geometría real la hace el backend.
 */
export function flexPatternSegments2D(
  spec: FlexSpec,
  widthM: number,
  heightM: number,
): Segment2D[] {
  if (widthM <= 0 || heightM <= 0) return [];
  const raw = spec.method === "kerf"
    ? kerfSegments(spec, widthM, heightM, spec.axisDeg ?? 0)
    : auxeticSegments(spec, widthM, heightM);
  // Recortar al rectángulo del panel (clip simple por extremos dentro del bbox).
  return raw
    .map((s) => clipToRect(s, widthM, heightM))
    .filter((s): s is Segment2D => s != null);
}

/** Clip Liang–Barsky de un segmento al rectángulo [0,w]×[0,h]. */
function clipToRect(seg: Segment2D, w: number, h: number): Segment2D | null {
  let t0 = 0;
  let t1 = 1;
  const dx = seg.u1 - seg.u0;
  const dy = seg.v1 - seg.v0;
  const p = [-dx, dx, -dy, dy];
  const q = [seg.u0 - 0, w - seg.u0, seg.v0 - 0, h - seg.v0];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return null;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) {
        if (t > t1) return null;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return null;
        if (t < t1) t1 = t;
      }
    }
  }
  return {
    u0: seg.u0 + t0 * dx,
    v0: seg.v0 + t0 * dy,
    u1: seg.u0 + t1 * dx,
    v1: seg.v0 + t1 * dy,
  };
}

// ---------------------------------------------------------------------------
// Clip al CONTORNO real del componente (no al bbox). El preview no debe pintar
// fuera de la pared ni dentro de sus aberturas.
// ---------------------------------------------------------------------------
export type ContourEdge = { a: { x: number; y: number }; b: { x: number; y: number } };

/** Test punto-en-polígono por even-odd sobre las aristas (excluye huecos). */
function pointInEdges(x: number, y: number, edges: ContourEdge[]): boolean {
  let inside = false;
  for (const e of edges) {
    const yi = e.a.y, yj = e.b.y;
    const xi = e.a.x, xj = e.b.x;
    const intersect =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi + (yj === yi ? 1e-12 : 0)) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Recorta un segmento a la parte interior del polígono descripto por `edges`.
 * Devuelve los tramos que caen dentro (0, 1 o varios).
 */
export function clipSegmentToContour(seg: Segment2D, edges: ContourEdge[]): Segment2D[] {
  const dx = seg.u1 - seg.u0;
  const dy = seg.v1 - seg.v0;
  const ts: number[] = [0, 1];
  for (const e of edges) {
    const ex = e.b.x - e.a.x;
    const ey = e.b.y - e.a.y;
    const denom = dx * ey - dy * ex;
    if (Math.abs(denom) < 1e-12) continue;
    const t = ((e.a.x - seg.u0) * ey - (e.a.y - seg.v0) * ex) / denom;
    const s = ((e.a.x - seg.u0) * dy - (e.a.y - seg.v0) * dx) / denom;
    if (t > 1e-9 && t < 1 - 1e-9 && s >= -1e-9 && s <= 1 + 1e-9) ts.push(t);
  }
  ts.sort((a, b) => a - b);
  const out: Segment2D[] = [];
  for (let i = 0; i + 1 < ts.length; i++) {
    const ta = ts[i];
    const tb = ts[i + 1];
    if (tb - ta < 1e-6) continue;
    const tm = (ta + tb) / 2;
    if (!pointInEdges(seg.u0 + dx * tm, seg.v0 + dy * tm, edges)) continue;
    out.push({
      u0: seg.u0 + dx * ta,
      v0: seg.v0 + dy * ta,
      u1: seg.u0 + dx * tb,
      v1: seg.v0 + dy * tb,
    });
  }
  return out;
}
