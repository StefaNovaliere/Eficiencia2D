// ============================================================================
// Processing Pipeline
//
// Orchestrates the full flow entirely in the browser:
//   File (ArrayBuffer) → Parser → FacadeExtractor + FloorPlanExtractor
//                       → DXF/PDF Writers → OutputFile[]
// ============================================================================

import { parseObj } from "./obj-parser";
import { generateCuttingSheets } from "./cutting-sheet";
import { detectUpAxis, extractFacades } from "./facade-extractor";
import { extractFloorPlans } from "./floor-plan-extractor";
import { classifyAndFilter, DEFAULT_ELEMENT_FILTER } from "./geometry-classifier";
import { classifyIntoGroups } from "./group-classifier";
import type { GeometryGroup } from "./group-classifier";
import { generatePdf } from "./pdf-writer";
import type { Face3D, Facade, FloorPlan, OutputFile, PipelineOptions } from "./types";

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
): Phase1Result {
  let faces = phase1.rawFaces;
  if (newAxis === "Z") {
    faces = rotateZtoY(faces);
  }
  const groups = classifyIntoGroups(faces);
  return { ...phase1, faces, appliedAxis: newAxis, groups };
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

  // Faces filtered by user overrides — only used for cutting sheets.
  let facesForCutting = phase1.faces;
  if (overrides && overrides.length > 0) {
    const overrideMap = new Map(overrides.map((o) => [o.groupId, o.newCategory]));
    const discardIndices = new Set<number>();

    for (const group of phase1.groups) {
      const newCat = overrideMap.get(group.id) ?? group.category;
      if (newCat === "discard") {
        for (const idx of group.faceIndices) discardIndices.add(idx);
      }
    }

    if (discardIndices.size > 0) {
      facesForCutting = phase1.faces.filter((_, i) => !discardIndices.has(i));
    }
  }

  // PDF is built from the ORIGINAL faces (overrides do not affect it).
  const facades = extractFacades(phase1.faces, upAxis);
  const floorPlans = extractFloorPlans(phase1.faces, upAxis);

  const files: OutputFile[] = [];
  const scaleDenom = opts.scaleDenom;

  // Cutting sheets — use overridden faces.
  const filteredFaces = classifyAndFilter(
    facesForCutting,
    opts.elementFilter ?? DEFAULT_ELEMENT_FILTER,
  );
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

/** Full pipeline in one shot (backward compatible). */
export function runPipeline(
  fileName: string,
  buffer: ArrayBuffer,
  opts: PipelineOptions,
): PipelineResult {
  const phase1 = parsePipeline(fileName, buffer);
  return generatePipeline(phase1, opts);
}
