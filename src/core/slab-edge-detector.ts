// ============================================================================
// Slab Edge Detector
//
// A floor slab modelled in the OBJ is a thin closed plate: a top horizontal
// skin, a bottom horizontal skin, and a ring of thin VERTICAL faces forming
// its edge / thickness band (the "canto"). Those vertical rim faces have a
// horizontal normal, so the per-face classifier tags them as walls. This
// module recognises them as part of the slab so they get absorbed into the
// floor group instead of becoming spurious wall pieces.
//
// Geometric invariant (no hardcoded height threshold):
//   A vertical face is a slab rim iff it is bounded ABOVE and BELOW by
//   horizontal faces of the SAME slab — i.e. one of its horizontal edges is
//   shared with the slab's top skin and the opposite horizontal edge with the
//   bottom skin, and those two skins are the two faces of one thin plate
//   (verified via areThinTwins). A genuine wall sitting on a floor shares only
//   its bottom edge with that floor; its top edge connects to a ceiling or a
//   different-level slab, so it is rejected.
//
// The slab thickness falls out for free as the vertical gap between the two
// skins the rim spans — a measured geometric quantity, not a constant.
// ============================================================================

import type { Face3D } from "./types";
import { getVertexIndices } from "./types";
import { areThinTwins } from "./wall-thickness";
import type { Subgroup } from "./group-classifier";

// |n.y| >= this => horizontal face (slab skin). Matches HORIZONTAL_THRESHOLD
// used by the per-face classifier.
const HORIZONTAL_NORMAL_MIN = 0.98;
// |n.y| <= this => vertical face (rim candidate). Matches VERTICAL_THRESHOLD.
const VERTICAL_NORMAL_MAX = 0.5;
// An edge counts as ~horizontal when |dir.y| / |dir| <= EDGE_DIR_TOL. Derived
// from HORIZONTAL_NORMAL_MIN (the same angular tolerance that defines a
// horizontal face), so it is dimensionless and scale-invariant — not a new
// magic constant. sqrt(1 - 0.98^2) ≈ 0.199 (~11.5°).
const EDGE_DIR_TOL = Math.sqrt(1 - HORIZONTAL_NORMAL_MIN * HORIZONTAL_NORMAL_MIN);
// Search bound for pairing the top/bottom skin of a slab. This is the range in
// which two opposite horizontal faces are considered the two skins of one
// plate, NOT a cutoff for rim-vs-wall (that decision is purely topological).
const MAX_SLAB_THICKNESS = 1.0;

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

/**
 * Detect floor-slab rim subgroups and the floor skins they cap.
 *
 * @param subgroups  Subgroups already built by the classifier (one per
 *                   category + coplanar cluster + connected component).
 * @param faces      All faces in the model (Y-up).
 * @returns          Links pairing each rim subgroup with the floor skin(s) it
 *                   spans, carrying the measured slab thickness.
 */
export function detectSlabEdges(
  subgroups: Subgroup[],
  faces: Face3D[],
): SlabEdgeLink[] {
  // Partition by orientation of the cluster normal. Horizontal subgroups are
  // potential slab skins (include `discard` ones: a thin bottom skin may have
  // been demoted by the level-area filter). Vertical subgroups are rim
  // candidates.
  const floorIdxs: number[] = [];
  const rimIdxs: number[] = [];
  for (let i = 0; i < subgroups.length; i++) {
    const ny = Math.abs(subgroups[i].normal.y);
    if (ny >= HORIZONTAL_NORMAL_MIN) floorIdxs.push(i);
    else if (ny <= VERTICAL_NORMAL_MAX) rimIdxs.push(i);
  }
  if (floorIdxs.length === 0 || rimIdxs.length === 0) return [];

  // Index every ~horizontal edge of every floor skin: key -> matches, where
  // each match records the floor subgroup and the edge's elevation.
  const floorEdges = new Map<string, Array<{ sg: number; y: number }>>();
  for (const fIdx of floorIdxs) {
    for (const fi of subgroups[fIdx].faceInfos) {
      const face = faces[fi.index];
      const verts = face.vertices;
      const vi = getVertexIndices(face);
      for (let i = 0; i < verts.length; i++) {
        const j = (i + 1) % verts.length;
        const a = verts[i], b = verts[j];
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (len < 1e-9) continue;
        if (Math.abs(dy) / len > EDGE_DIR_TOL) continue; // not horizontal
        const key = edgeKey(face, i, j, vi);
        const y = (a.y + b.y) / 2;
        const arr = floorEdges.get(key);
        if (arr) arr.push({ sg: fIdx, y });
        else floorEdges.set(key, [{ sg: fIdx, y }]);
      }
    }
  }

  const links: SlabEdgeLink[] = [];
  for (const rIdx of rimIdxs) {
    // Collect, at the subgroup level (handles triangulated rims), the highest
    // and lowest floor skins this rim's horizontal edges are shared with.
    let topY = -Infinity, botY = Infinity;
    let topSg = -1, botSg = -1;
    for (const fi of subgroups[rIdx].faceInfos) {
      const face = faces[fi.index];
      const verts = face.vertices;
      const vi = getVertexIndices(face);
      for (let i = 0; i < verts.length; i++) {
        const j = (i + 1) % verts.length;
        const a = verts[i], b = verts[j];
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (len < 1e-9) continue;
        if (Math.abs(dy) / len > EDGE_DIR_TOL) continue; // not horizontal
        const matches = floorEdges.get(edgeKey(face, i, j, vi));
        if (!matches) continue;
        for (const m of matches) {
          if (m.y > topY) { topY = m.y; topSg = m.sg; }
          if (m.y < botY) { botY = m.y; botSg = m.sg; }
        }
      }
    }
    // Must be bracketed by skins at two distinct elevations (top + bottom).
    if (topSg < 0 || botSg < 0 || topSg === botSg) continue;
    const thickness = topY - botY;
    if (thickness <= 1e-4) continue;

    // Slab-consistency check (the rim-vs-wall discriminator): the two skins
    // must be the two faces of one thin plate. A genuine wall fails here.
    if (areThinTwins(subgroups[topSg], subgroups[botSg], MAX_SLAB_THICKNESS) === null) {
      continue;
    }

    links.push({ floorSubgroupIndex: topSg, rimSubgroupIndex: rIdx, thickness });
    links.push({ floorSubgroupIndex: botSg, rimSubgroupIndex: rIdx, thickness });
  }
  return links;
}
