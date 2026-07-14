/**
 * 3D geometry for the angle measurement tool.
 * Produces line segments (two rays + arc) and a floating label placement.
 */

import type { Face3D, Vec3 } from "@/core/types";
import type { GeometryGroup } from "@/core/group-classifier";
import { getGroupProjection } from "@/core/cut-preview";
import type { CutPreviewSegment } from "@/core/cut-preview";
import {
  computeAngleDeg,
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

function raysAndArcSegments(
  vertex: AnglePoint,
  arm1: AnglePoint,
  arm2: AnglePoint,
  groupId: number,
  ctx: ProjCtx,
): CutPreviewSegment[] {
  const segs: CutPreviewSegment[] = [];

  for (const sign of [1, -1] as const) {
    const v3 = uvTo3D(vertex, ctx, sign);
    const a3 = uvTo3D(arm1, ctx, sign);
    const b3 = uvTo3D(arm2, ctx, sign);

    // Ray 1: vertex → arm1
    segs.push({ groupId, normal: ctx.normal, a: v3, b: a3 });
    // Ray 2: vertex → arm2
    segs.push({ groupId, normal: ctx.normal, a: v3, b: b3 });

    // Arc at 35 % of the shorter arm length
    const r1 = Math.hypot(arm1.u - vertex.u, arm1.v - vertex.v);
    const r2 = Math.hypot(arm2.u - vertex.u, arm2.v - vertex.v);
    const arcRadius = Math.min(r1, r2) * 0.35;

    if (arcRadius > 0.008) {
      const angle1 = Math.atan2(arm1.v - vertex.v, arm1.u - vertex.u);
      const angle2 = Math.atan2(arm2.v - vertex.v, arm2.u - vertex.u);

      // Choose the smaller of the two possible arcs
      let da = angle2 - angle1;
      if (da > Math.PI) da -= 2 * Math.PI;
      if (da < -Math.PI) da += 2 * Math.PI;

      const STEPS = 20;
      let prev: Vec3 | null = null;
      for (let i = 0; i <= STEPS; i++) {
        const t = i / STEPS;
        const ang = angle1 + da * t;
        const pu = vertex.u + Math.cos(ang) * arcRadius;
        const pv = vertex.v + Math.sin(ang) * arcRadius;
        const p3 = uvTo3D({ u: pu, v: pv }, ctx, sign);
        if (prev) segs.push({ groupId, normal: ctx.normal, a: prev, b: p3 });
        prev = p3;
      }
    }
  }

  return segs;
}

function draftSegments(draft: AngleDraftState, ctx: ProjCtx): CutPreviewSegment[] {
  const segs: CutPreviewSegment[] = [];
  const end1 = draft.arm1 ?? draft.cursor;
  if (!end1) return segs;

  for (const sign of [1, -1] as const) {
    const v3 = uvTo3D(draft.vertex, ctx, sign);
    segs.push({ groupId: draft.groupId, normal: ctx.normal, a: v3, b: uvTo3D(end1, ctx, sign) });
    if (draft.arm1 && draft.cursor) {
      segs.push({ groupId: draft.groupId, normal: ctx.normal, a: v3, b: uvTo3D(draft.cursor, ctx, sign) });
    }
  }

  return segs;
}

// ─── Label placement ──────────────────────────────────────────────────────────

export interface AngleLabelPlacement {
  id: string;
  groupId: number;
  position: Vec3;
  label: string;
  isDraft: boolean;
}

function makeLabelPlacement(
  vertex: AnglePoint,
  arm1: AnglePoint,
  arm2: AnglePoint,
  id: string,
  groupId: number,
  ctx: ProjCtx,
  isDraft: boolean,
): AngleLabelPlacement {
  const deg = computeAngleDeg(vertex, arm1, arm2);

  const angle1 = Math.atan2(arm1.v - vertex.v, arm1.u - vertex.u);
  const angle2 = Math.atan2(arm2.v - vertex.v, arm2.u - vertex.u);
  let da = angle2 - angle1;
  if (da > Math.PI) da -= 2 * Math.PI;
  if (da < -Math.PI) da += 2 * Math.PI;
  const bisector = angle1 + da / 2;

  const r1 = Math.hypot(arm1.u - vertex.u, arm1.v - vertex.v);
  const r2 = Math.hypot(arm2.u - vertex.u, arm2.v - vertex.v);
  const labelDist = Math.min(r1, r2) * 0.5 + 0.1;

  const lu = vertex.u + Math.cos(bisector) * labelDist;
  const lv = vertex.v + Math.sin(bisector) * labelDist;
  const pos = panel2DTo3D(lu, lv, ctx.uAxis, ctx.vAxis, ctx.anchor, ctx.originU, ctx.originV);
  const lift = ctx.bias > 0 ? 0.014 : 0;

  return {
    id,
    groupId,
    position: {
      x: pos.x + ctx.normal.x * lift,
      y: pos.y + ctx.normal.y * lift,
      z: pos.z + ctx.normal.z * lift,
    },
    label: formatAngleDeg(deg),
    isDraft,
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
    const ctx = getCtx(faces, groups, m.groupId, up);
    if (ctx) segs.push(...raysAndArcSegments(m.vertex, m.arm1, m.arm2, m.groupId, ctx));
  }

  if (draft) {
    const ctx = getCtx(faces, groups, draft.groupId, up);
    if (ctx) segs.push(...draftSegments(draft, ctx));
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
    const ctx = getCtx(faces, groups, m.groupId, up);
    if (ctx) out.push(makeLabelPlacement(m.vertex, m.arm1, m.arm2, m.id, m.groupId, ctx, false));
  }

  // Show draft label once both arm1 and cursor are known (2nd phase)
  if (draft?.arm1 && draft.cursor) {
    const ctx = getCtx(faces, groups, draft.groupId, up);
    if (ctx) {
      out.push(makeLabelPlacement(draft.vertex, draft.arm1, draft.cursor, "__angle_draft__", draft.groupId, ctx, true));
    }
  }

  return out;
}
