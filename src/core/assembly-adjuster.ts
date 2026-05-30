// ============================================================================
// Assembly Adjuster
//
// Given detected joints and component thicknesses, computes dimension
// adjustments so that laser-cut pieces physically fit together.
//
// At a 90° butt joint (wall on floor), the wall must be shortened by the
// floor's thickness on the edge where they meet.
// ============================================================================

import type { Joint } from "./joint-detector";
import type { GeometryGroup } from "./group-classifier";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DimensionAdjustment {
  groupId: number;
  delta: number;
  reason: string;
  jointIndex: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute dimension adjustments for assembly. Only handles ~90° butt joints.
 * The component whose normal is more horizontal (wall) gets shortened by
 * the thickness of the component whose normal is more vertical (floor/ceiling).
 */
export function computeAdjustments(
  joints: Joint[],
  groups: GeometryGroup[],
): DimensionAdjustment[] {
  const groupById = new Map<number, GeometryGroup>();
  for (const g of groups) groupById.set(g.id, g);

  const adjustments: DimensionAdjustment[] = [];

  for (let ji = 0; ji < joints.length; ji++) {
    const joint = joints[ji];

    // Only handle near-90° joints (85°–95°).
    if (joint.dihedralAngle < 75 || joint.dihedralAngle > 95) continue;

    const gA = groupById.get(joint.groupA);
    const gB = groupById.get(joint.groupB);
    if (!gA || !gB) continue;
    if (gA.category === "discard" || gB.category === "discard") continue;

    // Determine which is the "receiver" (more horizontal = floor) and
    // which is the "abutting" (more vertical = wall).
    const absYA = Math.abs(gA.representativeNormal.y);
    const absYB = Math.abs(gB.representativeNormal.y);

    let receiver: GeometryGroup;
    let abutting: GeometryGroup;

    if (absYA > absYB) {
      receiver = gA;
      abutting = gB;
    } else {
      receiver = gB;
      abutting = gA;
    }

    // The receiver must have a known thickness to apply an adjustment.
    if (!receiver.thickness || receiver.thickness < 0.001) continue;

    const delta = -receiver.thickness;
    const label = groupById.get(receiver.id)?.label ?? `Grupo ${receiver.id}`;

    adjustments.push({
      groupId: abutting.id,
      delta,
      reason: `Junta con ${label} (grosor ${(receiver.thickness * 100).toFixed(1)}cm)`,
      jointIndex: ji,
    });
  }

  // Deduplicate: if a wall has multiple joints with the same floor on the
  // same side, keep only the largest adjustment.
  const seen = new Map<number, DimensionAdjustment>();
  for (const adj of adjustments) {
    const existing = seen.get(adj.groupId);
    if (!existing || adj.delta < existing.delta) {
      seen.set(adj.groupId, adj);
    }
  }

  return Array.from(seen.values());
}
