// ============================================================================
// Processing Pipeline
//
// Orchestrates the full flow:
//   File (ArrayBuffer) → Parser → WallExtractor → DXF/PDF Writers → Blobs
//
// Runs entirely in the browser.  No server call required.
// ============================================================================

import { parseSkp } from "./skp-parser";
import { parseObj } from "./obj-parser";
import { extractWalls } from "./wall-extractor";
import { generateDxf } from "./dxf-writer";
import { generatePdf } from "./pdf-writer";
import type { Face3D, OutputFile, PipelineOptions, Wall } from "./types";

export interface PipelineResult {
  walls: Wall[];
  files: OutputFile[];
  warnings: string[];
}

/**
 * Run the full processing pipeline on a file.
 *
 * @param fileName  Original filename (used to detect format and name outputs).
 * @param buffer    Raw file contents as ArrayBuffer.
 * @param opts      Scale, paper, and format options.
 */
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

  if (ext === "skp") {
    const result = parseSkp(buffer);
    faces = result.faces;
    warnings.push(...result.warnings);
  } else if (ext === "obj") {
    const text = new TextDecoder("utf-8").decode(buffer);
    const result = parseObj(text);
    faces = result.faces;
    warnings.push(...result.warnings);
  } else {
    warnings.push(`Unsupported file format: .${ext}. Use .skp or .obj.`);
    return { walls: [], files: [], warnings };
  }

  if (faces.length === 0) {
    return { walls: [], files: [], warnings };
  }

  // --- 2. Extract walls ---
  const walls = extractWalls(faces);

  if (walls.length === 0) {
    warnings.push(
      `Found ${faces.length} face(s) but none qualified as walls. ` +
      "Check that the model contains vertical surfaces larger than 1.5 m²."
    );
    return { walls, files: [], warnings };
  }

  // --- 3. Generate outputs ---
  const files: OutputFile[] = [];

  if (opts.formats.includes("dxf")) {
    const dxfText = generateDxf(walls, opts.scaleDenom);
    files.push({
      name: `${stem}.dxf`,
      blob: new Blob([dxfText], { type: "application/dxf" }),
    });
  }

  if (opts.formats.includes("pdf")) {
    const pdfContent = generatePdf(walls, opts.scaleDenom, opts.paper);
    files.push({
      name: `${stem}.pdf`,
      blob: new Blob([pdfContent], { type: "application/pdf" }),
    });
  }

  return { walls, files, warnings };
}
