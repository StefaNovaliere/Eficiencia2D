// ============================================================================
// Assembly types (thin client)
//
// El cálculo de ajustes de ensamble vive en el backend. Acá sólo quedan los
// tipos que viajan dentro de `Phase1Result` y que usa la UI de Revisión.
// ============================================================================

import type { JointTopology } from "./joint-topology";

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
