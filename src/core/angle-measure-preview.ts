/**
 * 3D geometry for the angle measurement tool.
 *
 * mode "line"   → line segment + label at midpoint (angle vs horizontal)
 * mode "panels" → crosshair on each clicked point + label between them
 *                 (dihedral angle between the two panel normals)
 */

import type { Face3D, Vec3 } from "@/core/types";
import type { GeometryGroup } from "@/core/group-classifier";
import { getGroupProjection } from "@/core/cut-preview";
import type { CutPreviewSegment } from "@/core/cut-preview";
import {
  computeLineDeg,
  formatAngleDeg,
  type AngleDraftState,
  type AnglePoint,
  type UserAngleMeasure,
} from "@/core/angle-measure";

type UpAxis = "Y" | "Z";

// ─── Internal helpers ──────────────────────────────────────────────────────────

function dotV(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function panel2DTo3D(
  u: number,
  v: number,
  uAxis: Vec3,
  vAxis: Vec3,
  anchor: Vec3,
  originU: number,
  originV: number,
): Vec3 {
  const au = dotV(anchor, uAxis);
  const av = dotV(anchor, vAxis);
  return {
    x: anchor.x + (u + originU - au) * uAxis.x + (v + originV - av) * vAxis.x,
    y: anchor.y + (u + originU - au) * uAxis.y + (v + originV - av) * vAxis.y,
    z: anchor.z + (u + originU - au) * uAxis.z + (v + originV - av) * vAxis.z,
  };
}

interface ProjCtx {
  uAxis: Vec3;
  vAxis: Vec3;
  normal: Vec3;
  anchor: Vec3;
  originU: number;
  originV: number;
  bias: number;
}

function getCtx(
  faces: Face3D[],
  groups: GeometryGroup[],
  groupId: number,
  up: UpAxis,
): ProjCtx | null {
  const group = groups.find((g) => g.id === groupId);
  if (!group) return null;
  const groupFaces = group.faceIndices
    .map((fi) => faces[fi])
    .filter((f): f is Face3D => !!f && f.vertices.length >= 3);
  if (groupFaces.length === 0) return null;
  const proj = getGroupProjection(faces, group, up);
  if (!proj) return null;
  const { uAxis, vAxis, normal, originU, originV } = proj;
  const nlen = Math.hypot(normal.x, normal.y, normal.z);
  return {
    uAxis, vAxis, normal,
    anchor: groupFaces[0].vertices[0],
    originU, originV,
    bias: nlen > 1e-6 ? 0.007 : 0,
  };
}

function uvTo3D(p: AnglePoint, ctx: ProjCtx, sign: 1 | -1): Vec3 {
  const w = panel2DTo3D(p.u, p.v, ctx.uAxis, ctx.vAxis, ctx.anchor, ctx.originU, ctx.originV);
  return {
    x: w.x + ctx.normal.x * ctx.bias * sign,
    y: w.y + ctx.normal.y * ctx.bias * sign,
    z: w.z + ctx.normal.z * ctx.bias * sign,
  };
}

// ─── Segment builders ─────────────────────────────────────────────────────────

/** Single line segment P1→P2, drawn on both sides of the panel (mode "line"). */
function lineSegments(
  point1: AnglePoint,
  point2: AnglePoint,
  groupId: number,
  ctx: ProjCtx,
): CutPreviewSegment[] {
  const segs: CutPreviewSegment[] = [];
  for (const sign of [1, -1] as const) {
    segs.push({ groupId, normal: ctx.normal, a: uvTo3D(point1, ctx, sign), b: uvTo3D(point2, ctx, sign) });
  }
  return segs;
}

/** Small + crosshair at a UV point (mode "panels" marker). */
function crosshairSegments(
  pt: AnglePoint,
  groupId: number,
  ctx: ProjCtx,
  size = 0.035,
): CutPreviewSegment[] {
  const segs: CutPreviewSegment[] = [];
  for (const sign of [1, -1] as const) {
    segs.push({
      groupId, normal: ctx.normal,
      a: uvTo3D({ u: pt.u - size, v: pt.v }, ctx, sign),
      b: uvTo3D({ u: pt.u + size, v: pt.v }, ctx, sign),
    });
    segs.push({
      groupId, normal: ctx.normal,
      a: uvTo3D({ u: pt.u, v: pt.v - size }, ctx, sign),
      b: uvTo3D({ u: pt.u, v: pt.v + size }, ctx, sign),
    });
  }
  return segs;
}


/** Draft preview line for mode "line" (point1 → cursor). */
function draftLineSegments(draft: Extract<AngleDraftState, { mode: "line" }>, ctx: ProjCtx): CutPreviewSegment[] {
  const end = draft.cursor;
  if (!end) return [];
  return lineSegments(draft.point1, end, draft.groupId, ctx);
}

// ─── Dihedral angle ───────────────────────────────────────────────────────────

function dihedralDeg(n1: Vec3, n2: Vec3): number {
  const dot = n1.x * n2.x + n1.y * n2.y + n1.z * n2.z;
  const l1 = Math.hypot(n1.x, n1.y, n1.z);
  const l2 = Math.hypot(n2.x, n2.y, n2.z);
  if (l1 < 1e-9 || l2 < 1e-9) return 0;
  const cos = Math.max(-1, Math.min(1, dot / (l1 * l2)));
  return Math.acos(cos) * (180 / Math.PI);
}

// ─── Label placement ──────────────────────────────────────────────────────────

export interface AngleLabelPlacement {
  id: string;
  groupId: number;
  position: Vec3;
  label: string;
  isDraft: boolean;
  /** Angle in degrees for the SVG arc indicator (panels mode only). */
  arcDeg?: number;
  /** Instruction label shown during panels draft (first point placed). */
  isInstruction?: boolean;
}

/** Label for mode "line": sits at midpoint of the line. */
function makeLineLabelPlacement(
  point1: AnglePoint,
  point2: AnglePoint,
  id: string,
  groupId: number,
  ctx: ProjCtx,
  isDraft: boolean,
): AngleLabelPlacement {
  const deg = computeLineDeg(point1, point2);
  const mu = (point1.u + point2.u) / 2;
  const mv = (point1.v + point2.v) / 2;
  const pos = panel2DTo3D(mu, mv, ctx.uAxis, ctx.vAxis, ctx.anchor, ctx.originU, ctx.originV);
  const lift = ctx.bias > 0 ? 0.014 : 0;
  return {
    id, groupId,
    position: {
      x: pos.x + ctx.normal.x * lift,
      y: pos.y + ctx.normal.y * lift,
      z: pos.z + ctx.normal.z * lift,
    },
    label: formatAngleDeg(deg),
    isDraft,
  };
}

/** Label for mode "panels": floats between the two clicked 3D points, with arc indicator. */
function makePanelLabelPlacement(
  m: Extract<UserAngleMeasure, { mode: "panels" }>,
  ctx1: ProjCtx,
  ctx2: ProjCtx,
  isDraft: boolean,
): AngleLabelPlacement {
  const deg = dihedralDeg(ctx1.normal, ctx2.normal);
  const p1 = uvTo3D(m.point1, ctx1, 1);
  const p2 = uvTo3D(m.point2, ctx2, 1);
  return {
    id: m.id,
    groupId: m.groupId1,
    position: {
      x: (p1.x + p2.x) / 2,
      y: (p1.y + p2.y) / 2 + 0.06,
      z: (p1.z + p2.z) / 2,
    },
    label: formatAngleDeg(deg),
    isDraft,
    arcDeg: deg,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function computeAnglePreviewSegments(
  faces: Face3D[],
  groups: GeometryGroup[],
  angleMeasures: UserAngleMeasure[],
  draft: AngleDraftState | null,
  up: UpAxis,
): CutPreviewSegment[] {
  const segs: CutPreviewSegment[] = [];

  for (const m of angleMeasures) {
    if (m.mode === "line") {
      const ctx = getCtx(faces, groups, m.groupId, up);
      if (ctx) segs.push(...lineSegments(m.point1, m.point2, m.groupId, ctx));
    } else {
      const ctx1 = getCtx(faces, groups, m.groupId1, up);
      const ctx2 = getCtx(faces, groups, m.groupId2, up);
      // Crosshairs mark the two clicked points
      if (ctx1) segs.push(...crosshairSegments(m.point1, m.groupId1, ctx1));
      if (ctx2) segs.push(...crosshairSegments(m.point2, m.groupId2, ctx2));
      // A short connection line between the two markers (always-visible via HTML label arc)
      if (ctx1 && ctx2) {
        const p1 = uvTo3D(m.point1, ctx1, 1);
        const p2 = uvTo3D(m.point2, ctx2, 1);
        segs.push({ groupId: m.groupId1, normal: ctx1.normal, a: p1, b: p2 });
      }
    }
  }

  if (draft) {
    if (draft.mode === "line") {
      const ctx = getCtx(faces, groups, draft.groupId, up);
      if (ctx) segs.push(...draftLineSegments(draft, ctx));
    } else {
      // panels draft: show crosshair at the first clicked point
      const ctx1 = getCtx(faces, groups, draft.groupId1, up);
      if (ctx1) segs.push(...crosshairSegments(draft.point1, draft.groupId1, ctx1));
    }
  }

  return segs;
}

export function computeAngleLabelPlacements(
  faces: Face3D[],
  groups: GeometryGroup[],
  angleMeasures: UserAngleMeasure[],
  draft: AngleDraftState | null,
  up: UpAxis,
): AngleLabelPlacement[] {
  const out: AngleLabelPlacement[] = [];

  for (const m of angleMeasures) {
    if (m.mode === "line") {
      const ctx = getCtx(faces, groups, m.groupId, up);
      if (ctx) out.push(makeLineLabelPlacement(m.point1, m.point2, m.id, m.groupId, ctx, false));
    } else {
      const ctx1 = getCtx(faces, groups, m.groupId1, up);
      const ctx2 = getCtx(faces, groups, m.groupId2, up);
      if (ctx1 && ctx2) out.push(makePanelLabelPlacement(m, ctx1, ctx2, false));
    }
  }

  // Live label while placing second point in line mode
  if (draft?.mode === "line" && draft.cursor) {
    const ctx = getCtx(faces, groups, draft.groupId, up);
    if (ctx) out.push(makeLineLabelPlacement(draft.point1, draft.cursor, "__angle_draft__", draft.groupId, ctx, true));
  }

  // Panels draft: show a pulsing instruction badge at the first clicked point
  if (draft?.mode === "panels") {
    const ctx1 = getCtx(faces, groups, draft.groupId1, up);
    if (ctx1) {
      const p1 = uvTo3D(draft.point1, ctx1, 1);
      out.push({
        id: "__panels_draft__",
        groupId: draft.groupId1,
        position: { x: p1.x, y: p1.y + 0.08, z: p1.z },
        label: "Clic en el 2do componente",
        isDraft: true,
        isInstruction: true,
      });
    }
  }

  return out;
}
