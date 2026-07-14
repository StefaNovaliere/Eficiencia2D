/**
 * Angle measurement (protractor) tool — session-only, not persisted.
 *
 * Interaction model: 3 sequential clicks
 *   1st click → vertex (the corner of the angle)
 *   2nd click → end of arm 1
 *   3rd click → end of arm 2 → commits
 */

export interface AnglePoint {
  u: number;
  v: number;
}

/** Live draft state shown as the user places the three points. */
export interface AngleDraftState {
  groupId: number;
  /** Corner of the angle (1st click). */
  vertex: AnglePoint;
  /** End of arm 1 (set after 2nd click). */
  arm1?: AnglePoint;
  /** Current cursor position — used for the live preview ray. */
  cursor?: AnglePoint;
}

/** A fully committed angle measure. */
export interface UserAngleMeasure {
  id: string;
  groupId: number;
  vertex: AnglePoint;
  arm1: AnglePoint;
  arm2: AnglePoint;
}

export function createAngleMeasureId(): string {
  return `angle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Compute the angle in degrees between vertex→arm1 and vertex→arm2. */
export function computeAngleDeg(
  vertex: AnglePoint,
  arm1: AnglePoint,
  arm2: AnglePoint,
): number {
  const v1u = arm1.u - vertex.u;
  const v1v = arm1.v - vertex.v;
  const v2u = arm2.u - vertex.u;
  const v2v = arm2.v - vertex.v;
  const dot = v1u * v2u + v1v * v2v;
  const len1 = Math.hypot(v1u, v1v);
  const len2 = Math.hypot(v2u, v2v);
  if (len1 < 1e-9 || len2 < 1e-9) return 0;
  const cos = Math.max(-1, Math.min(1, dot / (len1 * len2)));
  return Math.acos(cos) * (180 / Math.PI);
}

export function formatAngleDeg(deg: number): string {
  return `${deg.toFixed(1).replace(".", ",")}°`;
}

/** Minimum arm length in UV space (~3 cm) required to confirm an arm. */
export const MIN_ANGLE_ARM_LENGTH = 0.03;
