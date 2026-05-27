// ============================================================================
// Processing Pipeline
//
// Orchestrates the full flow entirely in the browser:
//   File (ArrayBuffer) → Parser → FacadeExtractor + FloorPlanExtractor
//                       → DXF/PDF Writers → OutputFile[]
// ============================================================================

import { parseObj } from "./obj-parser";
import { generateCuttingSheets, decomposeIntoPanels, nestedSheetsToDxf } from "./cutting-sheet";
import type { Panel } from "./cutting-sheet";
import { detectUpAxis, extractFacades } from "./facade-extractor";
import { extractFloorPlans } from "./floor-plan-extractor";
import { DEFAULT_ELEMENT_FILTER } from "./geometry-classifier";
import { classifyIntoGroups } from "./group-classifier";
import type { GeometryGroup } from "./group-classifier";
import { generatePdf } from "./pdf-writer";
import { nestPanels, DEFAULT_SHEET } from "./sheet-nester";
import type { NestingPanel, NestingResult } from "./sheet-nester";
import type { Face3D, Facade, FloorPlan, OutputFile, PipelineOptions, SheetConfig } from "./types";

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
  stem: string;
  warnings: string[];
}

export interface ClassificationOverride {
  groupId: number;
  newCategory: GeometryGroup["category"];
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
  const groups = classifyIntoGroups(faces, minRealArea);
  return { ...phase1, faces, appliedAxis: newAxis, groups };
}

/** Re-classify with a different minimum-real-area threshold, keeping the current axis. */
export function reclassifyWithMinArea(
  phase1: Phase1Result,
  minRealArea: number,
): Phase1Result {
  const groups = classifyIntoGroups(phase1.faces, minRealArea);
  return { ...phase1, groups };
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
    return { faces: [], rawFaces: [], appliedAxis: "Y", groups: [], stem, warnings };
  }

  if (faces.length === 0) {
    warnings.push("No se encontraron caras en el archivo.");
    return { faces: [], rawFaces: [], appliedAxis: "Y", groups: [], stem, warnings };
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

  // Classify into reviewable groups.
  const groups = classifyIntoGroups(faces);

  return { faces, rawFaces, appliedAxis: detectedUp, groups, stem, warnings };
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
  const wallEnabled = filter.wallsExterior || filter.wallsInterior;
  const filteredFaces: typeof phase1.faces = [];
  for (let i = 0; i < phase1.faces.length; i++) {
    const cat = faceCategoryMap.get(i);
    if (!cat || cat === "discard") continue;
    if (cat === "floor" && !filter.floors) continue;
    if (cat === "wall_exterior" && !filter.wallsExterior) continue;
    if (cat === "wall_interior" && !filter.wallsInterior) continue;
    if (cat === "wall" && !wallEnabled) continue;
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
  const wallEnabled = filter.wallsExterior || filter.wallsInterior;
  const result: Face3D[] = [];
  for (let i = 0; i < phase1.faces.length; i++) {
    const cat = faceCategoryMap.get(i);
    if (!cat || cat === "discard") continue;
    if (cat === "floor" && !filter.floors) continue;
    if (cat === "wall_exterior" && !filter.wallsExterior) continue;
    if (cat === "wall_interior" && !filter.wallsInterior) continue;
    if (cat === "wall" && !wallEnabled) continue;
    result.push(phase1.faces[i]);
  }
  return result;
}

export function decomposePanels(
  phase1: Phase1Result,
  opts: PipelineOptions,
  overrides?: ClassificationOverride[],
): DecomposeResult {
  const filteredFaces = filterFaces(phase1, overrides);
  const simpleMode = (opts.decompositionMode ?? "simple") === "simple";
  const panels = decomposeIntoPanels(filteredFaces, "Y", simpleMode, opts.minAreaM2 ?? 0.01);

  return {
    wallPanels: panels.filter((p) => p.category === "wall"),
    floorPanels: panels.filter((p) => p.category === "floor"),
  };
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
    files.push({
      name: `${stem}_Paredes_corte.dxf`,
      blob: new Blob([nestedSheetsToDxf(nesting.wallNesting, false)], { type: "application/dxf" }),
    });
  }

  if (nesting.floorNesting.sheets.length > 0) {
    files.push({
      name: `${stem}_Pisos_con_referencias.dxf`,
      blob: new Blob([nestedSheetsToDxf(nesting.floorNesting, true)], { type: "application/dxf" }),
    });
    files.push({
      name: `${stem}_Pisos_corte.dxf`,
      blob: new Blob([nestedSheetsToDxf(nesting.floorNesting, false)], { type: "application/dxf" }),
    });
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
