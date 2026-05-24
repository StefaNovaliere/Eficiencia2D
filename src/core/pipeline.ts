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
import { generateFacadeDxf, generateFloorPlanDxf } from "./dxf-writer";
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
    return { faces: [], groups: [], stem, warnings };
  }

  if (faces.length === 0) {
    warnings.push("No se encontraron caras en el archivo.");
    return { faces: [], groups: [], stem, warnings };
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

  if (detectedUp === "Z") {
    faces = faces.map((f) => ({
      ...f,
      vertices: f.vertices.map((v) => ({ x: v.x, y: v.z, z: -v.y })),
      normal: { x: f.normal.x, y: f.normal.z, z: -f.normal.y },
      innerLoops: f.innerLoops.map((loop) =>
        loop.map((v) => ({ x: v.x, y: v.z, z: -v.y })),
      ),
    }));
  }

  // Classify into reviewable groups.
  const groups = classifyIntoGroups(faces);

  return { faces, groups, stem, warnings };
}

/**
 * Phase 2: Generate outputs from (potentially user-corrected) classification.
 */
export function generatePipeline(
  phase1: Phase1Result,
  opts: PipelineOptions,
  overrides?: ClassificationOverride[],
): PipelineResult {
  const warnings = [...phase1.warnings];
  const stem = phase1.stem;
  let faces = phase1.faces;
  const upAxis: "Y" | "Z" = "Y";

  // Apply overrides: remove faces in groups reclassified as "discard".
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
      faces = faces.filter((_, i) => !discardIndices.has(i));
    }
  }

  // Extract facades & floor plans.
  const facades = extractFacades(faces, upAxis);
  const floorPlans = extractFloorPlans(faces, upAxis);

  if (facades.length === 0 && floorPlans.length === 0) {
    warnings.push(
      `Se encontraron ${faces.length} caras pero no se pudieron generar vistas. ` +
      "Verificá que el modelo contenga superficies verticales.",
    );
    return { facades, floorPlans, files: [], warnings };
  }

  const files: OutputFile[] = [];
  const scaleDenom = opts.scaleDenom;

  for (const facade of facades) {
    const dxfText = generateFacadeDxf(facade, scaleDenom);
    const safeLabel = facade.label.replace(/\s+/g, "_");
    files.push({
      name: `${stem}_${safeLabel}.dxf`,
      blob: new Blob([dxfText], { type: "application/dxf" }),
    });
  }

  for (const plan of floorPlans) {
    const dxfText = generateFloorPlanDxf(plan, scaleDenom);
    const safeLabel = plan.label.replace(/\s+/g, "_");
    files.push({
      name: `${stem}_${safeLabel}.dxf`,
      blob: new Blob([dxfText], { type: "application/dxf" }),
    });
  }

  const pdfContent = generatePdf(facades, floorPlans, scaleDenom, opts.paper);
  if (pdfContent) {
    files.push({
      name: `${stem}_planos.pdf`,
      blob: new Blob([pdfContent], { type: "application/pdf" }),
    });
  }

  if (opts.includeCuttingSheet) {
    const filteredFaces = classifyAndFilter(faces, opts.elementFilter ?? DEFAULT_ELEMENT_FILTER);
    const cuttingFiles = generateCuttingSheets(filteredFaces, upAxis, scaleDenom, opts.decompositionMode);
    for (const cf of cuttingFiles) {
      files.push({
        name: `${stem}_${cf.name}`,
        blob: new Blob([cf.content], { type: "application/dxf" }),
      });
    }
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
