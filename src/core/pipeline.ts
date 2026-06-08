// ============================================================================
// Processing Pipeline
//
// Orchestrates the full flow entirely in the browser:
//   File (ArrayBuffer) → Parser → FacadeExtractor + FloorPlanExtractor
//                       → DXF/PDF Writers → OutputFile[]
// ============================================================================

import { parseObj } from "./obj-parser";
import { generateCuttingSheets, decomposeIntoPanels, nestedSheetsToDxf, projectFacesTo2D, clipPanelAtV, clipPanelAtU, mirrorEdgesHorizontal } from "./cutting-sheet";
import type { Panel, PanelCategory } from "./cutting-sheet";
import { detectUpAxis, extractFacades } from "./facade-extractor";
import { extractFloorPlans } from "./floor-plan-extractor";
import { DEFAULT_ELEMENT_FILTER } from "./geometry-classifier";
import { classifyIntoGroups, peelBuriedWalls, polishGroups, DEFAULT_MIN_REAL_AREA } from "./group-classifier";
import type { GeometryGroup } from "./group-classifier";
import { generatePdf, generateNestingPdf } from "./pdf-writer";
import { nestPanels, DEFAULT_SHEET } from "./sheet-nester";
import type { NestingPanel, NestingResult } from "./sheet-nester";
import type { Face3D, Facade, FloorPlan, OutputFile, PipelineOptions, SheetConfig, Vec3 } from "./types";
import { dot } from "./types";
import { detectJoints } from "./joint-detector";
import type { Joint } from "./joint-detector";
import { computeAdjustments } from "./assembly-adjuster";
import type { DimensionAdjustment, WallWallJoint } from "./assembly-adjuster";
import { splitWallGroupsAtFloors } from "./mesh-splitter";

export interface PipelineResult {
  facades: Facade[];
  floorPlans: FloorPlan[];
  files: OutputFile[];
  warnings: string[];
}

export interface Phase1Result {
  faces: Face3D[];
  rawFaces: Face3D[];
  appliedAxis: "Y" | "Z";
  groups: GeometryGroup[];
  joints: Joint[];
  adjustments: DimensionAdjustment[];
  wallWallJoints: WallWallJoint[];
  stem: string;
  warnings: string[];
  preSplitFaceCount: number;
  suggestedMerges: number[][];
}

export interface ClassificationOverride {
  groupId: number;
  newCategory: GeometryGroup["category"];
}

// ---------------------------------------------------------------------------
// Coplanar merge helpers
// ---------------------------------------------------------------------------

class UnionFind {
  parent: number[];
  rank: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = new Array(n).fill(0);
  }
  find(x: number): number {
    if (this.parent[x] !== x) this.parent[x] = this.find(this.parent[x]);
    return this.parent[x];
  }
  union(a: number, b: number) {
    const ra = this.find(a), rb = this.find(b);
    if (ra === rb) return;
    if (this.rank[ra] < this.rank[rb]) this.parent[ra] = rb;
    else if (this.rank[ra] > this.rank[rb]) this.parent[rb] = ra;
    else { this.parent[rb] = ra; this.rank[ra]++; }
  }
}

function floorElevationsFromGroups(groups: GeometryGroup[]): number[] {
  const elevations: number[] = [];
  for (const g of groups) {
    if (g.category !== "floor") continue;
    if (Math.abs(g.representativeNormal.y) < 0.75) continue;
    if (g.minY != null && g.maxY != null) {
      elevations.push((g.minY + g.maxY) / 2);
    }
  }
  return elevations;
}

function isFloorBetween(gA: GeometryGroup, gB: GeometryGroup, floorElevations: number[]): boolean {
  if (gA.minY == null || gA.maxY == null || gB.minY == null || gB.maxY == null) return false;
  if (floorElevations.length === 0) return false;

  const midA = (gA.minY + gA.maxY) / 2;
  const midB = (gB.minY + gB.maxY) / 2;
  const lo = Math.min(midA, midB);
  const hi = Math.max(midA, midB);

  if (hi - lo < 0.05) return false;

  for (const elev of floorElevations) {
    if (elev >= lo && elev <= hi) return true;
  }

  return false;
}

/**
 * Suggest sets of coplanar wall groups that should be merged because one is a
 * tiny sliver (< 15% area of its neighbor). Uses union-find over joints with
 * near-zero dihedral angle between wall groups.
 *
 * Walls separated by a floor slab are never merged, even if coplanar.
 */
export function suggestCoplanarMerges(
  groups: GeometryGroup[],
  joints: Joint[],
): number[][] {
  const idxById = new Map<number, number>();
  for (let i = 0; i < groups.length; i++) idxById.set(groups[i].id, i);

  const floorElevs = floorElevationsFromGroups(groups);
  const uf = new UnionFind(groups.length);

  for (const joint of joints) {
    const iA = idxById.get(joint.groupA);
    const iB = idxById.get(joint.groupB);
    if (iA == null || iB == null) continue;

    const gA = groups[iA], gB = groups[iB];
    if (gA.category !== "wall" || gB.category !== "wall") continue;
    if (joint.dihedralAngle > 10) continue;

    const areaA = gA.totalArea, areaB = gB.totalArea;
    const minArea = Math.min(areaA, areaB);
    const maxArea = Math.max(areaA, areaB);
    if (maxArea < 0.001) continue;
    if (minArea / maxArea >= 0.15) continue;

    if (isFloorBetween(gA, gB, floorElevs)) continue;

    uf.union(iA, iB);
  }

  const components = new Map<number, number[]>();
  for (let i = 0; i < groups.length; i++) {
    const root = uf.find(i);
    const arr = components.get(root);
    if (arr) arr.push(groups[i].id);
    else components.set(root, [groups[i].id]);
  }

  const result: number[][] = [];
  for (const ids of components.values()) {
    if (ids.length >= 2) result.push(ids);
  }
  return result;
}

/**
 * Check whether a set of groups are coplanar (parallel normals, close plane
 * offsets). Used by the UI to validate manual merge requests.
 */
export function areGroupsCoplanar(groups: GeometryGroup[]): boolean {
  if (groups.length < 2) return false;
  const ref = groups[0].representativeNormal;
  for (let i = 1; i < groups.length; i++) {
    const n = groups[i].representativeNormal;
    const d = Math.abs(
      ref.x * n.x + ref.y * n.y + ref.z * n.z,
    );
    if (d < 0.985) return false;
  }
  // Check plane offsets are close.
  const offsets = groups.map((g) => {
    const n = g.representativeNormal;
    return n.x * g.centroid.x + n.y * g.centroid.y + n.z * g.centroid.z;
  });
  const refOff = offsets[0];
  for (let i = 1; i < offsets.length; i++) {
    if (Math.abs(offsets[i] - refOff) > 0.15) return false;
  }
  return true;
}

/**
 * Check whether groups can be merged: coplanar AND no floor slab between any pair.
 */
export function canMergeGroups(selected: GeometryGroup[], allGroups: GeometryGroup[]): boolean {
  if (!areGroupsCoplanar(selected)) return false;
  const floorElevs = floorElevationsFromGroups(allGroups);
  if (floorElevs.length === 0) return true;
  for (let i = 0; i < selected.length; i++) {
    for (let j = i + 1; j < selected.length; j++) {
      if (isFloorBetween(selected[i], selected[j], floorElevs)) return false;
    }
  }
  return true;
}

/**
 * Apply a set of merges to a Phase1Result. Each merge-set combines multiple
 * groups into one survivor (the member with the largest area). Re-runs joint
 * detection and adjustment computation on the merged topology.
 */
export function applyMerges(
  phase1: Phase1Result,
  merges: number[][],
): Phase1Result {
  if (merges.length === 0) return phase1;

  const groupById = new Map<number, GeometryGroup>();
  for (const g of phase1.groups) groupById.set(g.id, g);

  // Build a map from absorbed-ID → survivor-ID.
  const absorbedTo = new Map<number, number>();
  const mergedGroupIds = new Set<number>();

  for (const mergeSet of merges) {
    const members = mergeSet
      .map((id) => groupById.get(id))
      .filter((g): g is GeometryGroup => g != null && g.category !== "discard");
    if (members.length < 2) continue;

    // Survivor = largest area.
    let survivor = members[0];
    for (let i = 1; i < members.length; i++) {
      if (members[i].totalArea > survivor.totalArea) survivor = members[i];
    }

    const combinedFaceIndices: number[] = [];
    let totalArea = 0;
    let cx = 0, cy = 0, cz = 0, areaSum = 0;
    let minY: number | undefined;
    let maxY: number | undefined;

    for (const m of members) {
      combinedFaceIndices.push(...m.faceIndices);
      totalArea += m.totalArea;
      cx += m.centroid.x * m.totalArea;
      cy += m.centroid.y * m.totalArea;
      cz += m.centroid.z * m.totalArea;
      areaSum += m.totalArea;
      if (m.minY != null) minY = minY == null ? m.minY : Math.min(minY, m.minY);
      if (m.maxY != null) maxY = maxY == null ? m.maxY : Math.max(maxY, m.maxY);

      if (m.id !== survivor.id) {
        absorbedTo.set(m.id, survivor.id);
        mergedGroupIds.add(m.id);
      }
    }

    const centroid = areaSum > 0
      ? { x: cx / areaSum, y: cy / areaSum, z: cz / areaSum }
      : survivor.centroid;

    // Mutate survivor in the map with combined metadata.
    groupById.set(survivor.id, {
      ...survivor,
      faceIndices: combinedFaceIndices,
      totalArea,
      centroid,
      minY,
      maxY,
    });
  }

  // Build new groups array: keep non-absorbed groups.
  const newGroups = phase1.groups
    .filter((g) => !mergedGroupIds.has(g.id))
    .map((g) => groupById.get(g.id) ?? g);

  // Re-run joint detection + adjustments on merged topology.
  const joints = detectJoints(phase1.faces, newGroups);
  const { adjustments, wallWallJoints } = computeAdjustments(joints, newGroups, undefined, phase1.faces);

  // Re-run merge suggestions on the new topology.
  const suggestedMerges = suggestCoplanarMerges(newGroups, joints);

  return {
    ...phase1,
    groups: newGroups,
    joints,
    adjustments,
    wallWallJoints,
    suggestedMerges,
  };
}

/** Guess a conversion factor to bring coordinates into meters. */
function guessUnitScale(faces: Face3D[]): number {
  if (faces.length === 0) return 1.0;

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  const limit = Math.min(faces.length, 500);
  for (let i = 0; i < limit; i++) {
    for (const v of faces[i].vertices) {
      if (v.x < minX) minX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.z < minZ) minZ = v.z;
      if (v.x > maxX) maxX = v.x;
      if (v.y > maxY) maxY = v.y;
      if (v.z > maxZ) maxZ = v.z;
    }
  }

  const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  if (span <= 0) return 1.0;
  if (span <= 100) return 1.0;       // already in meters
  if (span <= 1000) return 0.01;     // centimeters → meters
  if (span <= 50000) return 0.001;   // millimeters → meters
  return (1.0 / span) * 20.0;       // unknown large → normalize
}

function rotateZtoY(faces: Face3D[]): Face3D[] {
  return faces.map((f) => ({
    ...f,
    vertices: f.vertices.map((v) => ({ x: v.x, y: v.z, z: -v.y })),
    normal: { x: f.normal.x, y: f.normal.z, z: -f.normal.y },
    innerLoops: f.innerLoops.map((loop) =>
      loop.map((v) => ({ x: v.x, y: v.z, z: -v.y })),
    ),
  }));
}

/**
 * Re-classify with a different up-axis assumption.
 * Reuses the stored rawFaces (post-unit-scale, pre-rotation).
 */
export function reclassifyWithAxis(
  phase1: Phase1Result,
  newAxis: "Y" | "Z",
  minRealArea?: number,
): Phase1Result {
  let faces = phase1.rawFaces;
  if (newAxis === "Z") {
    faces = rotateZtoY(faces);
  }
  const warnings = [...phase1.warnings];
  const groups = peelBuriedWalls(faces, classifyIntoGroups(faces, minRealArea, warnings));

  const preSplitFaceCount = faces.length;
  const split = splitWallGroupsAtFloors(faces, groups, new Map(), "Y", minRealArea ?? DEFAULT_MIN_REAL_AREA);
  polishGroups(split.groups, minRealArea ?? DEFAULT_MIN_REAL_AREA);

  const joints = detectJoints(split.faces, split.groups);
  const { adjustments, wallWallJoints } = computeAdjustments(joints, split.groups, undefined, split.faces);
  const suggestedMerges = suggestCoplanarMerges(split.groups, joints);
  return { ...phase1, faces: split.faces, appliedAxis: newAxis, groups: split.groups, joints, adjustments, wallWallJoints, warnings, preSplitFaceCount, suggestedMerges };
}

/** Re-classify with a different minimum-real-area threshold, keeping the current axis. */
export function reclassifyWithMinArea(
  phase1: Phase1Result,
  minRealArea: number,
): Phase1Result {
  const warnings = [...phase1.warnings];
  // Truncate back to pre-split faces to avoid re-classifying stale split data.
  const baseFaces = phase1.faces.slice(0, phase1.preSplitFaceCount);

  const groups = peelBuriedWalls(baseFaces, classifyIntoGroups(baseFaces, minRealArea, warnings));

  const preSplitFaceCount = baseFaces.length;
  const split = splitWallGroupsAtFloors(baseFaces, groups, new Map(), "Y", minRealArea);
  polishGroups(split.groups, minRealArea);

  const joints = detectJoints(split.faces, split.groups);
  const { adjustments, wallWallJoints } = computeAdjustments(joints, split.groups, undefined, split.faces);
  const suggestedMerges = suggestCoplanarMerges(split.groups, joints);
  return { ...phase1, faces: split.faces, groups: split.groups, joints, adjustments, wallWallJoints, warnings, preSplitFaceCount, suggestedMerges };
}

/**
 * Phase 1: Parse, normalise units/axis, and classify into groups.
 * Returns geometry + groups ready for the review screen.
 */
export function parsePipeline(
  fileName: string,
  buffer: ArrayBuffer,
): Phase1Result {
  const warnings: string[] = [];
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  const stem = fileName.replace(/\.[^.]+$/, "");

  let faces: Face3D[] = [];

  if (ext === "obj") {
    const text = new TextDecoder("utf-8").decode(buffer);
    const result = parseObj(text);
    faces = result.faces;
    warnings.push(...result.warnings);
  } else {
    warnings.push(`Formato no soportado: .${ext}. Usa .obj.`);
    return { faces: [], rawFaces: [], appliedAxis: "Y", groups: [], joints: [], adjustments: [], wallWallJoints: [], stem, warnings, preSplitFaceCount: 0, suggestedMerges: [] };
  }

  if (faces.length === 0) {
    warnings.push("No se encontraron caras en el archivo.");
    return { faces: [], rawFaces: [], appliedAxis: "Y", groups: [], joints: [], adjustments: [], wallWallJoints: [], stem, warnings, preSplitFaceCount: 0, suggestedMerges: [] };
  }

  // Normalise units.
  const unitScale = guessUnitScale(faces);
  if (unitScale !== 1.0) {
    faces = faces.map((f) => ({
      ...f,
      vertices: f.vertices.map((v) => ({
        x: v.x * unitScale,
        y: v.y * unitScale,
        z: v.z * unitScale,
      })),
      innerLoops: f.innerLoops.map((loop) =>
        loop.map((v) => ({
          x: v.x * unitScale,
          y: v.y * unitScale,
          z: v.z * unitScale,
        })),
      ),
    }));
  }

  // Detect up axis and normalise to Y-up.
  const detectedUp = detectUpAxis(faces);
  const rawFaces = faces;

  if (detectedUp === "Z") {
    faces = rotateZtoY(faces);
  }

  // Classify into reviewable groups, then peel any real walls that were
  // wrongly absorbed into floor groups (buried verticals).
  const groups = peelBuriedWalls(faces, classifyIntoGroups(faces, undefined, warnings));

  // Split walls that extend through floor slabs into separate sub-groups.
  const preSplitFaceCount = faces.length;
  const split = splitWallGroupsAtFloors(faces, groups, new Map(), "Y", DEFAULT_MIN_REAL_AREA);
  polishGroups(split.groups, DEFAULT_MIN_REAL_AREA);

  // Detect joints and compute assembly adjustments on the (possibly split) groups.
  const joints = detectJoints(split.faces, split.groups);
  const { adjustments, wallWallJoints } = computeAdjustments(joints, split.groups, undefined, split.faces);
  const suggestedMerges = suggestCoplanarMerges(split.groups, joints);

  return { faces: split.faces, rawFaces, appliedAxis: detectedUp, groups: split.groups, joints, adjustments, wallWallJoints, stem, warnings, preSplitFaceCount, suggestedMerges };
}

/**
 * Phase 2: Generate outputs from (potentially user-corrected) classification.
 *
 * The ZIP contains only:
 *   - Descomposicion_Paredes.dxf  (uses user overrides)
 *   - Descomposicion_Pisos.dxf    (uses user overrides)
 *   - {stem}_planos.pdf           (uses the original auto-classification)
 */
export function generatePipeline(
  phase1: Phase1Result,
  opts: PipelineOptions,
  overrides?: ClassificationOverride[],
): PipelineResult {
  const warnings = [...phase1.warnings];
  const stem = phase1.stem;
  const upAxis: "Y" | "Z" = "Y";

  // Build the effective face → category map from groups + user overrides.
  // The review-screen classification is the source of truth for the cutting
  // sheet, so promoting a default-discard component back to "floor" / "wall"
  // actually adds it to the output (and demoting works symmetrically).
  const overrideMap = new Map<number, GeometryGroup["category"]>();
  if (overrides) {
    for (const o of overrides) overrideMap.set(o.groupId, o.newCategory);
  }
  const faceCategoryMap = new Map<number, GeometryGroup["category"]>();
  for (const group of phase1.groups) {
    const effective = overrideMap.get(group.id) ?? group.category;
    for (const fi of group.faceIndices) faceCategoryMap.set(fi, effective);
  }

  const filter = opts.elementFilter ?? DEFAULT_ELEMENT_FILTER;
  const filteredFaces: typeof phase1.faces = [];
  for (let i = 0; i < phase1.faces.length; i++) {
    const cat = faceCategoryMap.get(i);
    if (!cat || cat === "discard") continue;
    if (cat === "floor" && !filter.floors) continue;
    if (cat === "wall" && !filter.walls) continue;
    filteredFaces.push(phase1.faces[i]);
  }

  // PDF is built from the ORIGINAL faces (overrides do not affect it).
  const facades = extractFacades(phase1.faces, upAxis);
  const floorPlans = extractFloorPlans(phase1.faces, upAxis);

  const files: OutputFile[] = [];
  const scaleDenom = opts.scaleDenom;

  const cuttingFiles = generateCuttingSheets(
    filteredFaces,
    upAxis,
    scaleDenom,
    opts.decompositionMode,
  );
  for (const cf of cuttingFiles) {
    files.push({
      name: `${stem}_${cf.name}`,
      blob: new Blob([cf.content], { type: "application/dxf" }),
    });
  }

  // Combined PDF with all auto-detected views.
  const pdfContent = generatePdf(facades, floorPlans, scaleDenom, opts.paper);
  if (pdfContent) {
    files.push({
      name: `${stem}_planos.pdf`,
      blob: new Blob([pdfContent], { type: "application/pdf" }),
    });
  }

  if (files.length === 0) {
    warnings.push(
      `Se encontraron ${phase1.faces.length} caras pero no se pudieron generar archivos. ` +
      "Verificá que el modelo contenga superficies válidas.",
    );
  }

  return { facades, floorPlans, files, warnings };
}

// ---------------------------------------------------------------------------
// Decompose + Nest: intermediate step between review and generation
// ---------------------------------------------------------------------------

export interface DecomposeResult {
  wallPanels: Panel[];
  floorPanels: Panel[];
}

export interface NestingPreviewData {
  wallNesting: NestingResult;
  floorNesting: NestingResult;
  config: SheetConfig;
}

function filterFaces(
  phase1: Phase1Result,
  overrides?: ClassificationOverride[],
): Face3D[] {
  const overrideMap = new Map<number, GeometryGroup["category"]>();
  if (overrides) {
    for (const o of overrides) overrideMap.set(o.groupId, o.newCategory);
  }
  const faceCategoryMap = new Map<number, GeometryGroup["category"]>();
  for (const group of phase1.groups) {
    const effective = overrideMap.get(group.id) ?? group.category;
    for (const fi of group.faceIndices) faceCategoryMap.set(fi, effective);
  }

  const filter = DEFAULT_ELEMENT_FILTER;
  const result: Face3D[] = [];
  for (let i = 0; i < phase1.faces.length; i++) {
    const cat = faceCategoryMap.get(i);
    if (!cat || cat === "discard") continue;
    if (cat === "floor" && !filter.floors) continue;
    if (cat === "wall" && !filter.walls) continue;
    result.push(phase1.faces[i]);
  }
  return result;
}

export function decomposePanels(
  phase1: Phase1Result,
  opts: PipelineOptions,
  overrides?: ClassificationOverride[],
  wallWallDecisions?: Map<number, number>,
): DecomposeResult {
  const overrideMap = new Map<number, GeometryGroup["category"]>();
  if (overrides) {
    for (const o of overrides) overrideMap.set(o.groupId, o.newCategory);
  }

  // Resolve wall-wall joints: start from each joint's safe default (thinner
  // wall yields) and let the user's explicit decisions override it, so even
  // an untouched model never produces overlapping pieces.
  const effectiveDecisions = new Map<number, number>();
  for (const ww of phase1.wallWallJoints) {
    if (ww.suggestedYieldGroupId != null) {
      effectiveDecisions.set(ww.jointIndex, ww.suggestedYieldGroupId);
    }
  }
  if (wallWallDecisions) {
    for (const [jointIndex, yieldGroupId] of wallWallDecisions) {
      effectiveDecisions.set(jointIndex, yieldGroupId);
    }
  }

  // Recompute adjustments with the resolved wall-wall decisions. This keeps the
  // automatic wall-on-floor compensation AND adds the chosen wall-wall yields.
  const { adjustments } = computeAdjustments(phase1.joints, phase1.groups, effectiveDecisions, phase1.faces);

  // Build adjustment lookups per group, separated by axis.
  const heightAdjByGroup = new Map<number, number>();
  const widthAdjsByGroup = new Map<number, DimensionAdjustment[]>();
  for (const adj of adjustments) {
    if (adj.axis === "height") {
      const prev = heightAdjByGroup.get(adj.groupId) ?? 0;
      heightAdjByGroup.set(adj.groupId, prev + adj.delta);
    } else {
      const arr = widthAdjsByGroup.get(adj.groupId);
      if (arr) arr.push(adj);
      else widthAdjsByGroup.set(adj.groupId, [adj]);
    }
  }

  const wallPanels: Panel[] = [];
  const floorPanels: Panel[] = [];
  let wallCount = 0;
  let floorCount = 0;

  for (const group of phase1.groups) {
    const effectiveCat = overrideMap.get(group.id) ?? group.category;
    if (effectiveCat === "discard") continue;

    const isFloor = effectiveCat === "floor";
    const panelCat: PanelCategory = isFloor ? "floor" : "wall";

    const faces = group.faceIndices.map((fi) => phase1.faces[fi]).filter(Boolean);
    if (faces.length === 0) continue;

    // Each reviewed group becomes exactly ONE piece. Walls are kept whole
    // (no per-floor slicing) — what you see as one component in the 3D viewer
    // is one component in the cutting sheet. If a whole wall is too large for
    // the sheet, the nester flags it as "unplaced" and the user is told to
    // adjust the scale rather than silently fragmenting the piece.
    const faceGroups = [faces];

    // Assembly adjustments for this group.
    const heightDelta = heightAdjByGroup.get(group.id) ?? 0;
    const widthAdjs = widthAdjsByGroup.get(group.id) ?? [];

    for (const segmentFaces of faceGroups) {
      const result = projectFacesTo2D(segmentFaces, group.representativeNormal, "Y");
      if (!result) continue;

      let { widthM, heightM, edges } = result;

      // Skip insignificant geometry before any assembly compensation so that
      // panel A# numbering stays stable regardless of trim decisions.
      if (widthM * heightM < (opts.minAreaM2 ?? 0.01)) continue;

      // Height compensation (wall-floor): remove a strip from the wall's BASE.
      if (heightDelta < 0 && !isFloor) {
        const strip = Math.min(-heightDelta, heightM - 0.01);
        if (strip > 0.001) {
          const baseAtMinV = result.vUp >= 0;
          const clipped = baseAtMinV
            ? clipPanelAtV(edges, strip, true)
            : clipPanelAtV(edges, heightM - strip, false);
          if (clipped) {
            widthM = clipped.widthM;
            heightM = clipped.heightM;
            edges = clipped.edges;
          }
        }
      }

      // Width compensation (wall-wall): remove a strip from the SIDE where
      // this wall meets the other wall. Project the joint's 3D midpoint into
      // the panel's 2D frame to determine left vs right. The panel will be
      // mirrored horizontally AFTER this clip, so we cut from the OPPOSITE
      // side — the mirror flips it back to the correct joint edge.
      for (const wAdj of widthAdjs) {
        if (wAdj.delta >= 0 || isFloor) continue;
        const strip = Math.min(-wAdj.delta, widthM - 0.01);
        if (strip <= 0.001) continue;

        const joint = phase1.joints[wAdj.jointIndex];
        const u = joint ? dot(joint.edgeMid, result.uAxis) - result.originU : 0;
        const jointOnLeft = u < widthM / 2;

        const clipped = jointOnLeft
          ? clipPanelAtU(edges, widthM - strip, false)
          : clipPanelAtU(edges, strip, true);
        if (clipped) {
          widthM = clipped.widthM;
          heightM = clipped.heightM;
          edges = clipped.edges;
        }
      }

      // Mirror every piece horizontally so the laser-burnt face ends up on the
      // INSIDE of the assembled model (each piece is flipped over on assembly).
      edges = mirrorEdgesHorizontal(edges, widthM);

      if (isFloor) {
        floorCount++;
        floorPanels.push({
          id: `B${floorCount}`,
          groupName: `floor_${floorCount}`,
          category: panelCat,
          floorIndex: 0,
          widthM,
          heightM,
          edges,
          sourceGroupId: group.id,
        });
      } else {
        wallCount++;
        wallPanels.push({
          id: `A${wallCount}`,
          groupName: `wall_${wallCount}`,
          category: panelCat,
          floorIndex: 0,
          widthM,
          heightM,
          edges,
          sourceGroupId: group.id,
        });
      }
    }
  }

  return { wallPanels, floorPanels };
}

/**
 * Map each GeometryGroup.id to the DXF panel ID (A#/B#) it produces, deriving
 * the answer from {@link decomposePanels} itself so the UI labels match the
 * cut-sheet exactly — including the groups that decomposePanels silently skips
 * (empty faces, degenerate projection, or area below `minAreaM2`), which would
 * otherwise shift every later A#/B# number out of sync.
 */
export function computePanelIdByGroup(
  phase1: Phase1Result,
  opts: PipelineOptions,
  overrides?: ClassificationOverride[],
  wallWallDecisions?: Map<number, number>,
): Map<number, string> {
  const { wallPanels, floorPanels } = decomposePanels(phase1, opts, overrides, wallWallDecisions);
  const m = new Map<number, string>();
  for (const p of [...wallPanels, ...floorPanels]) {
    m.set(p.sourceGroupId, p.id);
  }
  return m;
}

function panelsToNestingPanels(panels: Panel[], scaleDenom: number): NestingPanel[] {
  const s = 1 / scaleDenom;
  return panels.map((p) => ({
    id: p.id,
    category: p.category,
    widthM: p.widthM * s,
    heightM: p.heightM * s,
    edges: p.edges.map((e) => ({
      a: { x: e.a.x * s, y: e.a.y * s },
      b: { x: e.b.x * s, y: e.b.y * s },
    })),
  }));
}

export function nestDecomposedPanels(
  decomposed: DecomposeResult,
  config?: SheetConfig,
  scaleDenom: number = 1,
): NestingPreviewData {
  const cfg = config ?? DEFAULT_SHEET;
  return {
    wallNesting: nestPanels(
      panelsToNestingPanels(decomposed.wallPanels, scaleDenom),
      cfg,
      scaleDenom,
    ),
    floorNesting: nestPanels(
      panelsToNestingPanels(decomposed.floorPanels, scaleDenom),
      cfg,
      scaleDenom,
    ),
    config: cfg,
  };
}

export function generateFromNesting(
  phase1: Phase1Result,
  nesting: NestingPreviewData,
  opts: PipelineOptions,
): PipelineResult {
  const warnings = [...phase1.warnings];
  const stem = phase1.stem;

  const facades = extractFacades(phase1.faces, "Y");
  const floorPlans = extractFloorPlans(phase1.faces, "Y");

  const files: OutputFile[] = [];
  const scaleDenom = opts.scaleDenom;

  if (nesting.wallNesting.sheets.length > 0) {
    files.push({
      name: `${stem}_Paredes_con_referencias.dxf`,
      blob: new Blob([nestedSheetsToDxf(nesting.wallNesting, true)], { type: "application/dxf" }),
    });
    const wallRefPdf = generateNestingPdf(nesting.wallNesting, "Paredes", true);
    if (wallRefPdf) {
      files.push({
        name: `${stem}_Paredes_con_referencias.pdf`,
        blob: new Blob([wallRefPdf], { type: "application/pdf" }),
      });
    }
    files.push({
      name: `${stem}_Paredes_corte.dxf`,
      blob: new Blob([nestedSheetsToDxf(nesting.wallNesting, false)], { type: "application/dxf" }),
    });
    const wallCutPdf = generateNestingPdf(nesting.wallNesting, "Paredes", false);
    if (wallCutPdf) {
      files.push({
        name: `${stem}_Paredes_corte.pdf`,
        blob: new Blob([wallCutPdf], { type: "application/pdf" }),
      });
    }
  }

  if (nesting.floorNesting.sheets.length > 0) {
    files.push({
      name: `${stem}_Pisos_con_referencias.dxf`,
      blob: new Blob([nestedSheetsToDxf(nesting.floorNesting, true)], { type: "application/dxf" }),
    });
    const floorRefPdf = generateNestingPdf(nesting.floorNesting, "Pisos", true);
    if (floorRefPdf) {
      files.push({
        name: `${stem}_Pisos_con_referencias.pdf`,
        blob: new Blob([floorRefPdf], { type: "application/pdf" }),
      });
    }
    files.push({
      name: `${stem}_Pisos_corte.dxf`,
      blob: new Blob([nestedSheetsToDxf(nesting.floorNesting, false)], { type: "application/dxf" }),
    });
    const floorCutPdf = generateNestingPdf(nesting.floorNesting, "Pisos", false);
    if (floorCutPdf) {
      files.push({
        name: `${stem}_Pisos_corte.pdf`,
        blob: new Blob([floorCutPdf], { type: "application/pdf" }),
      });
    }
  }

  const pdfContent = generatePdf(facades, floorPlans, scaleDenom, opts.paper);
  if (pdfContent) {
    files.push({
      name: `${stem}_planos.pdf`,
      blob: new Blob([pdfContent], { type: "application/pdf" }),
    });
  }

  if (nesting.wallNesting.unplaced.length > 0 || nesting.floorNesting.unplaced.length > 0) {
    const count = nesting.wallNesting.unplaced.length + nesting.floorNesting.unplaced.length;
    warnings.push(
      `${count} componente${count !== 1 ? "s" : ""} no caben en la plancha ` +
      `(${nesting.config.widthM.toFixed(2)} x ${nesting.config.heightM.toFixed(2)} m) ` +
      "y fueron excluidos del DXF.",
    );
  }

  if (files.length === 0) {
    warnings.push(
      `Se encontraron ${phase1.faces.length} caras pero no se pudieron generar archivos. ` +
      "Verificá que el modelo contenga superficies válidas.",
    );
  }

  return { facades, floorPlans, files, warnings };
}

/** Full pipeline in one shot (backward compatible). */
export function runPipeline(
  fileName: string,
  buffer: ArrayBuffer,
  opts: PipelineOptions,
): PipelineResult {
  const phase1 = parsePipeline(fileName, buffer);
  return generatePipeline(phase1, opts);
}
