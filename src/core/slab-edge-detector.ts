// ============================================================================
// Slab Edge Detector
//
// A floor slab modelled in the OBJ is a thin closed plate: a top horizontal
// skin, a bottom horizontal skin, and a ring of thin VERTICAL faces forming its
// edge / thickness band (the "canto"). Those rim faces have a horizontal normal,
// so the per-face classifier tags them as walls. This module recognises them as
// part of the slab so they get absorbed into the floor group instead of becoming
// spurious wall pieces, and measures the slab thickness directly from geometry.
//
// Detection is PER-FACE (not per-subgroup): a whole vertical subgroup may bundle
// a slab rim together with a real wall that is coplanar/edge-connected to it, so
// absorbing subgroups wholesale wrongly drags real walls into the floor. Working
// per-face keeps walls out.
//
// A vertical face is a slab rim iff (all conditions are model-agnostic):
//   1. It is vertical and spans two Y levels [Ymin, Ymax] (t = Ymax - Ymin).
//   2. It is BRACKETED: its top horizontal edge is shared (exact OBJ vertex-index
//      pair, snapped-coord fallback) with an UP-facing horizontal face at Ymax,
//      and its bottom horizontal edge with a DOWN-facing horizontal face at Ymin.
//   3. THIN PLATE: t / skinLat < PLATE_RATIO, where skinLat is the smaller of the
//      two bracketing skins' lateral extent. A slab is intrinsically thin vs its
//      span; a wall (or a room's floor+ceiling) is not.
//   4. WIDE FACE: t / faceHorizLen < FACE_ASPECT (the rim is wider than tall).
//
// Conditions 3-4 are dimensionless aspect ratios — a universal geometric property
// of "a thin, wide plate", not an absolute centimetre threshold. The slab
// thickness is the measured gap t, independent of any wall-thickness constant.
// ============================================================================

import type { Face3D } from "./types";
import { getVertexIndices } from "./types";
import type { Subgroup } from "./group-classifier";

// |n.y| >= this => horizontal face (slab skin). Matches HORIZONTAL_THRESHOLD.
const HORIZONTAL_NORMAL_MIN = 0.98;
// |n.y| <= this => vertical face (rim candidate). Matches VERTICAL_THRESHOLD.
const VERTICAL_NORMAL_MAX = 0.5;
// An edge counts as ~horizontal when |dir.y| / |dir| <= EDGE_DIR_TOL. Derived
// from HORIZONTAL_NORMAL_MIN (same angular tolerance that defines a horizontal
// face): dimensionless, scale-invariant. sqrt(1 - 0.98^2) ≈ 0.199 (~11.5°).
const EDGE_DIR_TOL = Math.sqrt(1 - HORIZONTAL_NORMAL_MIN * HORIZONTAL_NORMAL_MIN);
// Y levels within this band are treated as the same horizontal plane.
const HEIGHT_BAND = 0.05;
// Physics-based hard cap: no architectural floor slab exceeds 1m thickness.
// Thickest real slabs (raft foundations / transfer slabs) ≈ 0.6–1.0m. Rejects
// storey-height faces (2.4–4m) immediately, regardless of building width.
const MAX_SLAB_THICKNESS = 1.0;
// Thin-plate discriminator: slab thickness / skin lateral extent. Real slab rims
// measure ≤~0.08; storey walls on wide buildings ≥~0.23. Conservative threshold
// that prefers false negatives (harmless) over false positives (catastrophic).
const PLATE_RATIO = 0.15;
// The rim face must be wider than tall. Dimensionless; skin-size independent.
const FACE_ASPECT = 0.35;

/** A rim subgroup that should be absorbed into a floor subgroup. */
export interface SlabEdgeLink {
  floorSubgroupIndex: number;
  rimSubgroupIndex: number;
  thickness: number;
}

function snap3(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Edge key matching joint-detector's convention: exact vertex-index pair when
 *  available, else snapped 3D coordinates. */
function edgeKey(
  face: Face3D,
  i: number,
  j: number,
  vi: number[] | undefined,
): string {
  if (vi) return vi[i] < vi[j] ? `${vi[i]}|${vi[j]}` : `${vi[j]}|${vi[i]}`;
  const a = face.vertices[i], b = face.vertices[j];
  const sax = snap3(a.x), say = snap3(a.y), saz = snap3(a.z);
  const sbx = snap3(b.x), sby = snap3(b.y), sbz = snap3(b.z);
  if (sax < sbx || (sax === sbx && (say < sby || (say === sby && saz < sbz)))) {
    return `${sax},${say},${saz}|${sbx},${sby},${sbz}`;
  }
  return `${sbx},${sby},${sbz}|${sax},${say},${saz}`;
}

function faceArea(f: Face3D): number {
  const v = f.vertices;
  if (v.length < 3) return 0;
  let sx = 0, sy = 0, sz = 0;
  for (let i = 1; i < v.length - 1; i++) {
    const e1x = v[i].x - v[0].x, e1y = v[i].y - v[0].y, e1z = v[i].z - v[0].z;
    const e2x = v[i + 1].x - v[0].x, e2y = v[i + 1].y - v[0].y, e2z = v[i + 1].z - v[0].z;
    sx += e1y * e2z - e1z * e2y;
    sy += e1z * e2x - e1x * e2z;
    sz += e1x * e2y - e1y * e2x;
  }
  return 0.5 * Math.sqrt(sx * sx + sy * sy + sz * sz);
}

/** Lateral extent (max of the X / Z bounding-box spans) of a face. */
function lateralExtent(f: Face3D): number {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const v of f.vertices) {
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
    if (v.z < minZ) minZ = v.z;
    if (v.z > maxZ) maxZ = v.z;
  }
  return Math.max(maxX - minX, maxZ - minZ);
}

interface SkinEdge {
  y: number;
  lat: number;
  area: number;
}

/**
 * Per-face detection of floor-slab rim faces.
 *
 * @returns Map of faceIndex -> measured slab thickness (metres) for every face
 *          recognised as a slab edge.
 */
export function findSlabRimFaces(faces: Face3D[]): Map<number, number> {
  // Index every ~horizontal edge of every horizontal face, split by whether the
  // face points up (potential top skin) or down (potential bottom skin). Keep
  // the largest-area face per edge so skinLat reflects the real slab skin.
  const up = new Map<string, SkinEdge>();
  const down = new Map<string, SkinEdge>();
  for (const f of faces) {
    const ny = f.normal.y;
    if (Math.abs(ny) < HORIZONTAL_NORMAL_MIN) continue;
    const area = faceArea(f);
    const lat = lateralExtent(f);
    const vi = getVertexIndices(f);
    const verts = f.vertices;
    const map = ny > 0 ? up : down;
    for (let i = 0; i < verts.length; i++) {
      const j = (i + 1) % verts.length;
      const a = verts[i], b = verts[j];
      const dy = b.y - a.y;
      const len = Math.sqrt((b.x - a.x) ** 2 + dy * dy + (b.z - a.z) ** 2);
      if (len < 1e-9 || Math.abs(dy) / len > EDGE_DIR_TOL) continue;
      const key = edgeKey(f, i, j, vi);
      const y = (a.y + b.y) / 2;
      const existing = map.get(key);
      if (!existing || area > existing.area) map.set(key, { y, lat, area });
    }
  }

  const rim = new Map<number, number>();
  for (let fi = 0; fi < faces.length; fi++) {
    const f = faces[fi];
    if (Math.abs(f.normal.y) > VERTICAL_NORMAL_MAX) continue; // not vertical
    const verts = f.vertices;
    if (verts.length < 3) continue;

    let ymin = Infinity, ymax = -Infinity;
    for (const v of verts) {
      if (v.y < ymin) ymin = v.y;
      if (v.y > ymax) ymax = v.y;
    }
    const t = ymax - ymin;
    if (t <= 1e-3 || t > MAX_SLAB_THICKNESS) continue;

    const vi = getVertexIndices(f);
    let topSkin: SkinEdge | null = null;
    let botSkin: SkinEdge | null = null;
    let maxHorizLen = 0;
    for (let i = 0; i < verts.length; i++) {
      const j = (i + 1) % verts.length;
      const a = verts[i], b = verts[j];
      const dy = b.y - a.y;
      const len = Math.sqrt((b.x - a.x) ** 2 + dy * dy + (b.z - a.z) ** 2);
      if (len < 1e-9 || Math.abs(dy) / len > EDGE_DIR_TOL) continue;
      if (len > maxHorizLen) maxHorizLen = len;
      const key = edgeKey(f, i, j, vi);
      const y = (a.y + b.y) / 2;
      if (Math.abs(y - ymax) < HEIGHT_BAND) {
        const e = up.get(key);
        if (e && (!topSkin || e.area > topSkin.area)) topSkin = e;
      }
      if (Math.abs(y - ymin) < HEIGHT_BAND) {
        const e = down.get(key);
        if (e && (!botSkin || e.area > botSkin.area)) botSkin = e;
      }
    }
    if (!topSkin || !botSkin) continue; // not bracketed by two skins

    const skinLat = Math.min(topSkin.lat, botSkin.lat);
    if (skinLat <= 1e-6) continue;
    if (t / skinLat >= PLATE_RATIO) continue; // not a thin plate
    if (maxHorizLen <= 1e-6 || t / maxHorizLen >= FACE_ASPECT) continue; // not wide

    rim.set(fi, t);
  }
  return rim;
}

/**
 * Link slab-rim subgroups to the floor skins they cap, so they can be merged
 * into one floor group. Rim candidates are restricted to subgroups whose faces
 * are ALL pre-validated rim faces, so no real wall is ever linked.
 *
 * @param subgroups  Subgroups already built by the classifier.
 * @param faces      All faces in the model (Y-up).
 * @param rimFaces   Output of findSlabRimFaces (faceIndex -> thickness).
 */
export function detectSlabEdges(
  subgroups: Subgroup[],
  faces: Face3D[],
  rimFaces: Map<number, number>,
): SlabEdgeLink[] {
  if (rimFaces.size === 0) return [];

  // Partition: horizontal subgroups are potential skins; rim subgroups are those
  // made entirely of pre-validated rim faces.
  const floorIdxs: number[] = [];
  const rimIdxs: number[] = [];
  for (let i = 0; i < subgroups.length; i++) {
    const sg = subgroups[i];
    if (Math.abs(sg.normal.y) >= HORIZONTAL_NORMAL_MIN) {
      floorIdxs.push(i);
    } else if (sg.faceInfos.every((fi) => rimFaces.has(fi.index))) {
      rimIdxs.push(i);
    }
  }
  if (floorIdxs.length === 0 || rimIdxs.length === 0) return [];

  // Index every edge of every floor skin: edgeKey -> floor subgroup index.
  const floorEdge = new Map<string, number>();
  for (const fIdx of floorIdxs) {
    for (const fi of subgroups[fIdx].faceInfos) {
      const face = faces[fi.index];
      const vi = getVertexIndices(face);
      const verts = face.vertices;
      for (let i = 0; i < verts.length; i++) {
        const j = (i + 1) % verts.length;
        floorEdge.set(edgeKey(face, i, j, vi), fIdx);
      }
    }
  }

  const links: SlabEdgeLink[] = [];
  for (const rIdx of rimIdxs) {
    // Thickness of this rim = max measured thickness of its faces.
    let thickness = 0;
    const linkedFloors = new Set<number>();
    for (const fi of subgroups[rIdx].faceInfos) {
      thickness = Math.max(thickness, rimFaces.get(fi.index) ?? 0);
      const face = faces[fi.index];
      const vi = getVertexIndices(face);
      const verts = face.vertices;
      for (let i = 0; i < verts.length; i++) {
        const j = (i + 1) % verts.length;
        const f = floorEdge.get(edgeKey(face, i, j, vi));
        if (f !== undefined) linkedFloors.add(f);
      }
    }
    if (thickness <= 0) continue;
    for (const f of linkedFloors) {
      links.push({ floorSubgroupIndex: f, rimSubgroupIndex: rIdx, thickness });
    }
  }
  return links;
}

/**
 * Validate detected rim faces by grouping them into independent slab candidates
 * and rejecting any candidate that fails plausibility checks. This provides
 * per-piece fault isolation: a bad detection in one part of the model doesn't
 * contaminate valid detections elsewhere.
 *
 * @returns A filtered Map containing only rim faces from valid candidates.
 */
export function validateSlabCandidates(
  rimFaces: Map<number, number>,
  faces: Face3D[],
): Map<number, number> {
  if (rimFaces.size === 0) return rimFaces;

  // Group rim faces into candidates by Y-level band (same [Ymin, Ymax] pair).
  // Each candidate represents one physical slab plate.
  const candidates = new Map<string, { indices: number[]; thicknesses: number[] }>();
  for (const [fi, thickness] of rimFaces) {
    const f = faces[fi];
    let ymin = Infinity, ymax = -Infinity;
    for (const v of f.vertices) {
      if (v.y < ymin) ymin = v.y;
      if (v.y > ymax) ymax = v.y;
    }
    const bandMin = Math.round(ymin / HEIGHT_BAND) * HEIGHT_BAND;
    const bandMax = Math.round(ymax / HEIGHT_BAND) * HEIGHT_BAND;
    const key = `${bandMin}|${bandMax}`;
    const cand = candidates.get(key);
    if (cand) {
      cand.indices.push(fi);
      cand.thicknesses.push(thickness);
    } else {
      candidates.set(key, { indices: [fi], thicknesses: [thickness] });
    }
  }

  // Validate each candidate independently.
  const validated = new Map<number, number>();
  for (const cand of candidates.values()) {
    const maxT = Math.max(...cand.thicknesses);
    const minT = Math.min(...cand.thicknesses);

    // Reject: thickness exceeds physics-based cap (defense in depth).
    if (maxT > MAX_SLAB_THICKNESS) continue;

    // Reject: inconsistent thicknesses within the same candidate indicate
    // contamination (faces from different structures mixed together).
    if (maxT - minT > HEIGHT_BAND * 2) continue;

    // Candidate passes — include all its faces.
    for (let i = 0; i < cand.indices.length; i++) {
      validated.set(cand.indices[i], cand.thicknesses[i]);
    }
  }

  return validated;
}
