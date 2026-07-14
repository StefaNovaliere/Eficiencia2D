/**
 * Geometría de preview (NO autoritativa) de nervios/columnas para el visor de
 * Revisión. La pieza real (con encastres/muescas) la genera el backend; acá sólo
 * mostramos un esquema en la ubicación pedida.
 *
 * El nervio se ancla en la **arista de intersección** de las dos placas ⊥ (p.ej.
 * pared-piso), como un soporte en la esquina, en la posición `t` a lo largo de la
 * arista. Los catetos de la cartela van perpendiculares a la arista, hacia el
 * interior de cada placa.
 */

import type { GeometryGroup } from "@/core/group-classifier";
import type { Face3D, Vec3 } from "@/core/types";
import type { PlateJoint } from "@/core/pipeline";
import type { Joint } from "@/core/joint-detector";
import { buildColumnGeometry, buildRibGeometry, type Rib, type Column } from "@/core/reinforcements";
import { cutGroupOwnerId } from "@/core/cut-derived-groups";

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
function scale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}
function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v.x, v.y, v.z);
  return l > 1e-9 ? { x: v.x / l, y: v.y / l, z: v.z / l } : { x: 0, y: 0, z: 0 };
}

function groupVertices(g: GeometryGroup, faces: Face3D[]): Vec3[] {
  const out: Vec3[] = [];
  for (const fi of g.faceIndices) {
    const f = faces[fi];
    if (f?.vertices) out.push(...f.vertices);
  }
  return out;
}

/**
 * Reconstruye los dos extremos de la arista a partir de un Joint de phase1.
 * El backend provee `edgeMid` y `edgeDir` (no necesariamente unitario);
 * los extremos son midpoint ± halfLen × dir.
 */
export function jointToEdge(j: Joint): { a: Vec3; b: Vec3 } {
  const halfLen = j.totalLength / 2;
  const d = normalize(j.edgeDir);
  return {
    a: {
      x: j.edgeMid.x - d.x * halfLen,
      y: j.edgeMid.y - d.y * halfLen,
      z: j.edgeMid.z - d.z * halfLen,
    },
    b: {
      x: j.edgeMid.x + d.x * halfLen,
      y: j.edgeMid.y + d.y * halfLen,
      z: j.edgeMid.z + d.z * halfLen,
    },
  };
}

/**
 * Convierte los `Joint` de `phase1` a `PlateJoint[]` para usar como fuente de
 * juntas cuando `nestingData` todavía no está disponible (review pre-nesting).
 * Se pasan TODOS los joints; la búsqueda por par filtra el correcto.
 */
export function jointsToPlateJoints(joints: Joint[]): PlateJoint[] {
  return joints.map((j) => {
    const { a, b } = jointToEdge(j);
    return { cutId: j.groupA, cutterId: j.groupB, a, b, width: 0.01 };
  });
}

export interface RibEdge {
  /** Punto sobre la arista en la posición pedida (`t`). */
  corner: Vec3;
  /** Cateto hacia el interior de la placa A (perpendicular a la arista). */
  dirA: Vec3;
  /** Cateto hacia el interior de la placa B. */
  dirB: Vec3;
}

/**
 * Arista de intersección de dos placas ⊥ y el punto en la posición `t`, con los
 * catetos hacia el interior de cada placa.
 *
 * Preferimos la arista EXACTA que da el backend (`PlateJoint` a→b: el mismo
 * segmento que ubica bien la unión). Si no hay joint para ese par, caemos a la
 * intersección de los dos planos recortada al solape de las placas. `null` si no
 * se puede determinar (placas paralelas y sin joint).
 */
export function ribEdgeForGroups(
  gA: GeometryGroup,
  gB: GeometryGroup,
  faces: Face3D[],
  t: number,
  joint?: { a: Vec3; b: Vec3} | null,
): RibEdge | null {
  const nA = normalize(gA.representativeNormal);
  const nB = normalize(gB.representativeNormal);
  const tc = Math.min(Math.max(t, 0), 1);

  let a: Vec3;
  let b: Vec3;
  if (joint) {
    // Arista exacta del backend.
    a = joint.a;
    b = joint.b;
  } else {
    // Fallback: intersección de planos recortada al solape de las placas.
    const dir = cross(nA, nB);
    const dirLen = Math.hypot(dir.x, dir.y, dir.z);
    if (dirLen < 1e-6) return null;
    const d = scale(dir, 1 / dirLen);
    const dA = dot(nA, gA.centroid);
    const dB = dot(nB, gB.centroid);
    const denom = dot(dir, dir);
    const p0 = scale(add(scale(cross(nB, dir), dA), scale(cross(dir, nA), dB)), 1 / denom);
    const span = (g: GeometryGroup) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (const v of groupVertices(g, faces)) {
        const s = dot(sub(v, p0), d);
        if (s < lo) lo = s;
        if (s > hi) hi = s;
      }
      return { lo, hi };
    };
    const sa = span(gA);
    const sb = span(gB);
    if (!Number.isFinite(sa.lo) || !Number.isFinite(sb.lo)) return null;
    const lo = Math.max(sa.lo, sb.lo);
    const hi = Math.min(sa.hi, sb.hi);
    if (hi <= lo) return null; // no comparten arista → no dibujar (evita ubicaciones lejanas)
    a = add(p0, scale(d, lo));
    b = add(p0, scale(d, hi));
  }

  const edgeDir = normalize(sub(b, a));
  const corner: Vec3 = {
    x: a.x + (b.x - a.x) * tc,
    y: a.y + (b.y - a.y) * tc,
    z: a.z + (b.z - a.z) * tc,
  };

  // Catetos: perpendiculares a la arista, en el plano de cada placa, hacia el interior.
  const orient = (n: Vec3, centroid: Vec3): Vec3 => {
    let leg = normalize(cross(n, edgeDir));
    if (dot(leg, sub(centroid, corner)) < 0) leg = scale(leg, -1);
    return leg;
  };
  return { corner, dirA: orient(nA, gA.centroid), dirB: orient(nB, gB.centroid) };
}

/** Busca el PlateJoint (arista real del backend) para el par de grupos {a,b}. */
function findJointForPair(
  plateJoints: PlateJoint[] | undefined,
  gA: number,
  gB: number,
): PlateJoint | null {
  if (!plateJoints) return null;
  for (const j of plateJoints) {
    if ((j.cutId === gA && j.cutterId === gB) || (j.cutId === gB && j.cutterId === gA)) {
      return j;
    }
  }
  return null;
}

/**
 * Triángulos combinados (coords de mundo) de todos los refuerzos, para un mesh
 * de overlay. Columnas = caja; nervios = cartela sobre la arista de intersección.
 *
 * @param projectionGroups  Grupos PADRE (phase1.groups) para resolver ids derivados
 *   (p.ej. grupos con id negativo = piezas de corte). Si se omite, se usa `groups`.
 */
export function computeReinforcementsGeometry(
  ribs: Rib[],
  columns: Column[],
  groups: GeometryGroup[],
  faces: Face3D[],
  plateJoints?: PlateJoint[],
  projectionGroups?: GeometryGroup[],
): number[] {
  // Preferir grupos padre para la búsqueda de geometría; los ids derivados
  // (negativos) no tienen geometría real propia.
  const sourceGroups = projectionGroups ?? groups;
  const byId = new Map<number, GeometryGroup>([
    ...groups.map((g): [number, GeometryGroup] => [g.id, g]),
    ...sourceGroups.map((g): [number, GeometryGroup] => [g.id, g]),
  ]);
  const out: number[] = [];

  for (const c of columns) {
    out.push(...buildColumnGeometry(c.position, c.heightM, c.sizeM));
  }

  for (const r of ribs) {
    // Resolver ids de dueño: un id negativo indica un fragmento derivado de un
    // corte; el dueño es el grupo padre con el id positivo real del backend.
    const ownerA = cutGroupOwnerId(r.groupA);
    const ownerB = cutGroupOwnerId(r.groupB);
    const A = byId.get(ownerA);
    const B = byId.get(ownerB);
    if (!A || !B) continue;

    const joint = findJointForPair(plateJoints, ownerA, ownerB);

    // Sin junta para el par → no dibujar nada (nunca inventar esquina).
    if (!joint) continue;

    // Clamp universal: la cartela no puede exceder el 35% del largo de la junta.
    const jointLen = Math.hypot(
      joint.b.x - joint.a.x,
      joint.b.y - joint.a.y,
      joint.b.z - joint.a.z,
    );
    const effectiveSizeM = jointLen > 1e-6 ? Math.min(r.sizeM, 0.35 * jointLen) : r.sizeM;

    const edge = ribEdgeForGroups(A, B, faces, r.t, joint);
    if (!edge) continue;
    const thicknessM = Math.max(effectiveSizeM * 0.06, 0.01);
    const g = buildRibGeometry(edge.corner, edge.dirA, edge.dirB, effectiveSizeM, thicknessM);
    out.push(...g.caps, ...g.walls);
  }

  return out;
}
