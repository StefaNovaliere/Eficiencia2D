import type { Face3D, Vec3 } from "@/core/types";
import type { GeometryGroup } from "@/core/group-classifier";
import { getGroupPanelSize, getGroupProjection } from "@/core/cut-preview";
import type { CutPreviewSegment } from "@/core/cut-preview";
import {
  measurePinnedLabel,
  resolveMeasureDrag,
  type MeasureDragState,
  type MeasureLabelOptions,
  type UserMeasure,
} from "@/core/measure-tool";

type UpAxis = "Y" | "Z";

function dot(a: Vec3, b: Vec3): number {
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
  const au = dot(anchor, uAxis);
  const av = dot(anchor, vAxis);
  const absU = u + originU;
  const absV = v + originV;
  return {
    x: anchor.x + (absU - au) * uAxis.x + (absV - av) * vAxis.x,
    y: anchor.y + (absU - au) * uAxis.y + (absV - av) * vAxis.y,
    z: anchor.z + (absU - au) * uAxis.z + (absV - av) * vAxis.z,
  };
}

function measureRing(state: MeasureDragState): { x: number; y: number }[] {
  const resolved = resolveMeasureDrag(state);
  if (state.kind === "line") {
    return [
      { x: resolved.u0, y: resolved.v0 },
      { x: resolved.u1, y: resolved.v1 },
    ];
  }
  const minU = Math.min(resolved.u0, resolved.u1);
  const maxU = Math.max(resolved.u0, resolved.u1);
  const minV = Math.min(resolved.v0, resolved.v1);
  const maxV = Math.max(resolved.v0, resolved.v1);
  return [
    { x: minU, y: minV },
    { x: maxU, y: minV },
    { x: maxU, y: maxV },
    { x: minU, y: maxV },
    { x: minU, y: minV },
  ];
}

/** UV anchor for the floating label — offset beside the measure, not on the cursor. */
function measureLabelUV(state: MeasureDragState): { u: number; v: number } {
  const resolved = resolveMeasureDrag(state);
  if (state.kind === "line") {
    const mu = (resolved.u0 + resolved.u1) / 2;
    const mv = (resolved.v0 + resolved.v1) / 2;
    const du = resolved.u1 - resolved.u0;
    const dv = resolved.v1 - resolved.v0;
    const len = Math.hypot(du, dv);
    if (len < 0.02) return { u: mu, v: mv };
    const offset = 0.14;
    return { u: mu + (-dv / len) * offset, v: mv + (du / len) * offset };
  }
  const minU = Math.min(resolved.u0, resolved.u1);
  const maxU = Math.max(resolved.u0, resolved.u1);
  const minV = Math.min(resolved.v0, resolved.v1);
  const maxV = Math.max(resolved.v0, resolved.v1);
  return { u: (minU + maxU) / 2 + 0.1, v: (minV + maxV) / 2 + 0.1 };
}

export interface MeasureLabelPlacement {
  id: string;
  groupId: number;
  /** Model-space position (before viewer center offset). */
  position: Vec3;
  label: string;
  isDraft: boolean;
}

function segmentsForMeasure(
  faces: Face3D[],
  groups: GeometryGroup[],
  measure: MeasureDragState,
  up: UpAxis,
): CutPreviewSegment[] {
  const group = groups.find((g) => g.id === measure.groupId);
  if (!group) return [];

  const groupFaces = group.faceIndices
    .map((fi) => faces[fi])
    .filter((f): f is Face3D => !!f && f.vertices.length >= 3);
  if (groupFaces.length === 0) return [];

  const proj = getGroupProjection(faces, group, up);
  if (!proj) return [];

  const anchor = groupFaces[0].vertices[0];
  const { uAxis, vAxis, normal, originU, originV } = proj;
  const ring = measureRing(measure);
  const segments: CutPreviewSegment[] = [];

  const nlen = Math.hypot(normal.x, normal.y, normal.z);
  const bias = nlen > 1e-6 ? 0.006 : 0;

  const to3 = (p: { x: number; y: number }, sign: 1 | -1): Vec3 => {
    const w = panel2DTo3D(p.x, p.y, uAxis, vAxis, anchor, originU, originV);
    return {
      x: w.x + normal.x * bias * sign,
      y: w.y + normal.y * bias * sign,
      z: w.z + normal.z * bias * sign,
    };
  };

  if (measure.kind === "line") {
    for (const sign of [1, -1] as const) {
      segments.push({
        groupId: measure.groupId,
        normal,
        a: to3(ring[0], sign),
        b: to3(ring[1], sign),
      });
    }
    return segments;
  }

  for (let i = 0; i + 1 < ring.length; i++) {
    for (const sign of [1, -1] as const) {
      segments.push({
        groupId: measure.groupId,
        normal,
        a: to3(ring[i], sign),
        b: to3(ring[i + 1], sign),
      });
    }
  }

  return segments;
}

function placementForMeasure(
  faces: Face3D[],
  groups: GeometryGroup[],
  measure: MeasureDragState & { id: string },
  up: UpAxis,
  isDraft: boolean,
  labelOptions: MeasureLabelOptions,
): MeasureLabelPlacement | null {
  const group = groups.find((g) => g.id === measure.groupId);
  if (!group) return null;

  const groupFaces = group.faceIndices
    .map((fi) => faces[fi])
    .filter((f): f is Face3D => !!f && f.vertices.length >= 3);
  if (groupFaces.length === 0) return null;

  const proj = getGroupProjection(faces, group, up);
  if (!proj) return null;

  const anchor = groupFaces[0].vertices[0];
  const { uAxis, vAxis, normal, originU, originV } = proj;
  const labelUv = measureLabelUV(measure);
  const pos = panel2DTo3D(labelUv.u, labelUv.v, uAxis, vAxis, anchor, originU, originV);
  const nlen = Math.hypot(normal.x, normal.y, normal.z);
  const lift = nlen > 1e-6 ? 0.012 : 0;

  return {
    id: measure.id,
    groupId: measure.groupId,
    position: {
      x: pos.x + normal.x * lift,
      y: pos.y + normal.y * lift,
      z: pos.z + normal.z * lift,
    },
    label: measurePinnedLabel(measure, labelOptions),
    isDraft,
  };
}

export function computeMeasurePreviewSegments(
  faces: Face3D[],
  groups: GeometryGroup[],
  measures: UserMeasure[],
  draft: MeasureDragState | null,
  up: UpAxis,
): CutPreviewSegment[] {
  const segments: CutPreviewSegment[] = [];
  for (const m of measures) {
    segments.push(...segmentsForMeasure(faces, groups, m, up));
  }
  if (draft) {
    segments.push(...segmentsForMeasure(faces, groups, draft, up));
  }
  return segments;
}

export function computeMeasureLabelPlacements(
  faces: Face3D[],
  groups: GeometryGroup[],
  measures: UserMeasure[],
  draft: MeasureDragState | null,
  up: UpAxis,
  labelOptions: MeasureLabelOptions,
): MeasureLabelPlacement[] {
  const out: MeasureLabelPlacement[] = [];
  for (const m of measures) {
    const p = placementForMeasure(faces, groups, m, up, false, labelOptions);
    if (p) out.push(p);
  }
  if (draft) {
    const p = placementForMeasure(
      faces,
      groups,
      { ...draft, id: "__draft__" },
      up,
      true,
      labelOptions,
    );
    if (p) out.push(p);
  }
  return out;
}

export { getGroupPanelSize };
