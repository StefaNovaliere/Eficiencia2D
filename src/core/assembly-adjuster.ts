// ============================================================================
// Assembly Adjuster
//
// Given detected joints and component thicknesses, computes dimension
// adjustments so that laser-cut pieces physically fit together.
//
// Wall–floor joints are resolved AUTOMATICALLY:
//   - Wall sits ON TOP of the floor → shorten wall by floor thickness.
//   - Wall sits BESIDE the floor   → no adjustment.
//
// Wall–wall joints are MANUAL: the system reports them but does not choose
// which wall yields until the user decides.
// ============================================================================

import type { Joint } from "./joint-detector";
import type { GeometryGroup } from "./group-classifier";
import type { Face3D } from "./types";
import { classifyJointTopology, isCriticalJoint, wallRunLength } from "./joint-topology";
import type { JointTopology, JointTopologyInfo } from "./joint-topology";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DimensionAdjustment {
  groupId: number;
  delta: number;
  /** Which dimension to trim: "height" clips the base (wall-floor), "width" clips a side (wall-wall). */
  axis: "height" | "width";
  reason: string;
  jointIndex: number;
}

export interface WallWallJoint {
  jointIndex: number;
  groupA: number;
  groupB: number;
  /** Which group yields (user decision). undefined = not yet decided. */
  yieldGroupId?: number;
  /**
   * Safe default: which group should yield if the user does not pick. The
   * thinner wall yields; if only one wall has a measured thickness, the other
   * yields (so there's a thickness to subtract). undefined = no thickness on
   * either side, so no adjustment is possible.
   */
  suggestedYieldGroupId?: number;
  /** Geometric type of the joint (L corner / T / X crossing). */
  topology?: JointTopology;
  /** Whether this joint's decision visibly affects the result (worth surfacing). */
  critical?: boolean;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute automatic dimension adjustments for wall–floor joints and
 * identify wall–wall joints that require manual resolution.
 */
export function computeAdjustments(
  joints: Joint[],
  groups: GeometryGroup[],
  wallWallDecisions?: Map<number, number>,
  faces?: Face3D[],
): { adjustments: DimensionAdjustment[]; wallWallJoints: WallWallJoint[] } {
  const groupById = new Map<number, GeometryGroup>();
  for (const g of groups) groupById.set(g.id, g);

  const adjustments: DimensionAdjustment[] = [];
  const wallWallJoints: WallWallJoint[] = [];

  for (let ji = 0; ji < joints.length; ji++) {
    const joint = joints[ji];

    // Only handle near-90° joints.
    if (joint.dihedralAngle < 75 || joint.dihedralAngle > 95) continue;

    const gA = groupById.get(joint.groupA);
    const gB = groupById.get(joint.groupB);
    if (!gA || !gB) continue;
    if (gA.category === "discard" || gB.category === "discard") continue;

    const absYA = Math.abs(gA.representativeNormal.y);
    const absYB = Math.abs(gB.representativeNormal.y);

    const aIsFloor = gA.category === "floor" && absYA > 0.5;
    const bIsFloor = gB.category === "floor" && absYB > 0.5;

    if (aIsFloor !== bIsFloor) {
      // Wall–floor joint.
      const floor = aIsFloor ? gA : gB;
      const wall = aIsFloor ? gB : gA;

      if (!floor.thickness || floor.thickness < 0.001) continue;

      // Gate: wall must sit ON TOP of the floor (wall.minY ≈ floor.maxY)
      // AND the shared edge must be predominantly horizontal.
      const wallOnTop = isWallOnTop(wall, floor, joint);
      if (!wallOnTop) continue;

      const delta = -floor.thickness;
      const label = floor.label ?? `Grupo ${floor.id}`;

      adjustments.push({
        groupId: wall.id,
        delta,
        axis: "height",
        reason: `Junta con ${label} (grosor ${(floor.thickness * 100).toFixed(1)}cm)`,
        jointIndex: ji,
      });
    } else if (!aIsFloor && !bIsFloor) {
      // Wall–wall joint: register with a deterministic physical default.
      const tA = gA.thickness ?? 0;
      const tB = gB.thickness ?? 0;

      // Geometric type of the joint (needs face footprints). Used for the
      // tie-break default and to flag joints worth surfacing to the user.
      const topoInfo = faces ? classifyJointTopology(joint, gA, gB, faces) : undefined;
      const topology: JointTopology = topoInfo?.topology ?? "unknown";

      const suggestedYieldGroupId = chooseWallWallYielder(gA, gB, tA, tB, topoInfo, faces);
      const critical = isCriticalJoint(topology, tA, tB);

      wallWallJoints.push({
        jointIndex: ji,
        groupA: gA.id,
        groupB: gB.id,
        suggestedYieldGroupId,
        topology,
        critical,
      });

      // Apply user decision if present.
      const decision = wallWallDecisions?.get(ji);
      if (decision != null) {
        const yieldGroup = groupById.get(decision);
        const otherGroup = groupById.get(decision === gA.id ? gB.id : gA.id);
        if (yieldGroup && otherGroup) {
          // Prefer the non-yielding wall's thickness; fall back to the
          // yielder's own thickness (same stock material assumption).
          const trimThickness =
            (otherGroup.thickness && otherGroup.thickness > 0.001)
              ? otherGroup.thickness
              : (yieldGroup.thickness && yieldGroup.thickness > 0.001)
                ? yieldGroup.thickness
                : 0;
          if (trimThickness > 0.001) {
            wallWallJoints[wallWallJoints.length - 1].yieldGroupId = decision;
            adjustments.push({
              groupId: decision,
              delta: -trimThickness,
              axis: "width",
              reason: `Junta con ${otherGroup.label} (grosor ${(trimThickness * 100).toFixed(1)}cm)`,
              jointIndex: ji,
            });
          }
        }
      }
    }
  }

  // Deduplicate height adjustments (wall-floor): keep the largest per group.
  // Width adjustments (wall-wall) pass through unmerged — a wall at a corner
  // can be clipped on multiple sides from different joints.
  const seenHeight = new Map<number, DimensionAdjustment>();
  const keptWidth: DimensionAdjustment[] = [];
  for (const adj of adjustments) {
    if (adj.axis === "height") {
      const existing = seenHeight.get(adj.groupId);
      if (!existing || adj.delta < existing.delta) {
        seenHeight.set(adj.groupId, adj);
      }
    } else {
      keptWidth.push(adj);
    }
  }

  return { adjustments: [...Array.from(seenHeight.values()), ...keptWidth], wallWallJoints };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Decide which wall yields at a wall–wall joint, using deterministic physical
 * rules so an untouched model never produces overlapping pieces:
 *
 *   1. Clearly different thickness → the THINNER wall yields (thicker passes
 *      through, like a partition meeting a load-bearing wall).
 *   2. Near-equal thickness, joint is a T → the STEM yields (the wall that ends
 *      against the middle of the other).
 *   3. Near-equal thickness, L or X → the EAST–WEST wall yields (the North–South
 *      wall "wins"): arbitrary but consistent so the result is predictable.
 *
 * Returns undefined only when neither wall has a measurable thickness.
 */
function chooseWallWallYielder(
  gA: GeometryGroup,
  gB: GeometryGroup,
  tA: number,
  tB: number,
  topoInfo?: JointTopologyInfo,
  faces?: Face3D[],
): number | undefined {
  // No thickness on either side → nothing to subtract.
  if (tA <= 0.001 && tB <= 0.001) return undefined;
  // Only one side measured → the other yields (so there's a thickness to trim).
  if (tA > 0.001 && tB <= 0.001) return gB.id;
  if (tB > 0.001 && tA <= 0.001) return gA.id;

  // Both measured. Clearly different (ratio < 0.9) → thinner yields.
  const lo = Math.min(tA, tB);
  const hi = Math.max(tA, tB);
  if (lo / hi < 0.9) return tA <= tB ? gA.id : gB.id;

  // Wall length: the clearly shorter wall yields (double guard avoids false positives).
  if (faces) {
    const lenA = wallRunLength(gA, faces);
    const lenB = wallRunLength(gB, faces);
    const loLen = Math.min(lenA, lenB);
    const hiLen = Math.max(lenA, lenB);
    if (hiLen > 0.5 && loLen / hiLen < 0.6 && (hiLen - loLen) > 2.0) {
      return lenA <= lenB ? gA.id : gB.id;
    }
  }

  // Near-equal thickness: break the tie geometrically.
  if (topoInfo && topoInfo.topology === "T") {
    // The stem (the wall whose edge sits at its own end) yields.
    if (topoInfo.aAtEnd && !topoInfo.bAtEnd) return gA.id;
    if (topoInfo.bAtEnd && !topoInfo.aAtEnd) return gB.id;
  }

  // L / X / unknown tie → North–South wall wins, East–West wall yields.
  const aIsEastWest = Math.abs(gA.representativeNormal.z) >= Math.abs(gA.representativeNormal.x);
  const bIsEastWest = Math.abs(gB.representativeNormal.z) >= Math.abs(gB.representativeNormal.x);
  if (aIsEastWest && !bIsEastWest) return gA.id;
  if (bIsEastWest && !aIsEastWest) return gB.id;

  // Same orientation family → stable fallback by id order.
  return gA.id <= gB.id ? gA.id : gB.id;
}

/**
 * Check if a wall sits on top of a floor slab.
 *
 * Conditions:
 *   1. wall.minY ≥ floor.maxY − tol  (wall's bottom is at the slab's top)
 *   2. horizontalFrac ≥ 0.5          (shared edge is predominantly horizontal)
 *
 * The tolerance is relative to the floor's thickness so it scales with the
 * piece rather than being a fixed epsilon.
 */
function isWallOnTop(wall: GeometryGroup, floor: GeometryGroup, joint: Joint): boolean {
  if (wall.minY == null || floor.maxY == null) return false;

  const tol = Math.max(floor.thickness ?? 0, 0.05);
  if (wall.minY < floor.maxY - tol) return false;

  if (joint.horizontalFrac < 0.5) return false;

  return true;
}
