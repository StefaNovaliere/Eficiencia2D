/**
 * Slab de armado — da GROSOR físico al contorno plano de una pieza lifteada.
 *
 * `assembly-lift.ts` produce `positions`: triángulos planos (una sola cara) en
 * coordenadas de MUNDO, en la pose real de la pieza. Acá lo "engrosamos" a un
 * sólido de espesor `depth` a lo largo de la normal de la pieza, para poder ver
 * el volumen físico (MDF/cartón) y detectar a ojo si una pieza queda en el aire.
 *
 * No es una operación booleana: duplicamos las tapas (frente/dorso, centradas
 * ±depth/2 sobre el plano) y cosemos paredes laterales sobre las aristas de
 * borde del triangulado. Funciona sin importar si `positions` vino del backend o
 * de `liftPiece` — sólo necesita las caras + normal + espesor.
 */

import type { Vec3 } from "@/core/types";

export interface SlabGeometry {
  /** Triángulos de las dos tapas (frente + dorso), en coords de mundo. */
  caps: number[];
  /** Triángulos de las paredes laterales (contorno exterior + aberturas). */
  walls: number[];
}

const KEY_DECIMALS = 5;

function vkey(x: number, y: number, z: number): string {
  return `${x.toFixed(KEY_DECIMALS)},${y.toFixed(KEY_DECIMALS)},${z.toFixed(KEY_DECIMALS)}`;
}

function normalize(n: Vec3): Vec3 | null {
  const len = Math.hypot(n.x, n.y, n.z);
  if (!(len > 1e-9)) return null;
  return { x: n.x / len, y: n.y / len, z: n.z / len };
}

/**
 * Normal del plano de un triangulado plano (suma de normales de triángulo,
 * ponderada por área). Es la fuente más fiable para el espesor: siempre queda
 * perpendicular a las caras, sin depender de la convención del backend.
 */
export function faceNormalFromPositions(positions: number[]): Vec3 | null {
  const triCount = Math.floor(positions.length / 9);
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let t = 0; t < triCount; t++) {
    const i = t * 9;
    const ux = positions[i + 3] - positions[i];
    const uy = positions[i + 4] - positions[i + 1];
    const uz = positions[i + 5] - positions[i + 2];
    const vx = positions[i + 6] - positions[i];
    const vy = positions[i + 7] - positions[i + 1];
    const vz = positions[i + 8] - positions[i + 2];
    nx += uy * vz - uz * vy;
    ny += uz * vx - ux * vz;
    nz += ux * vy - uy * vx;
  }
  return normalize({ x: nx, y: ny, z: nz });
}

/**
 * Engrosa un triangulado plano (`caps`, formato x,y,z por vértice; 9 números por
 * triángulo) a un slab sólido de espesor `depth` sobre `normal`.
 *
 * - Tapas: frente = v + n·(depth/2); dorso = v − n·(depth/2) con winding
 *   invertido (para que la normal apunte hacia afuera).
 * - Paredes: por cada arista de borde (usada por un solo triángulo) un quad que
 *   une frente y dorso. Cubre el contorno exterior y los huecos (agujeros
 *   pasantes).
 *
 * Si `depth<=0` o la normal es inválida, devuelve `caps` sin engrosar y `walls` vacío.
 */
export function buildSlab(caps: number[], normal: Vec3, depth: number): SlabGeometry {
  const triCount = Math.floor(caps.length / 9);
  const n = normalize(normal);
  if (triCount === 0 || !n || !(depth > 0)) {
    return { caps: caps.slice(0, triCount * 9), walls: [] };
  }

  const h = depth / 2;
  const ox = n.x * h;
  const oy = n.y * h;
  const oz = n.z * h;

  const front: number[] = [];
  const back: number[] = [];
  // Conteo de aristas no dirigidas → las de borde aparecen una sola vez.
  const edgeCount = new Map<string, { ax: number; ay: number; az: number; bx: number; by: number; bz: number; count: number }>();

  const addEdge = (
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
  ) => {
    const ka = vkey(ax, ay, az);
    const kb = vkey(bx, by, bz);
    const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    const existing = edgeCount.get(key);
    if (existing) existing.count++;
    else edgeCount.set(key, { ax, ay, az, bx, by, bz, count: 1 });
  };

  for (let t = 0; t < triCount; t++) {
    const i = t * 9;
    const p = [
      caps[i], caps[i + 1], caps[i + 2],
      caps[i + 3], caps[i + 4], caps[i + 5],
      caps[i + 6], caps[i + 7], caps[i + 8],
    ];
    // Tapa frontal (mismo winding, desplazada +n·h).
    for (let k = 0; k < 3; k++) {
      front.push(p[k * 3] + ox, p[k * 3 + 1] + oy, p[k * 3 + 2] + oz);
    }
    // Tapa trasera (winding invertido, desplazada −n·h).
    for (const k of [0, 2, 1]) {
      back.push(p[k * 3] - ox, p[k * 3 + 1] - oy, p[k * 3 + 2] - oz);
    }
    // Aristas del triángulo original (para detectar el borde).
    addEdge(p[0], p[1], p[2], p[3], p[4], p[5]);
    addEdge(p[3], p[4], p[5], p[6], p[7], p[8]);
    addEdge(p[6], p[7], p[8], p[0], p[1], p[2]);
  }

  const walls: number[] = [];
  for (const e of edgeCount.values()) {
    if (e.count !== 1) continue; // sólo aristas de borde
    const aF = [e.ax + ox, e.ay + oy, e.az + oz];
    const bF = [e.bx + ox, e.by + oy, e.bz + oz];
    const aB = [e.ax - ox, e.ay - oy, e.az - oz];
    const bB = [e.bx - ox, e.by - oy, e.bz - oz];
    // Quad (aF, bF, bB, aB) → 2 triángulos.
    walls.push(
      aF[0], aF[1], aF[2], bF[0], bF[1], bF[2], bB[0], bB[1], bB[2],
      aF[0], aF[1], aF[2], bB[0], bB[1], bB[2], aB[0], aB[1], aB[2],
    );
  }

  return { caps: [...front, ...back], walls };
}
