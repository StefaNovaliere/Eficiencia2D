// ============================================================================
// Assembly lift — coloca cada pieza de CORTE en su pose 3D real.
//
// El instructivo de armado mostraba cajas primitivas en poses reconstruidas mal
// (un "frankenstein"). Acá, en cambio, "lifteamos" el contorno 2D de corte de
// cada pieza (con sus aberturas) a 3D usando el marco `Placement` que provee el
// backend (`topology.placements`):
//
//     world = origin + u_local·uAxis + v·vAxis        (u_local = widthM − u si mirrored)
//
// Es una transformación lineal pura (sin cálculo geométrico nuevo): el backend
// es dueño de la geometría; acá sólo mapeamos contorno local → mundo y
// triangulamos para dibujar. Reusa el mismo earcut que el visor de /review
// (`THREE.ShapeUtils.triangulateShape`, que admite huecos).
// ============================================================================

import * as THREE from "three";
import type { Face3D, Vec2, Vec3 } from "./types";
import type { Placement, PlateJoint } from "./pipeline";
import type { NestingPanel } from "./sheet-nester";

export interface LiftedPieceGeometry {
  /** Triángulos en coordenadas de mundo (x,y,z planos), listos para BufferGeometry. */
  positions: number[];
  /** Segmentos de las aberturas (huecos) en mundo: [x,y,z, x,y,z, …] para LineSegments. */
  openings: number[];
  /** True si la pieza tiene aberturas (huecos) lifteadas. */
  hasHoles: boolean;
  /** Triángulos de las ranuras de encastre (overlay v2), en coords de mundo. */
  slots?: number[];
}

type Edge = { a: Vec2; b: Vec2; hole?: boolean };
type Ring = Vec2[];

const EPS = 1e-6;
const KEY_DECIMALS = 5;

function key(p: Vec2): string {
  return `${p.x.toFixed(KEY_DECIMALS)},${p.y.toFixed(KEY_DECIMALS)}`;
}

/**
 * Encadena una lista plana de segmentos en anillos cerrados, separando el
 * contorno exterior (`hole=false`) de los huecos (`hole=true`). Los `edges` de
 * un panel de nesting vienen como segmentos sueltos; acá los reconstruimos en
 * loops para poder triangular y dibujar.
 */
export function edgesToRings(edges: Edge[]): { outer: Ring[]; holes: Ring[] } {
  const outer = chainRings(edges.filter((e) => e.hole !== true));
  const holes = chainRings(edges.filter((e) => e.hole === true));
  return { outer, holes };
}

function chainRings(edges: Edge[]): Ring[] {
  if (edges.length === 0) return [];

  // Adyacencia por punto: cada punto → lista de índices de aristas no usadas.
  const byPoint = new Map<string, number[]>();
  for (let i = 0; i < edges.length; i++) {
    for (const p of [edges[i].a, edges[i].b]) {
      const k = key(p);
      const arr = byPoint.get(k);
      if (arr) arr.push(i);
      else byPoint.set(k, [i]);
    }
  }

  const used = new Array(edges.length).fill(false);
  const rings: Ring[] = [];

  for (let start = 0; start < edges.length; start++) {
    if (used[start]) continue;
    used[start] = true;
    const ring: Ring = [edges[start].a, edges[start].b];
    let current = edges[start].b;

    // Caminar de arista en arista hasta cerrar el loop o agotar vecinos.
    for (let guard = 0; guard < edges.length; guard++) {
      const candidates = byPoint.get(key(current)) ?? [];
      let nextIdx = -1;
      for (const ci of candidates) {
        if (!used[ci]) { nextIdx = ci; break; }
      }
      if (nextIdx === -1) break;
      used[nextIdx] = true;
      const e = edges[nextIdx];
      const next = pointsEqual(e.a, current) ? e.b : e.a;
      if (pointsEqual(next, ring[0])) break; // cerró
      ring.push(next);
      current = next;
    }

    if (ring.length >= 3) rings.push(ring);
  }

  return rings;
}

function pointsEqual(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS;
}

/**
 * Liftea una pieza a 3D. Si `panel` viene, usa su contorno de corte real (con
 * aberturas); si no, usa el rectángulo del `placement` (pose correcta, sin
 * huecos). En ambos casos la pose sale del marco `placement`.
 */
export function liftPiece(
  placement: Placement,
  panel: NestingPanel | null,
): LiftedPieceGeometry {
  const { widthM, heightM, mirrored } = placement;

  let outerRings: Ring[];
  let holeRings: Ring[];

  if (panel && panel.edges.length > 0 && panel.widthM > EPS) {
    // Los edges del panel están a escala 1/scaleDenom; el factor real es
    // placement.widthM / panel.widthM (auto-corrige la convención de unidades).
    const scale = widthM / panel.widthM;
    const { outer, holes } = edgesToRings(panel.edges);
    outerRings = outer.map((r) => r.map((p) => scaleAndMirror(p, scale, widthM, mirrored)));
    holeRings = holes.map((r) => r.map((p) => scaleAndMirror(p, scale, widthM, mirrored)));
    // Si no se pudo reconstruir el exterior, caer al rectángulo.
    if (outerRings.length === 0) outerRings = [rectRing(widthM, heightM, mirrored)];
  } else {
    outerRings = [rectRing(widthM, heightM, mirrored)];
    holeRings = [];
  }

  const positions: number[] = [];
  for (const ring of outerRings) {
    triangulateRingWithHoles(ring, holeRings, placement, positions);
  }

  const openings: number[] = [];
  for (const ring of holeRings) {
    pushRingSegments(ring, placement, openings);
  }

  return { positions, openings, hasHoles: holeRings.length > 0 };
}

function rectRing(w: number, h: number, mirrored: boolean): Ring {
  const ring: Ring = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
  return mirrored ? ring.map((p) => ({ x: w - p.x, y: p.y })) : ring;
}

function scaleAndMirror(p: Vec2, scale: number, widthM: number, mirrored: boolean): Vec2 {
  const u = p.x * scale;
  const v = p.y * scale;
  return { x: mirrored ? widthM - u : u, y: v };
}

/** P = origin + u·uAxis + v·vAxis (u,v en metros reales). */
function liftUV(u: number, v: number, placement: Placement): THREE.Vector3 {
  const { origin, uAxis, vAxis } = placement;
  return new THREE.Vector3(
    origin.x + u * uAxis.x + v * vAxis.x,
    origin.y + u * uAxis.y + v * vAxis.y,
    origin.z + u * uAxis.z + v * vAxis.z,
  );
}

function triangulateRingWithHoles(
  outer: Ring,
  holes: Ring[],
  placement: Placement,
  out: number[],
): void {
  const outer2D = outer.map((p) => new THREE.Vector2(p.x, p.y));
  const holes2D = holes.map((h) => h.map((p) => new THREE.Vector2(p.x, p.y)));

  // Vértices combinados (exterior + huecos) en el mismo orden que usa earcut.
  const combined: Vec2[] = [...outer, ...holes.flat()];
  const lifted = combined.map((p) => liftUV(p.x, p.y, placement));

  let tris: number[][];
  try {
    tris = THREE.ShapeUtils.triangulateShape(outer2D, holes2D);
  } catch {
    tris = [];
  }

  if (tris.length === 0) {
    // Fallback fan sobre el exterior (mejor algo que nada).
    const liftedOuter = outer.map((p) => liftUV(p.x, p.y, placement));
    for (let i = 1; i < liftedOuter.length - 1; i++) {
      pushTri(out, liftedOuter[0], liftedOuter[i], liftedOuter[i + 1]);
    }
    return;
  }

  for (const t of tris) {
    pushTri(out, lifted[t[0]], lifted[t[1]], lifted[t[2]]);
  }
}

function pushTri(out: number[], a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): void {
  out.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
}

/**
 * Fallback #1 (contrato): geometría ORIGINAL de la pieza, renderizando las caras
 * del grupo tal cual (coordenadas de mundo, pose exacta). No necesita
 * `placements`. Triangula cada cara como el visor de /review
 * (`ModelViewer.triangulateFace`): proyecta al plano que descarta el eje
 * dominante de la normal y usa earcut.
 */
export function liftFaces(faces: Face3D[]): LiftedPieceGeometry {
  const positions: number[] = [];
  for (const face of faces) {
    triangulateFaceWorld(face, positions);
  }
  return { positions, openings: [], hasHoles: false };
}

function triangulateFaceWorld(face: Face3D, out: number[]): void {
  const vs = face.vertices;
  if (vs.length < 3) return;
  if (vs.length === 3) {
    pushTri(
      out,
      new THREE.Vector3(vs[0].x, vs[0].y, vs[0].z),
      new THREE.Vector3(vs[1].x, vs[1].y, vs[1].z),
      new THREE.Vector3(vs[2].x, vs[2].y, vs[2].z),
    );
    return;
  }

  const nx = Math.abs(face.normal.x);
  const ny = Math.abs(face.normal.y);
  const nz = Math.abs(face.normal.z);

  const contour: THREE.Vector2[] = [];
  if (nx >= ny && nx >= nz) {
    for (const v of vs) contour.push(new THREE.Vector2(v.y, v.z));
  } else if (ny >= nx && ny >= nz) {
    for (const v of vs) contour.push(new THREE.Vector2(v.x, v.z));
  } else {
    for (const v of vs) contour.push(new THREE.Vector2(v.x, v.y));
  }

  let tris: number[][];
  try {
    tris = THREE.ShapeUtils.triangulateShape(contour, []);
  } catch {
    tris = [];
  }

  if (tris.length === 0) {
    for (let i = 1; i < vs.length - 1; i++) {
      pushTri(
        out,
        new THREE.Vector3(vs[0].x, vs[0].y, vs[0].z),
        new THREE.Vector3(vs[i].x, vs[i].y, vs[i].z),
        new THREE.Vector3(vs[i + 1].x, vs[i + 1].y, vs[i + 1].z),
      );
    }
    return;
  }

  for (const t of tris) {
    const a = vs[t[0]];
    const b = vs[t[1]];
    const c = vs[t[2]];
    pushTri(
      out,
      new THREE.Vector3(a.x, a.y, a.z),
      new THREE.Vector3(b.x, b.y, b.z),
      new THREE.Vector3(c.x, c.y, c.z),
    );
  }
}

function pushRingSegments(ring: Ring, placement: Placement, out: number[]): void {
  for (let i = 0; i < ring.length; i++) {
    const a = liftUV(ring[i].x, ring[i].y, placement);
    const b = liftUV(ring[(i + 1) % ring.length].x, ring[(i + 1) % ring.length].y, placement);
    out.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
}

/**
 * Overlay v2: ranuras de encastre. Cada `PlateJoint` (segmento a→b en mundo,
 * con `width`) se dibuja como un rectángulo fino sobre el plano de la cara
 * (perpendicular = normal × dirección), engrosado `width`. Ya viene en coords
 * de mundo → no se liftea nada. Devuelve triángulos (x,y,z planos).
 */
export function buildSlots(joints: PlateJoint[], normal: Vec3): number[] {
  const out: number[] = [];
  const n = new THREE.Vector3(normal.x, normal.y, normal.z);
  if (n.lengthSq() < EPS) n.set(0, 0, 1);
  n.normalize();

  for (const j of joints) {
    if (!j?.a || !j?.b) continue;
    const a = new THREE.Vector3(j.a.x, j.a.y, j.a.z);
    const b = new THREE.Vector3(j.b.x, j.b.y, j.b.z);
    const dir = new THREE.Vector3().subVectors(b, a);
    if (dir.lengthSq() < EPS) continue;
    dir.normalize();

    // Perpendicular dentro del plano de la cara.
    let perp = new THREE.Vector3().crossVectors(n, dir);
    if (perp.lengthSq() < EPS) continue;
    perp.normalize();
    const half = (Number.isFinite(j.width) && j.width > 0 ? j.width : 0.012) / 2;
    perp = perp.multiplyScalar(half);

    // Pequeño offset sobre la normal para evitar z-fighting con la malla.
    const off = n.clone().multiplyScalar(0.0015);

    const a1 = a.clone().add(perp).add(off);
    const a2 = a.clone().sub(perp).add(off);
    const b1 = b.clone().add(perp).add(off);
    const b2 = b.clone().sub(perp).add(off);

    pushTri(out, a1, a2, b1);
    pushTri(out, a2, b2, b1);
  }
  return out;
}
