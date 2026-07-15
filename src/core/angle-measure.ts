/**
 * Angle measurement (protractor) tool — session-only, not persisted.
 *
 * Two measurement modes selectable by pressing T repeatedly:
 *
 *  "line"   — 2 clicks on the SAME panel.  Shows the angle the drawn line
 *             makes with the horizontal (U axis).  0° = horizontal, 90° = vertical.
 *
 *  "panels" — 2 clicks on ANY panel (can be different components).  Shows the
 *             dihedral (face-to-face) angle between the two panels.
 */

export interface AnglePoint {
  u: number;
  v: number;
}

// ─── Draft states ─────────────────────────────────────────────────────────────

export type AngleDraftState =
  | {
      mode: "line";
      groupId: number;
      point1: AnglePoint;
      /** Live cursor position for the preview line. */
      cursor?: AnglePoint;
    }
  | {
      mode: "panels";
      groupId1: number;
      point1: AnglePoint;
    };

// ─── Committed measures ───────────────────────────────────────────────────────

export type UserAngleMeasure =
  | {
      mode: "line";
      id: string;
      groupId: number;
      point1: AnglePoint;
      point2: AnglePoint;
    }
  | {
      mode: "panels";
      id: string;
      groupId1: number;
      groupId2: number;
      point1: AnglePoint;
      point2: AnglePoint;
    };

// ─── Utilities ────────────────────────────────────────────────────────────────

export function createAngleMeasureId(): string {
  return `angle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Angle in degrees that the line P1→P2 makes with the horizontal (U axis),
 * normalized to 0°–180°.  Used for mode "line".
 */
export function computeLineDeg(point1: AnglePoint, point2: AnglePoint): number {
  const du = point2.u - point1.u;
  const dv = point2.v - point1.v;
  if (Math.hypot(du, dv) < 1e-9) return 0;
  let deg = Math.atan2(dv, du) * (180 / Math.PI);
  if (deg < 0) deg += 180;
  if (deg >= 180) deg -= 180;
  return deg;
}

export function formatAngleDeg(deg: number): string {
  return `${deg.toFixed(1).replace(".", ",")}°`;
}

/** Minimum distance (UV metres, ~3 cm) required to confirm a placement. */
export const MIN_ANGLE_ARM_LENGTH = 0.03;

// Keep legacy export name so existing callers don't break
export const computeAngleDeg = computeLineDeg;
