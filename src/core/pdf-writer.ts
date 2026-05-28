// ============================================================================
// PDF Writer
//
// Generates a multi-page PDF:
//   - One page per facade elevation
//   - One page per floor plan (with door symbols in gray dashed arcs)
//
// Paper: always A4 for facades and floor plans.
// No external dependencies — writes raw PDF operators.
// ============================================================================

import type { Facade, FloorPlan } from "./types";
import type { NestingResult } from "./sheet-nester";
import { rotateEdges } from "./sheet-nester";

const PAPERS: Record<string, { w: number; h: number }> = {
  A4: { w: 297, h: 210 },  // landscape in mm
  A3: { w: 420, h: 297 },
  A1: { w: 841, h: 594 },
};
const MM_TO_PT = 72 / 25.4;

function mToPts(m: number, scaleDenom: number): number {
  return (m / scaleDenom) * 1000 * MM_TO_PT;
}

function buildFacadeContent(
  facade: Facade,
  scaleDenom: number,
  paper: { w: number; h: number } = PAPERS.A4,
): string {
  const pageW = paper.w * MM_TO_PT;
  const pageH = paper.h * MM_TO_PT;
  const margin = 40;
  const fontSize = 10;

  const availW = pageW - 2 * margin;
  const availH = pageH - 2 * margin - 30;

  const facadeWPts = mToPts(facade.width, scaleDenom);
  const facadeHPts = mToPts(facade.height, scaleDenom);

  let fitScale = 1.0;
  if (facadeWPts > availW && facadeWPts > 0)
    fitScale = Math.min(fitScale, availW / facadeWPts);
  if (facadeHPts > availH && facadeHPts > 0)
    fitScale = Math.min(fitScale, availH / facadeHPts);

  const effectiveW = facadeWPts * fitScale;
  const effectiveH = facadeHPts * fitScale;

  const ox = (pageW - effectiveW) / 2;
  const oy = margin + (availH - effectiveH) / 2;

  const tx = (vx: number) => ox + mToPts(vx, scaleDenom) * fitScale;
  const ty = (vy: number) => oy + mToPts(vy, scaleDenom) * fitScale;

  let cs = "";

  // Black stroke for facade lines.
  cs += "0 0 0 RG\n0.4 w\n";
  for (const poly of facade.polygons) {
    const verts = poly.vertices;
    if (verts.length < 2) continue;
    if (verts.length === 2) {
      cs += `${tx(verts[0].x).toFixed(4)} ${ty(verts[0].y).toFixed(4)} m\n`;
      cs += `${tx(verts[1].x).toFixed(4)} ${ty(verts[1].y).toFixed(4)} l\n`;
      cs += "S\n";
    } else {
      cs += `${tx(verts[0].x).toFixed(4)} ${ty(verts[0].y).toFixed(4)} m\n`;
      for (let i = 1; i < verts.length; i++) {
        cs += `${tx(verts[i].x).toFixed(4)} ${ty(verts[i].y).toFixed(4)} l\n`;
      }
      cs += "s\n";
    }
  }

  // Title.
  cs += "BT\n";
  cs += `/F1 ${fontSize + 2} Tf\n`;
  cs += `${(pageW / 2).toFixed(2)} ${(oy + effectiveH + 16).toFixed(2)} Td\n`;
  cs += `(${facade.label}) Tj\n`;
  cs += "ET\n";

  // Width dimension.
  cs += "BT\n";
  cs += `/F1 ${fontSize} Tf\n`;
  cs += `${(pageW / 2).toFixed(2)} ${(oy - 16).toFixed(2)} Td\n`;
  cs += `(${facade.width.toFixed(2)} m) Tj\n`;
  cs += "ET\n";

  // Height dimension.
  cs += "BT\n";
  cs += `/F1 ${fontSize} Tf\n`;
  cs += `${(ox + effectiveW + 8).toFixed(2)} ${(oy + effectiveH / 2).toFixed(2)} Td\n`;
  cs += `(${facade.height.toFixed(2)} m) Tj\n`;
  cs += "ET\n";

  // Scale annotation.
  cs += "BT\n";
  cs += `/F1 ${fontSize - 2} Tf\n`;
  cs += `${(pageW - margin).toFixed(2)} ${(margin / 2).toFixed(2)} Td\n`;
  if (fitScale < 0.999) {
    cs += `(Escala: ajustada para caber en pagina) Tj\n`;
  } else {
    cs += `(Escala: 1:${scaleDenom}) Tj\n`;
  }
  cs += "ET\n";

  return cs;
}

function buildFloorPlanContent(
  plan: FloorPlan,
  scaleDenom: number,
  paper: { w: number; h: number } = PAPERS.A4,
): string {
  const pageW = paper.w * MM_TO_PT;
  const pageH = paper.h * MM_TO_PT;
  const margin = 40;
  const fontSize = 10;

  const availW = pageW - 2 * margin;
  const availH = pageH - 2 * margin - 30;

  const planWPts = mToPts(plan.width, scaleDenom);
  const planHPts = mToPts(plan.height, scaleDenom);

  let fitScale = 1.0;
  if (planWPts > availW && planWPts > 0)
    fitScale = Math.min(fitScale, availW / planWPts);
  if (planHPts > availH && planHPts > 0)
    fitScale = Math.min(fitScale, availH / planHPts);

  const effectiveW = planWPts * fitScale;
  const effectiveH = planHPts * fitScale;

  const ox = (pageW - effectiveW) / 2;
  const oy = margin + (availH - effectiveH) / 2;

  const tx = (vx: number) => ox + mToPts(vx, scaleDenom) * fitScale;
  const ty = (vy: number) => oy + mToPts(vy, scaleDenom) * fitScale;

  let cs = "";

  // Draw wall segments (all black).
  cs += "0 0 0 RG\n0.6 w\n";
  for (const seg of plan.segments) {
    cs += `${tx(seg.a.x).toFixed(4)} ${ty(seg.a.y).toFixed(4)} m\n`;
    cs += `${tx(seg.b.x).toFixed(4)} ${ty(seg.b.y).toFixed(4)} l\n`;
    cs += "S\n";
  }

  // --- Door symbols (gray, thin) ---
  if (plan.doors && plan.doors.length > 0) {
    cs += "0.45 0.45 0.45 RG\n"; // dark gray stroke
    cs += "0.3 w\n";              // thin line

    for (const door of plan.doors) {
      // Swing arc (dashed quarter-circle, approximated with line segments).
      cs += "[3 2] 0 d\n"; // dash pattern
      const steps = 24;
      const startRad = door.startAngle * Math.PI / 180;
      const endRad = door.endAngle * Math.PI / 180;
      let sweepRad = endRad - startRad;
      if (sweepRad < 0) sweepRad += 2 * Math.PI;

      for (let i = 0; i <= steps; i++) {
        const angle = startRad + sweepRad * (i / steps);
        const px = door.hinge.x + door.width * Math.cos(angle);
        const py = door.hinge.y + door.width * Math.sin(angle);
        if (i === 0) {
          cs += `${tx(px).toFixed(4)} ${ty(py).toFixed(4)} m\n`;
        } else {
          cs += `${tx(px).toFixed(4)} ${ty(py).toFixed(4)} l\n`;
        }
      }
      cs += "S\n";

      // Door leaf line (solid — from hinge to open position).
      cs += "[] 0 d\n"; // reset to solid
      cs += `${tx(door.hinge.x).toFixed(4)} ${ty(door.hinge.y).toFixed(4)} m\n`;
      cs += `${tx(door.leafEnd.x).toFixed(4)} ${ty(door.leafEnd.y).toFixed(4)} l\n`;
      cs += "S\n";
    }

    // Reset graphics state for subsequent content.
    cs += "0 0 0 RG\n";
    cs += "0.6 w\n";
    cs += "[] 0 d\n";
  }

  // Title.
  cs += "BT\n";
  cs += `/F1 ${fontSize + 2} Tf\n`;
  cs += `${(pageW / 2).toFixed(2)} ${(oy + effectiveH + 16).toFixed(2)} Td\n`;
  cs += `(${plan.label}) Tj\n`;
  cs += "ET\n";

  // Width dimension.
  cs += "BT\n";
  cs += `/F1 ${fontSize} Tf\n`;
  cs += `${(pageW / 2).toFixed(2)} ${(oy - 16).toFixed(2)} Td\n`;
  cs += `(${plan.width.toFixed(2)} m) Tj\n`;
  cs += "ET\n";

  // Height dimension.
  cs += "BT\n";
  cs += `/F1 ${fontSize} Tf\n`;
  cs += `${(ox + effectiveW + 8).toFixed(2)} ${(oy + effectiveH / 2).toFixed(2)} Td\n`;
  cs += `(${plan.height.toFixed(2)} m) Tj\n`;
  cs += "ET\n";

  // Scale annotation.
  cs += "BT\n";
  cs += `/F1 ${fontSize - 2} Tf\n`;
  cs += `${(pageW - margin).toFixed(2)} ${(margin / 2).toFixed(2)} Td\n`;
  if (fitScale < 0.999) {
    cs += `(Escala: ajustada para caber en pagina) Tj\n`;
  } else {
    cs += `(Escala: 1:${scaleDenom}) Tj\n`;
  }
  cs += "ET\n";

  return cs;
}

export function generatePdf(
  facades: Facade[],
  floorPlans: FloorPlan[],
  scaleDenom: number,
  paperName: string = "A4",
): string {
  const paper = PAPERS[paperName] ?? PAPERS.A4;
  const pw = (paper.w * MM_TO_PT).toFixed(2);
  const ph = (paper.h * MM_TO_PT).toFixed(2);

  const pageContents: string[] = [];

  for (const facade of facades) {
    pageContents.push(buildFacadeContent(facade, scaleDenom, paper));
  }
  for (const plan of floorPlans) {
    pageContents.push(buildFloorPlanContent(plan, scaleDenom, paper));
  }

  if (pageContents.length === 0) return "";

  const numPages = pageContents.length;
  const parts: string[] = [];
  const offsets: number[] = [];
  let cursor = 0;

  const emit = (s: string) => {
    parts.push(s);
    cursor += s.length;
  };

  emit("%PDF-1.4\n");

  // Object 1: Catalog
  offsets.push(cursor);
  emit("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  // Object 2: Pages
  const pageObjIds = Array.from({ length: numPages }, (_, i) => 4 + i * 2);
  const kids = pageObjIds.map((id) => `${id} 0 R`).join(" ");
  offsets.push(cursor);
  emit(
    `2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${numPages} >>\nendobj\n`,
  );

  // Object 3: Font
  offsets.push(cursor);
  emit(
    "3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  );

  // Pages and content streams.
  for (let i = 0; i < numPages; i++) {
    const pageId = 4 + i * 2;
    const streamId = pageId + 1;
    const content = pageContents[i];

    offsets.push(cursor);
    emit(
      `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R ` +
      `/MediaBox [0 0 ${pw} ${ph}] ` +
      `/Contents ${streamId} 0 R ` +
      `/Resources << /Font << /F1 3 0 R >> >> >>\nendobj\n`,
    );

    offsets.push(cursor);
    emit(
      `${streamId} 0 obj\n<< /Length ${content.length} >>\n` +
      `stream\n${content}endstream\nendobj\n`,
    );
  }

  // Xref
  const totalObjs = offsets.length + 1;
  const xrefOff = cursor;
  emit(`xref\n0 ${totalObjs}\n`);
  emit("0000000000 65535 f \n");
  for (const off of offsets) {
    emit(`${String(off).padStart(10, "0")} 00000 n \n`);
  }

  emit(`trailer\n<< /Size ${totalObjs} /Root 1 0 R >>\n`);
  emit(`startxref\n${xrefOff}\n%%EOF\n`);

  return parts.join("");
}

// ---------------------------------------------------------------------------
// Shared PDF assembly — takes page content strings and builds a valid PDF
// ---------------------------------------------------------------------------

function assemblePdf(
  pageContents: string[],
  pageW: number,
  pageH: number,
): string {
  if (pageContents.length === 0) return "";

  const pw = pageW.toFixed(2);
  const ph = pageH.toFixed(2);
  const numPages = pageContents.length;
  const parts: string[] = [];
  const offsets: number[] = [];
  let cursor = 0;

  const emit = (s: string) => {
    parts.push(s);
    cursor += s.length;
  };

  emit("%PDF-1.4\n");

  // Object 1: Catalog
  offsets.push(cursor);
  emit("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  // Object 2: Pages
  const pageObjIds = Array.from({ length: numPages }, (_, i) => 4 + i * 2);
  const kids = pageObjIds.map((id) => `${id} 0 R`).join(" ");
  offsets.push(cursor);
  emit(
    `2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${numPages} >>\nendobj\n`,
  );

  // Object 3: Font
  offsets.push(cursor);
  emit(
    "3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  );

  // Pages and content streams.
  for (let i = 0; i < numPages; i++) {
    const pageId = 4 + i * 2;
    const streamId = pageId + 1;
    const content = pageContents[i];

    offsets.push(cursor);
    emit(
      `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R ` +
      `/MediaBox [0 0 ${pw} ${ph}] ` +
      `/Contents ${streamId} 0 R ` +
      `/Resources << /Font << /F1 3 0 R >> >> >>\nendobj\n`,
    );

    offsets.push(cursor);
    emit(
      `${streamId} 0 obj\n<< /Length ${content.length} >>\n` +
      `stream\n${content}endstream\nendobj\n`,
    );
  }

  // Xref
  const totalObjs = offsets.length + 1;
  const xrefOff = cursor;
  emit(`xref\n0 ${totalObjs}\n`);
  emit("0000000000 65535 f \n");
  for (const off of offsets) {
    emit(`${String(off).padStart(10, "0")} 00000 n \n`);
  }

  emit(`trailer\n<< /Size ${totalObjs} /Root 1 0 R >>\n`);
  emit(`startxref\n${xrefOff}\n%%EOF\n`);

  return parts.join("");
}

// ---------------------------------------------------------------------------
// Nesting PDF — renders nested cutting sheets to PDF
// ---------------------------------------------------------------------------

/** Approximate ratio of character width to text height (monospace-ish). */
const CHAR_W_RATIO_PDF = 0.62;

/** Fixed reference text heights in sheet metres (independent of panel size). */
const LABEL_H_M = 0.008;  // 8mm for panel ID
const DIM_H_M = 0.005;    // 5mm for dimensions

/** Largest height that fits both the panel bounds and a width budget. */
function fitTextHeightPdf(text: string, maxW: number, maxH: number, targetH: number): number {
  if (text.length === 0) return 0;
  const byWidth = (maxW * 0.88) / (text.length * CHAR_W_RATIO_PDF);
  return Math.min(targetH, byWidth, maxH);
}

/** Escape special PDF string characters. */
function pdfEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

export function generateNestingPdf(
  nesting: NestingResult,
  label: string,
  includeText: boolean,
): string {
  const { sheets, config } = nesting;
  if (sheets.length === 0) return "";

  const SHEET_SPACING_M = 0.10;
  const cols = Math.min(sheets.length, 3);
  const rows = Math.ceil(sheets.length / cols);

  // Compute total bounding box of the grid in metres.
  const totalW = cols * config.widthM + (cols - 1) * SHEET_SPACING_M;
  const totalH = rows * config.heightM + (rows - 1) * SHEET_SPACING_M;
  // Add space for sheet labels above each sheet row.
  const sheetLabelSpaceM = 0.04; // 40mm above each row for labels
  const totalHWithLabels = totalH + rows * sheetLabelSpaceM;

  // A3 landscape page dimensions.
  const paper = PAPERS.A3;
  const pageW = paper.w * MM_TO_PT;
  const pageH = paper.h * MM_TO_PT;
  const margin = 40;

  const availW = pageW - 2 * margin;
  const availH = pageH - 2 * margin;

  // Scale factor: metres -> points, fit to page.
  const mToPt = 1000 * MM_TO_PT; // 1m = 1000mm * MM_TO_PT
  const rawW = totalW * mToPt;
  const rawH = totalHWithLabels * mToPt;
  let fitScale = 1.0;
  if (rawW > availW && rawW > 0) fitScale = Math.min(fitScale, availW / rawW);
  if (rawH > availH && rawH > 0) fitScale = Math.min(fitScale, availH / rawH);

  const scale = mToPt * fitScale; // metres -> page points

  // Origin offset to center on page.
  const drawnW = totalW * scale;
  const drawnH = totalHWithLabels * scale;
  const oxPage = margin + (availW - drawnW) / 2;
  const oyPage = margin + (availH - drawnH) / 2;

  // Convert from grid metres (origin at top-left, Y-down for rows) to page points.
  // In the grid, row 0 is at top. In PDF, Y goes up. So we flip Y.
  const tx = (mx: number) => oxPage + mx * scale;
  const ty = (my: number) => oyPage + (totalHWithLabels - my) * scale;

  let cs = "";

  for (let si = 0; si < sheets.length; si++) {
    const col = si % cols;
    const row = Math.floor(si / cols);
    const sx = col * (config.widthM + SHEET_SPACING_M);
    // Each row occupies heightM + sheetLabelSpaceM; top of sheet is after the label space.
    const syTop = row * (config.heightM + SHEET_SPACING_M + sheetLabelSpaceM) + sheetLabelSpaceM;

    // Sheet outline rectangle (black stroke).
    cs += "0 0 0 RG\n0.4 w\n";
    const x0 = sx, y0 = syTop;
    const x1 = sx + config.widthM, y1 = syTop + config.heightM;
    // Draw 4 edges of the rectangle.
    const corners: [number, number][] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    for (let ci = 0; ci < 4; ci++) {
      const [ax, ay] = corners[ci];
      const [bx, by] = corners[(ci + 1) % 4];
      cs += `${tx(ax).toFixed(4)} ${ty(ay).toFixed(4)} m\n`;
      cs += `${tx(bx).toFixed(4)} ${ty(by).toFixed(4)} l\n`;
      cs += "S\n";
    }

    // Sheet label above the sheet.
    const sheetLabel = `Plancha ${si + 1}`;
    const sheetLabelPtSize = 10;
    const labelCx = tx(sx + config.widthM / 2);
    const labelCy = ty(syTop - sheetLabelSpaceM * 0.4);
    cs += "BT\n";
    cs += `0 0 0 rg\n`;
    cs += `/F1 ${sheetLabelPtSize} Tf\n`;
    cs += `${labelCx.toFixed(2)} ${labelCy.toFixed(2)} Td\n`;
    cs += `(${pdfEscape(sheetLabel)}) Tj\n`;
    cs += "ET\n";

    // Draw panels within this sheet.
    for (const placed of sheets[si].panels) {
      const { panel, x, y, rotated, effectiveW, effectiveH } = placed;
      const edges = rotated
        ? rotateEdges(panel.edges, panel.widthM)
        : panel.edges;

      // Panel edges (black stroke).
      cs += "0 0 0 RG\n0.3 w\n";
      for (const edge of edges) {
        const eax = sx + x + edge.a.x;
        const eay = syTop + y + edge.a.y;
        const ebx = sx + x + edge.b.x;
        const eby = syTop + y + edge.b.y;
        cs += `${tx(eax).toFixed(4)} ${ty(eay).toFixed(4)} m\n`;
        cs += `${tx(ebx).toFixed(4)} ${ty(eby).toFixed(4)} l\n`;
        cs += "S\n";
      }

      if (includeText) {
        const pw = effectiveW;
        const ph = effectiveH;
        const panelId = panel.id;
        const realW = effectiveW * nesting.scaleDenom;
        const realH = effectiveH * nesting.scaleDenom;
        const dimText = `${realW.toFixed(2)} x ${realH.toFixed(2)} m`;

        const labelH = fitTextHeightPdf(panelId, pw, ph * 0.45, LABEL_H_M);
        const dimH = fitTextHeightPdf(dimText, pw, ph * 0.30, DIM_H_M);
        const MIN_H = 0.002;

        // Panel ID (blue, centered top area of panel).
        if (labelH >= MIN_H) {
          const labelPtSize = labelH * scale;
          const lcx = tx(sx + x + pw / 2);
          const lcy = ty(syTop + y + ph - labelH * 1.5);
          cs += "BT\n";
          cs += `0 0 1 rg\n`; // blue
          cs += `/F1 ${labelPtSize.toFixed(2)} Tf\n`;
          cs += `${lcx.toFixed(2)} ${lcy.toFixed(2)} Td\n`;
          cs += `(${pdfEscape(panelId)}) Tj\n`;
          cs += "ET\n";
        }

        // Dimension text (gray, centered bottom area of panel).
        if (dimH >= MIN_H && labelH + dimH * 3 < ph) {
          const dimPtSize = dimH * scale;
          const dcx = tx(sx + x + pw / 2);
          const dcy = ty(syTop + y + dimH * 0.6);
          cs += "BT\n";
          cs += `0.5 0.5 0.5 rg\n`; // gray
          cs += `/F1 ${dimPtSize.toFixed(2)} Tf\n`;
          cs += `${dcx.toFixed(2)} ${dcy.toFixed(2)} Td\n`;
          cs += `(${pdfEscape(dimText)}) Tj\n`;
          cs += "ET\n";
        }
      }
    }
  }

  // Title for the whole page.
  cs += "BT\n";
  cs += `0 0 0 rg\n`;
  cs += `/F1 14 Tf\n`;
  cs += `${(pageW / 2).toFixed(2)} ${(pageH - margin / 2 - 4).toFixed(2)} Td\n`;
  cs += `(${pdfEscape(label)}) Tj\n`;
  cs += "ET\n";

  return assemblePdf([cs], pageW, pageH);
}
