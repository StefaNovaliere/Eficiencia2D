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

/** Límites sanos para el espaciado (m): 5 mm – 50 mm. */
export const FLEX_SPACING_MIN_M = 0.005;
export const FLEX_SPACING_MAX_M = 0.05;

export const FLEX_METHOD_LABEL: Record<FlexMethod, string> = {
  kerf: "Kerf bending",
  auxetic_rotating: "Auxético · cuadrados rotatorios",
  auxetic_reentrant: "Auxético · re-entrante",
  auxetic_chiral: "Auxético · quiral",
};

/** Defaults por método (placeholder; el back puede recomendar según radio/espesor). */
export function defaultFlexSpec(groupId: number, method: FlexMethod): FlexSpec {
  const base: FlexSpec = { groupId, method, spacingM: 0.012 };
  if (method === "kerf") {
    return { ...base, spacingM: 0.008, kerfWidthM: 0.0015, axisDeg: 0 };
  }
  // Auxéticos: pitch de celda algo mayor + ligamento.
  return { ...base, spacingM: 0.016, ligamentM: 0.003 };
}

export function clampSpacing(m: number): number {
  if (!Number.isFinite(m)) return 0.012;
  return Math.min(FLEX_SPACING_MAX_M, Math.max(FLEX_SPACING_MIN_M, m));
}

export function isAuxetic(method: FlexMethod): boolean {
  return method !== "kerf";
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

/** Filas paralelas de ranuras kerf, orientadas por `axisDeg`, con puentes. */
function kerfSegments(spec: FlexSpec, widthM: number, heightM: number): Segment2D[] {
  const spacing = clampSpacing(spec.spacingM);
  const angle = ((spec.axisDeg ?? 0) * Math.PI) / 180;
  // Dirección de las ranuras (a lo largo) y de avance (perpendicular).
  const dir = { x: Math.cos(angle), y: Math.sin(angle) };
  const step = { x: -Math.sin(angle), y: Math.cos(angle) };
  const cx = widthM / 2;
  const cy = heightM / 2;
  // Longitud generosa para cruzar el panel; el visor/panel recorta.
  const half = Math.hypot(widthM, heightM);
  const bridge = Math.max(spec.ligamentM ?? spacing * 0.5, spacing * 0.35);
  const count = Math.max(1, Math.floor((half * 2) / spacing));
  const segs: Segment2D[] = [];
  for (let i = -count; i <= count; i++) {
    // Fila i: alternar el corte para dejar puentes (kerf real es interrumpido).
    const offset = i * spacing;
    const bx = cx + step.x * offset;
    const by = cy + step.y * offset;
    // Dos tramos por fila con un puente al medio (esquemático).
    const gap = bridge / 2;
    const aStart = { x: bx - dir.x * half, y: by - dir.y * half };
    const aEnd = { x: bx - dir.x * gap, y: by - dir.y * gap };
    const bStart = { x: bx + dir.x * gap, y: by + dir.y * gap };
    const bEnd = { x: bx + dir.x * half, y: by + dir.y * half };
    // Alternar el puente por fila (patrón brick).
    if (i % 2 === 0) {
      segs.push({ u0: aStart.x, v0: aStart.y, u1: aEnd.x, v1: aEnd.y });
      segs.push({ u0: bStart.x, v0: bStart.y, u1: bEnd.x, v1: bEnd.y });
    } else {
      segs.push({ u0: aStart.x, v0: aStart.y, u1: bEnd.x, v1: bEnd.y });
    }
  }
  return segs;
}

/** Celdas auxéticas esquemáticas: una grilla de cuadraditos rotados (referencia). */
function auxeticSegments(spec: FlexSpec, widthM: number, heightM: number): Segment2D[] {
  const pitch = clampSpacing(spec.spacingM);
  const segs: Segment2D[] = [];
  const cols = Math.max(1, Math.floor(widthM / pitch));
  const rows = Math.max(1, Math.floor(heightM / pitch));
  const s = pitch * 0.62; // lado del corte dentro de la celda (deja ligamento)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = (c + 0.5) * pitch;
      const cy = (r + 0.5) * pitch;
      // Rotar el cuadradito 45° en celdas alternas (patrón de cuadrados rotatorios).
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
    ? kerfSegments(spec, widthM, heightM)
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
