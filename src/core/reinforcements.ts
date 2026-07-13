/**
 * Refuerzos estructurales: NERVIOS (cartelas) y COLUMNAS. El MDF/cartón fino
 * pandea; estos refuerzos multiplican la rigidez.
 *
 * Reparto (mismo patrón que kerf/flex): el FRONT expresa la INTENCIÓN (dónde va
 * cada refuerzo) + un preview esquemático NO autoritativo; el BACKEND genera la
 * pieza real con sus pestañas/encastres y las muescas en las placas, la nestea y
 * la cotiza. Ver CONTRATO_nervios_columnas_backend.md.
 */

import type { Vec3 } from "@/core/types";
import { buildSlab } from "@/core/assembly-slab";

// ---------------------------------------------------------------------------
// Modelo de datos
// ---------------------------------------------------------------------------
/** Nervio (cartela): triángulo de refuerzo en la esquina donde se cruzan dos
 *  placas ⊥ (p.ej. pared-piso). Va SOBRE la arista de intersección, como un
 *  soporte; `t` (0..1) elige la posición a lo largo de esa arista. */
export interface Rib {
  id: string;
  groupA: number;
  groupB: number;
  /** Tamaño del cateto de la cartela, en metros (mundo). */
  sizeM: number;
  /** Posición a lo largo de la arista de intersección (0 = un extremo, 1 = el otro). */
  t: number;
}

/** Columna estructural: pilar entre dos alturas en una posición. */
export interface Column {
  id: string;
  position: Vec3;
  /** Altura (m mundo). */
  heightM: number;
  /** Lado de la sección cuadrada (m mundo). */
  sizeM: number;
}

/** Cateto FÍSICO de la cartela en la maqueta (50×50 mm): pieza modesta, sólo para
 *  dar escuadra y facilitar el pegado. En el mundo del visor (metros reales del
 *  edificio) se escala por el denominador de impresión, igual que el espesor. */
export const DEFAULT_RIB_PHYSICAL_M = 0.05;

/** Tamaño del nervio en metros de MUNDO para una maqueta a escala 1:`scaleDenom`. */
export function resolveRibSizeM(scaleDenom: number, physicalM: number = DEFAULT_RIB_PHYSICAL_M): number {
  return Math.max(physicalM, 0) * Math.max(scaleDenom, 1);
}

/** @deprecated Tamaño fijo previo; usar resolveRibSizeM(scale). */
export const DEFAULT_RIB_SIZE_M = 0.3;
export const DEFAULT_COLUMN_SIZE_M = 0.2;
/** Posición inicial del nervio a lo largo de la arista (centro). */
export const DEFAULT_RIB_T = 0.5;

export function createRibId(): string {
  return `rib-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
export function createColumnId(): string {
  return `col-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function removeRib(ribs: Rib[], id: string): Rib[] {
  return ribs.filter((r) => r.id !== id);
}
export function removeColumn(cols: Column[], id: string): Column[] {
  return cols.filter((c) => c.id !== id);
}

// ---------------------------------------------------------------------------
// Serialización backend (snake_case)
// ---------------------------------------------------------------------------
export function serializeRibsForApi(ribs: Rib[]): Record<string, unknown>[] {
  return ribs.map((r) => ({
    id: r.id,
    group_a: r.groupA,
    group_b: r.groupB,
    size_m: r.sizeM,
    pos_t: r.t,
  }));
}
export function serializeColumnsForApi(cols: Column[]): Record<string, unknown>[] {
  return cols.map((c) => ({
    id: c.id,
    position: [c.position.x, c.position.y, c.position.z],
    height_m: c.heightM,
    size_m: c.sizeM,
  }));
}

// ---------------------------------------------------------------------------
// Geometría esquemática (preview no autoritativo) — triángulos en coords de mundo
// ---------------------------------------------------------------------------
function tri(out: number[], a: Vec3, b: Vec3, c: Vec3): void {
  out.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
}

/**
 * Cartela: triángulo rectángulo con vértice en `corner`, catetos `sizeM` a lo
 * largo de `dirA` y `dirB` (las dos placas), engrosado a slab de `thicknessM`.
 */
export function buildRibGeometry(
  corner: Vec3,
  dirA: Vec3,
  dirB: Vec3,
  sizeM: number,
  thicknessM: number,
): { caps: number[]; walls: number[] } {
  const a = { x: corner.x + dirA.x * sizeM, y: corner.y + dirA.y * sizeM, z: corner.z + dirA.z * sizeM };
  const b = { x: corner.x + dirB.x * sizeM, y: corner.y + dirB.y * sizeM, z: corner.z + dirB.z * sizeM };
  const caps: number[] = [];
  tri(caps, corner, a, b);
  // Normal del triángulo = dirA × dirB.
  const normal = {
    x: dirA.y * dirB.z - dirA.z * dirB.y,
    y: dirA.z * dirB.x - dirA.x * dirB.z,
    z: dirA.x * dirB.y - dirA.y * dirB.x,
  };
  return buildSlab(caps, normal, thicknessM);
}

/**
 * Columna: caja de sección `sizeM × sizeM` y alto `heightM`, centrada en
 * `position` (que es la base). Devuelve triángulos (12 caras).
 */
export function buildColumnGeometry(position: Vec3, heightM: number, sizeM: number): number[] {
  const hx = sizeM / 2;
  const hz = sizeM / 2;
  const x0 = position.x - hx, x1 = position.x + hx;
  const z0 = position.z - hz, z1 = position.z + hz;
  const y0 = position.y, y1 = position.y + heightM;
  const V = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
  const c = [
    V(x0, y0, z0), V(x1, y0, z0), V(x1, y0, z1), V(x0, y0, z1), // base 0-3
    V(x0, y1, z0), V(x1, y1, z0), V(x1, y1, z1), V(x0, y1, z1), // top 4-7
  ];
  const out: number[] = [];
  const quad = (i: number, j: number, k: number, l: number) => {
    tri(out, c[i], c[j], c[k]);
    tri(out, c[i], c[k], c[l]);
  };
  quad(0, 1, 2, 3); // base
  quad(7, 6, 5, 4); // top
  quad(0, 4, 5, 1); // lados
  quad(1, 5, 6, 2);
  quad(2, 6, 7, 3);
  quad(3, 7, 4, 0);
  return out;
}
