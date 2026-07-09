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
