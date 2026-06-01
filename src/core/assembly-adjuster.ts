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
      // Wall–wall joint: register for manual resolution, with a safe default.
      const tA = gA.thickness ?? 0;
      const tB = gB.thickness ?? 0;
      let suggestedYieldGroupId: number | undefined;
      if (tA > 0.001 && tB > 0.001) {
        // Both measured → thinner wall yields.
        suggestedYieldGroupId = tA <= tB ? gA.id : gB.id;
      } else if (tA > 0.001) {
        // Only A has thickness → B yields (shortened by A's thickness).
        suggestedYieldGroupId = gB.id;
      } else if (tB > 0.001) {
        suggestedYieldGroupId = gA.id;
      } // else: neither has thickness → no suggestion, no possible adjustment.

      wallWallJoints.push({
        jointIndex: ji,
        groupA: gA.id,
        groupB: gB.id,
        suggestedYieldGroupId,
      });

      // Apply user decision if present.
      const decision = wallWallDecisions?.get(ji);
      if (decision != null) {
        const yieldGroup = groupById.get(decision);
        const otherGroup = groupById.get(decision === gA.id ? gB.id : gA.id);
        if (yieldGroup && otherGroup && otherGroup.thickness && otherGroup.thickness > 0.001) {
          wallWallJoints[wallWallJoints.length - 1].yieldGroupId = decision;
          adjustments.push({
            groupId: decision,
            delta: -otherGroup.thickness,
            axis: "width",
            reason: `Junta con ${otherGroup.label} (grosor ${(otherGroup.thickness * 100).toFixed(1)}cm)`,
            jointIndex: ji,
          });
        }
      }
    }
  }

  // Deduplicate: keep only the largest adjustment per (group, axis).
  const seen = new Map<string, DimensionAdjustment>();
  for (const adj of adjustments) {
    const key = `${adj.groupId}:${adj.axis}`;
    const existing = seen.get(key);
    if (!existing || adj.delta < existing.delta) {
      seen.set(key, adj);
    }
  }

  return { adjustments: Array.from(seen.values()), wallWallJoints };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
