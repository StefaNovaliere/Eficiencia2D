/**
 * Ajuste de encuentros pared-pared en el instructivo.
 *
 * La pared que CEDE se corta contra la cara INTERIOR del slab de la que MANDA
 * (espesor MDF del instructivo, engrosado hacia adentro). Así el rincón muestra
 * quién cubre a quién sin deformar la fachada exterior ni usar el grosor
 * arquitectónico del modelo.
 */

import type { GeometryGroup } from "./group-classifier";
import type { Joint } from "./joint-detector";
import type { WallWallJoint } from "./assembly-adjuster";
import type { Vec3 } from "./types";

export type WallWallDecisions = Map<number, number>;

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function normalize(v: Vec3): Vec3 | null {
  const len = Math.hypot(v.x, v.y, v.z);
  if (!(len > 1e-12)) return null;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

export function findSharedJoint(
  joints: Joint[],
  groupA: number,
  groupB: number,
): Joint | undefined {
  return joints.find(
    (j) =>
      (j.groupA === groupA && j.groupB === groupB) ||
      (j.groupA === groupB && j.groupB === groupA),
  );
}

/**
 * Empuja vértices que penetran el plano de la cara dominante, sólo cerca del
 * encuentro (para no deformar el resto de la pared).
 *
 * `planeNormal` apunta hacia el lado a CONSERVAR (interior de la pared que cede).
 * Vértices con (p − planePoint)·n < 0 se proyectan sobre el plano.
 */
export function clipPositionsAgainstDominantFace(
  positions: number[],
  planePoint: Vec3,
  planeNormal: Vec3,
  edgeMid: Vec3,
  influenceRadius: number,
): number[] {
  const n = normalize(planeNormal);
  if (!n || !(influenceRadius > 0) || positions.length < 9) return positions;

  const r2 = influenceRadius * influenceRadius;
  const out = positions.slice();

  for (let i = 0; i < out.length; i += 3) {
    const px = out[i];
    const py = out[i + 1];
    const pz = out[i + 2];
    const dx = px - edgeMid.x;
    const dy = py - edgeMid.y;
    const dz = pz - edgeMid.z;
    if (dx * dx + dy * dy + dz * dz > r2) continue;

    const d =
      (px - planePoint.x) * n.x +
      (py - planePoint.y) * n.y +
      (pz - planePoint.z) * n.z;
    if (d >= -1e-9) continue;

    out[i] = px - n.x * d;
    out[i + 1] = py - n.y * d;
    out[i + 2] = pz - n.z * d;
  }
  return out;
}

export interface YieldClipSpec {
  groupId: number;
  /** Punto sobre la cara del slab dominante (hacia el yielder). */
  planePoint: Vec3;
  /** Normal unitaria hacia el interior del yielder (lado a conservar). */
  planeNormal: Vec3;
  edgeMid: Vec3;
  influenceRadius: number;
}

/**
 * Un clip por encuentro: la pared que cede se corta en la cara INTERIOR del
 * slab de la que manda. Con engrosado hacia adentro, esa cara está a
 * `slabThicknessM` desde la fachada exterior (no half, que era del slab centrado).
 */
export function buildYieldClipSpecs(
  wallWallJoints: WallWallJoint[],
  joints: Joint[],
  groups: GeometryGroup[],
  decisions: WallWallDecisions,
  slabThicknessM: number,
): YieldClipSpec[] {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const specs: YieldClipSpec[] = [];
  const depth = Math.max(slabThicknessM, 0);
  if (!(depth > 1e-9)) return specs;

  for (const ww of wallWallJoints) {
    const yielderId =
      decisions.get(ww.jointIndex) ?? ww.suggestedYieldGroupId ?? ww.yieldGroupId;
    if (yielderId == null) continue;
    if (yielderId !== ww.groupA && yielderId !== ww.groupB) continue;

    const dominantId = yielderId === ww.groupA ? ww.groupB : ww.groupA;
    const yielder = byId.get(yielderId);
    const dominant = byId.get(dominantId);
    if (!yielder || !dominant) continue;

    const shared = findSharedJoint(joints, ww.groupA, ww.groupB);
    if (!shared) continue;

    const domN = normalize(dominant.representativeNormal);
    if (!domN) continue;

    // Cara interior del slab dominante (fachada + profundidad hacia el yielder).
    const toYielder = sub(yielder.centroid, dominant.centroid);
    let sign = Math.sign(dot(toYielder, domN));
    if (sign === 0) sign = 1;
    const towardYielder = scale(domN, sign);
    const planePoint = add(dominant.centroid, scale(towardYielder, depth));
    // Conservar el lado del yielder: normal del plano = hacia el yielder.
    const planeNormal = towardYielder;

    const influenceRadius =
      Math.max(shared.totalLength, slabThicknessM * 4, 0.25) * 0.55 +
      slabThicknessM * 2;

    specs.push({
      groupId: yielderId,
      planePoint,
      planeNormal,
      edgeMid: shared.edgeMid,
      influenceRadius,
    });
  }
  return specs;
}

export function applyYieldClipsToPositions(
  positions: number[],
  groupId: number,
  _group: GeometryGroup,
  specs: YieldClipSpec[],
): number[] {
  let out = positions;
  for (const spec of specs) {
    if (spec.groupId !== groupId) continue;
    out = clipPositionsAgainstDominantFace(
      out,
      spec.planePoint,
      spec.planeNormal,
      spec.edgeMid,
      spec.influenceRadius,
    );
  }
  return out;
}
