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
import { generatePdf } from "./pdf-writer";
import type { Face3D, Facade, FloorPlan, OutputFile, PipelineOptions } from "./types";

export interface PipelineResult {
  facades: Facade[];
  floorPlans: FloorPlan[];
  files: OutputFile[];
  warnings: string[];
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

function scaleFacades(facades: Facade[], s: number): Facade[] {
  if (s === 1.0) return facades;
  return facades.map((f) => ({
    ...f,
    polygons: f.polygons.map((p) => ({
      ...p,
      vertices: p.vertices.map((v) => ({ x: v.x * s, y: v.y * s })),
    })),
    width: f.width * s,
    height: f.height * s,
  }));
}

function scaleFloorPlans(plans: FloorPlan[], s: number): FloorPlan[] {
  if (s === 1.0) return plans;
  return plans.map((p) => ({
    ...p,
    segments: p.segments.map((seg) => ({
      a: { x: seg.a.x * s, y: seg.a.y * s },
      b: { x: seg.b.x * s, y: seg.b.y * s },
      isInterior: seg.isInterior,
    })),
    width: p.width * s,
    height: p.height * s,
    elevation: p.elevation * s,
  }));
}

export function runPipeline(
  fileName: string,
  buffer: ArrayBuffer,
  opts: PipelineOptions,
): PipelineResult {
  const warnings: string[] = [];
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  const stem = fileName.replace(/\.[^.]+$/, "");

  // --- 1. Parse ---
  let faces: Face3D[] = [];

  if (ext === "obj") {
    const text = new TextDecoder("utf-8").decode(buffer);
    const result = parseObj(text);
    faces = result.faces;
    warnings.push(...result.warnings);
  } else {
    warnings.push(`Formato no soportado: .${ext}. Usa .obj.`);
    return { facades: [], floorPlans: [], files: [], warnings };
  }

  if (faces.length === 0) {
    warnings.push("No se encontraron caras en el archivo.");
    return { facades: [], floorPlans: [], files: [], warnings };
  }

  // --- 2. Detect up axis once (shared by facades and floor plans) ---
  const upAxis = detectUpAxis(faces);

  // --- 3. Extract facades ---
  let facades = extractFacades(faces, upAxis);

  // --- 4. Extract floor plans (using same axis as facades) ---
  let floorPlans = extractFloorPlans(faces, upAxis);

  // --- 5. Normalize units ---
  const unitScale = guessUnitScale(faces);
  if (unitScale !== 1.0) {
    facades = scaleFacades(facades, unitScale);
    floorPlans = scaleFloorPlans(floorPlans, unitScale);
  }

  if (facades.length === 0 && floorPlans.length === 0) {
    warnings.push(
      `Se encontraron ${faces.length} caras pero no se pudieron generar vistas. ` +
      "Verificá que el modelo contenga superficies verticales.",
    );
    return { facades, floorPlans, files: [], warnings };
  }

  // --- 6. Generate outputs ---
  const files: OutputFile[] = [];
  const scaleDenom = opts.scaleDenom;

  // DXF: one per facade, one per floor plan.
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

  // PDF: multi-page with all views.
  const pdfContent = generatePdf(facades, floorPlans, scaleDenom, opts.paper);
  if (pdfContent) {
    files.push({
      name: `${stem}_planos.pdf`,
      blob: new Blob([pdfContent], { type: "application/pdf" }),
    });
  }

  // Cutting sheets (plancha de corte).
  if (opts.includeCuttingSheet) {
    const cuttingFiles = generateCuttingSheets(facades);
    for (const cf of cuttingFiles) {
      files.push({
        name: `${stem}_${cf.name}`,
        blob: new Blob([cf.content], { type: "application/dxf" }),
      });
    }
  }

  return { facades, floorPlans, files, warnings };
}
