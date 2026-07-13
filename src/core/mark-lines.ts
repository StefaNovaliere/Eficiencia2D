/**
 * Líneas de marca ROJAS arbitrarias dibujadas sobre un componente para GRABARLAS
 * en la pieza (capa roja MARK_VECTOR del DXF/PDF). Cada línea es una polilínea en
 * coords UV del panel (metros), atada a un grupo — recta = 2 puntos; mano alzada =
 * N puntos ya simplificados.
 *
 * El FRONT dibuja y previsualiza (rojo, no autoritativo); el BACKEND graba la
 * geometría real, recortada al material del panel. Se envía como `mark_lines` en
 * POST /api/nesting-preview y /api/generate. Ver CONTRATO_mark_lines_backend.md.
 */

export interface MarkLinePoint {
  u: number;
  v: number;
}

export interface MarkLine {
  id: string;
  groupId: number;
  /** Vértices de la polilínea en coords UV del panel (metros). */
  points: MarkLinePoint[];
}

export function createMarkLineId(): string {
  return `mkl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Longitud mínima total (m) para conservar un trazo (~2 cm). Descarta toques. */
export const MIN_MARK_LINE_M = 0.02;

/** Segmentos para aproximar un círculo/elipse como polilínea. */
export const MARK_CIRCLE_SEGMENTS = 48;

/**
 * Rectángulo (polilínea CERRADA, 5 puntos) a partir del bbox del arrastre
 * (u0,v0)→(u1,v1). El backend graba la polilínea tal cual — sin cambios.
 */
export function rectPoints(u0: number, v0: number, u1: number, v1: number): MarkLinePoint[] {
  return [
    { u: u0, v: v0 },
    { u: u1, v: v0 },
    { u: u1, v: v1 },
    { u: u0, v: v1 },
    { u: u0, v: v0 },
  ];
}

/**
 * Elipse (polilínea CERRADA de `segments`+1 puntos) inscrita en el bbox del
 * arrastre (u0,v0)→(u1,v1). Con un arrastre cuadrado da un círculo.
 */
export function circlePoints(
  u0: number,
  v0: number,
  u1: number,
  v1: number,
  segments: number = MARK_CIRCLE_SEGMENTS,
): MarkLinePoint[] {
  const cu = (u0 + u1) / 2;
  const cv = (v0 + v1) / 2;
  const ru = Math.abs(u1 - u0) / 2;
  const rv = Math.abs(v1 - v0) / 2;
  const n = Math.max(3, Math.floor(segments));
  const pts: MarkLinePoint[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push({ u: cu + ru * Math.cos(a), v: cv + rv * Math.sin(a) });
  }
  return pts;
}

/** Longitud total de la polilínea (suma de segmentos), en metros. */
export function markLineLengthM(points: MarkLinePoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].u - points[i - 1].u, points[i].v - points[i - 1].v);
  }
  return total;
}

/** Distancia perpendicular del punto p al segmento a→b. */
function perpDist(p: MarkLinePoint, a: MarkLinePoint, b: MarkLinePoint): number {
  const dx = b.u - a.u;
  const dy = b.v - a.v;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return Math.hypot(p.u - a.u, p.v - a.v);
  const t = ((p.u - a.u) * dx + (p.v - a.v) * dy) / len2;
  const cx = a.u + t * dx;
  const cy = a.v + t * dy;
  return Math.hypot(p.u - cx, p.v - cy);
}

/**
 * Simplifica una polilínea (Ramer–Douglas–Peucker) con tolerancia `tolM` (m).
 * Limpia el ruido del trazo a mano alzada conservando la forma.
 */
export function simplifyPolyline(points: MarkLinePoint[], tolM: number): MarkLinePoint[] {
  if (points.length <= 2) return points.slice();
  let maxDist = 0;
  let idx = 0;
  const first = points[0];
  const last = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDist(points[i], first, last);
    if (d > maxDist) {
      maxDist = d;
      idx = i;
    }
  }
  if (maxDist <= tolM) return [first, last];
  const left = simplifyPolyline(points.slice(0, idx + 1), tolM);
  const right = simplifyPolyline(points.slice(idx), tolM);
  return [...left.slice(0, -1), ...right];
}

// ---------------------------------------------------------------------------
// upsert / remove (savedMarkLines es una lista; se identifican por id).
// ---------------------------------------------------------------------------
export function upsertMarkLine(lines: MarkLine[], line: MarkLine): MarkLine[] {
  const next = lines.filter((l) => l.id !== line.id);
  next.push(line);
  return next;
}

export function removeMarkLine(lines: MarkLine[], id: string): MarkLine[] {
  return lines.filter((l) => l.id !== id);
}

// ---------------------------------------------------------------------------
// Serialización para el backend (snake_case).
// ---------------------------------------------------------------------------
export function serializeMarkLinesForApi(lines: MarkLine[]): Record<string, unknown>[] {
  return lines.map((l) => ({
    id: l.id,
    group_id: l.groupId,
    points: l.points.map((p) => [p.u, p.v]),
  }));
}

export function parseMarkLinesFromApi(raw: unknown): MarkLine[] {
  if (!Array.isArray(raw)) return [];
  const out: MarkLine[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (typeof o.group_id !== "number" || !Array.isArray(o.points)) continue;
    const points: MarkLinePoint[] = [];
    for (const pt of o.points as unknown[]) {
      if (Array.isArray(pt) && pt.length >= 2) {
        points.push({ u: Number(pt[0]), v: Number(pt[1]) });
      }
    }
    if (points.length < 2) continue;
    out.push({
      id: String(o.id ?? createMarkLineId()),
      groupId: o.group_id,
      points,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Colocación precisa (recta): largo + ángulo + bordes de referencia.
// ---------------------------------------------------------------------------

export type MarkHorizontalEdge = "left" | "right";
export type MarkVerticalEdge = "top" | "bottom";

/** @deprecated Prefer `angleDeg`. Kept for migration of old in-memory state. */
export type MarkLineOrientation = "horizontal" | "vertical";

export interface MarkLinePrecisionSpec {
  lengthM: number;
  /**
   * Ángulo en grados en el plano UV del panel.
   * 0° = horizontal hacia la derecha (+U), 90° = vertical hacia arriba (+V).
   */
  angleDeg: number;
  horizontalEdge: MarkHorizontalEdge;
  verticalEdge: MarkVerticalEdge;
  /** Distancia al borde izquierdo o derecho (m). */
  offsetHorizontalM: number;
  /** Distancia al borde superior o inferior (m). */
  offsetVerticalM: number;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Normaliza ángulo a [0, 360). */
export function normalizeMarkAngleDeg(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  const n = deg % 360;
  return n < 0 ? n + 360 : n;
}

/**
 * Coloca una línea recta de largo fijo desde el ancla (offsets a bordes)
 * en la dirección `angleDeg`.
 */
export function markLinePointsFromPrecision(
  spec: MarkLinePrecisionSpec,
  panelWidthM: number,
  panelHeightM: number,
): MarkLinePoint[] {
  const length = Math.max(0, spec.lengthM);
  const angleDeg = normalizeMarkAngleDeg(spec.angleDeg);
  const rad = (angleDeg * Math.PI) / 180;

  let anchorU: number;
  let anchorV: number;

  if (spec.horizontalEdge === "left") {
    anchorU = clamp(spec.offsetHorizontalM, 0, panelWidthM);
  } else {
    anchorU = clamp(panelWidthM - spec.offsetHorizontalM, 0, panelWidthM);
  }

  if (spec.verticalEdge === "bottom") {
    anchorV = clamp(spec.offsetVerticalM, 0, panelHeightM);
  } else {
    anchorV = clamp(panelHeightM - spec.offsetVerticalM, 0, panelHeightM);
  }

  const u1 = clamp(anchorU + length * Math.cos(rad), 0, panelWidthM);
  const v1 = clamp(anchorV + length * Math.sin(rad), 0, panelHeightM);

  return [
    { u: anchorU, v: anchorV },
    { u: u1, v: v1 },
  ];
}

/** Lee largo / ángulo / offsets de una línea recta (2 puntos). */
export function getMarkLinePrecisionSpec(
  points: MarkLinePoint[],
  panelWidthM: number,
  panelHeightM: number,
  preferred?: Partial<
    Pick<MarkLinePrecisionSpec, "horizontalEdge" | "verticalEdge" | "angleDeg">
  >,
): MarkLinePrecisionSpec | null {
  if (points.length < 2) return null;
  const a = points[0];
  const b = points[points.length - 1];

  const angleDeg =
    preferred?.angleDeg != null && Number.isFinite(preferred.angleDeg)
      ? normalizeMarkAngleDeg(preferred.angleDeg)
      : normalizeMarkAngleDeg((Math.atan2(b.v - a.v, b.u - a.u) * 180) / Math.PI);

  const minU = Math.min(a.u, b.u);
  const maxU = Math.max(a.u, b.u);
  const minV = Math.min(a.v, b.v);
  const maxV = Math.max(a.v, b.v);

  const left = minU;
  const right = Math.max(0, panelWidthM - maxU);
  const bottom = minV;
  const top = Math.max(0, panelHeightM - maxV);

  const horizontalEdge =
    preferred?.horizontalEdge ?? (left <= right ? "left" : "right");
  const verticalEdge = preferred?.verticalEdge ?? (top <= bottom ? "top" : "bottom");

  // Offsets respecto al ancla (punto de inicio `a`), no al bbox,
  // para que el ángulo no mueva el punto de referencia al remedir.
  const offsetHorizontalM =
    horizontalEdge === "left" ? a.u : Math.max(0, panelWidthM - a.u);
  const offsetVerticalM =
    verticalEdge === "top" ? Math.max(0, panelHeightM - a.v) : a.v;

  return {
    lengthM: markLineLengthM([a, b]),
    angleDeg,
    horizontalEdge,
    verticalEdge,
    offsetHorizontalM,
    offsetVerticalM,
  };
}

export function formatMarkMetersInput(n: number): string {
  if (!Number.isFinite(n)) return "";
  const rounded = Math.round(n * 1000) / 1000;
  return String(rounded);
}

export function parseMarkMetersInput(raw: string): number | null {
  const normalized = raw.trim().replace(",", ".");
  if (!normalized) return null;
  const n = Number(normalized);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export function formatMarkDegreesInput(n: number): string {
  if (!Number.isFinite(n)) return "";
  const rounded = Math.round(normalizeMarkAngleDeg(n) * 10) / 10;
  return String(rounded);
}

export function parseMarkDegreesInput(raw: string): number | null {
  const normalized = raw.trim().replace(",", ".");
  if (!normalized) return null;
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return normalizeMarkAngleDeg(n);
}
