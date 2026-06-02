// ============================================================================
// Joint Topology Classifier
//
// Classifies a wall–wall joint by WHERE the shared edge sits on each wall:
//   - L : both walls meet at an END  (exterior room corner — visually prominent)
//   - T : one wall ends at the MIDDLE of the other (the "stem" terminates)
//   - X : both walls cross at their MIDDLES (interior crossing)
//
// This drives two things:
//   1. A deterministic default for which wall yields (the stem of a T; the
//      East–West wall of an L/X tie).
//   2. A "critical" flag so the UI can surface only the joints whose decision
//      visibly changes the result, hiding the many that don't.
// ============================================================================

import type { Face3D, Vec3 } from "./types";
import { normalize } from "./types";
import type { GeometryGroup } from "./group-classifier";
import type { Joint } from "./joint-detector";

export type JointTopology = "L" | "T" | "X" | "unknown";

export interface JointTopologyInfo {
  topology: JointTopology;
  /** Shared edge falls on wall A's END (vs. its middle). */
  aAtEnd: boolean;
  /** Shared edge falls on wall B's END (vs. its middle). */
  bAtEnd: boolean;
}

/** A normalized position within [0,1] closer to an extreme than this is an "end". */
export const END_FRAC = 0.2;
/** Thinner/thicker ratio below this counts as a "big" thickness difference. */
export const CRITICAL_RATIO = 0.6;

/**
 * Horizontal running axis of a vertical wall — perpendicular to its (horizontal)
 * normal in the XZ plane. A wall facing East/West runs North–South and vice-versa.
 */
function runningAxis(normal: Vec3): Vec3 {
  return normalize({ x: -normal.z, y: 0, z: normal.x });
}

/** Project a point onto a (horizontal) axis through the origin. */
function projOnto(p: Vec3, axis: Vec3): number {
  return p.x * axis.x + p.y * axis.y + p.z * axis.z;
}

/** Min/max projection of a wall's footprint vertices onto a running axis. */
function spanAlong(faces: Face3D[], faceIndices: number[], axis: Vec3): { min: number; max: number } {
  let min = Infinity, max = -Infinity;
  for (const fi of faceIndices) {
    const face = faces[fi];
    if (!face) continue;
    for (const v of face.vertices) {
      const t = projOnto(v, axis);
      if (t < min) min = t;
      if (t > max) max = t;
    }
  }
  return { min, max };
}

/** Whether the shared edge midpoint sits at an END of the given wall's span. */
function edgeAtEnd(joint: Joint, group: GeometryGroup, faces: Face3D[]): boolean | null {
  const axis = runningAxis(group.representativeNormal);
  const { min, max } = spanAlong(faces, group.faceIndices, axis);
  const len = max - min;
  if (!isFinite(len) || len < 1e-6) return null; // degenerate footprint
  const t = (projOnto(joint.edgeMid, axis) - min) / len;
  return t < END_FRAC || t > 1 - END_FRAC;
}

/**
 * Classify a wall–wall joint as L / T / X using the shared edge's position
 * within each wall's horizontal footprint.
 */
export function classifyJointTopology(
  joint: Joint,
  gA: GeometryGroup,
  gB: GeometryGroup,
  faces: Face3D[],
): JointTopologyInfo {
  const aEnd = edgeAtEnd(joint, gA, faces);
  const bEnd = edgeAtEnd(joint, gB, faces);

  if (aEnd === null || bEnd === null) {
    return { topology: "unknown", aAtEnd: aEnd ?? false, bAtEnd: bEnd ?? false };
  }

  let topology: JointTopology;
  if (aEnd && bEnd) topology = "L";
  else if (aEnd || bEnd) topology = "T";
  else topology = "X";

  return { topology, aAtEnd: aEnd, bAtEnd: bEnd };
}

/**
 * A joint is "critical" (worth surfacing to the user) when its resolution
 * visibly affects the assembled model: exterior L corners, or joints where one
 * wall is much thicker than the other.
 */
export function isCriticalJoint(topology: JointTopology, tA: number, tB: number): boolean {
  if (topology === "L") return true;
  const lo = Math.min(tA, tB);
  const hi = Math.max(tA, tB);
  if (hi > 0.001 && lo / hi < CRITICAL_RATIO) return true;
  return false;
}
