/**
 * Los datos físicos que el taller de corte pide antes de cortar: cuánto mide el
 * recuadro exterior del archivo y cuál es el detalle más chico que hay adentro.
 *
 * La app maneja todo en metros, pero un taller habla en centímetros y
 * milímetros, y corta el archivo tal cual llega ("no realizamos ajustes de
 * escala"). Traducir eso a mano es justo donde se cuelan los malentendidos.
 *
 * Las medidas de las piezas ya vienen a escala de impresión desde el backend
 * (metros sobre la plancha, no metros del edificio), así que acá sólo se cambia
 * de unidad — no se vuelve a escalar nada.
 */

import type { NestingSheet } from "@/core/sheet-nester";

/** Metros de plancha → centímetros, con un decimal. */
export function toCm(metres: number): number {
  return Math.round(metres * 1000) / 10;
}

/** Metros de plancha → milímetros, con un decimal. */
export function toMm(metres: number): number {
  return Math.round(metres * 10000) / 10;
}

/** "27,7 × 19 cm" — el recuadro exterior, como lo pide el taller. */
export function formatSheetSizeCm(widthM: number, heightM: number): string {
  const fmt = (n: number) => String(toCm(n)).replace(".", ",");
  return `${fmt(widthM)} × ${fmt(heightM)} cm`;
}

/** Une puntos coincidentes: las aristas llegan sueltas, sin decir a qué hueco son. */
function pointKey(p: { x: number; y: number }): string {
  return `${Math.round(p.x * 1e6)},${Math.round(p.y * 1e6)}`;
}

class DisjointSet {
  private parent = new Map<string, string>();

  find(a: string): string {
    const p = this.parent.get(a);
    if (p === undefined) {
      this.parent.set(a, a);
      return a;
    }
    if (p === a) return a;
    const root = this.find(p);
    this.parent.set(a, root);
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

/**
 * Lado menor de cada hueco (ventana, puerta, calado) de las planchas, en mm.
 *
 * Las aristas de hueco llegan como segmentos sueltos, así que primero se agrupan
 * por extremos compartidos: un contorno partido en muchos tramos cortos es UN
 * hueco, no muchos chiquitos. De cada grupo se toma el lado menor de su
 * recuadro, que es lo que decide si el láser lo puede resolver.
 */
export function holeFeatureSizesMm(sheets: NestingSheet[]): number[] {
  const sizes: number[] = [];

  for (const sheet of sheets) {
    for (const placed of sheet.panels) {
      const holes = placed.panel.edges.filter((e) => e.hole === true);
      if (holes.length === 0) continue;

      const dsu = new DisjointSet();
      for (const e of holes) dsu.union(pointKey(e.a), pointKey(e.b));

      const boxes = new Map<
        string,
        { minX: number; maxX: number; minY: number; maxY: number }
      >();
      for (const e of holes) {
        const root = dsu.find(pointKey(e.a));
        const box = boxes.get(root) ?? {
          minX: Infinity,
          maxX: -Infinity,
          minY: Infinity,
          maxY: -Infinity,
        };
        for (const p of [e.a, e.b]) {
          box.minX = Math.min(box.minX, p.x);
          box.maxX = Math.max(box.maxX, p.x);
          box.minY = Math.min(box.minY, p.y);
          box.maxY = Math.max(box.maxY, p.y);
        }
        boxes.set(root, box);
      }

      for (const box of boxes.values()) {
        const shorter = Math.min(box.maxX - box.minX, box.maxY - box.minY);
        if (shorter > 0) sizes.push(toMm(shorter));
      }
    }
  }

  return sizes.sort((a, b) => a - b);
}

/** El detalle más chico de todo el trabajo, en mm. `null` si no hay huecos. */
export function smallestHoleMm(sheets: NestingSheet[]): number | null {
  const sizes = holeFeatureSizesMm(sheets);
  return sizes.length > 0 ? sizes[0] : null;
}

/** Lado menor de la pieza más chica, en mm. `null` si no hay piezas. */
export function smallestPieceMm(sheets: NestingSheet[]): number | null {
  let smallest = Infinity;
  for (const sheet of sheets) {
    for (const placed of sheet.panels) {
      smallest = Math.min(smallest, placed.effectiveW, placed.effectiveH);
    }
  }
  return Number.isFinite(smallest) ? toMm(smallest) : null;
}
