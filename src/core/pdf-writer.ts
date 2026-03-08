// ============================================================================
// PDF Writer
//
// Generates a multi-page PDF:
//   - One page per facade elevation
//   - One page per floor plan (with interior walls in red, exterior in black)
//
// Paper: always A4 for facades and floor plans.
// No external dependencies — writes raw PDF operators.
// ============================================================================

import type { Facade, FloorPlan } from "./types";

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
