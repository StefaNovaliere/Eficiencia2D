// ============================================================================
// PDF Writer
//
// Generates a minimal, self-contained PDF from projected Wall[] data.
// No external dependencies — writes raw PDF operators.
//
// Paper sizes: A3 (420×297 mm), A1 (841×594 mm).
// Walls are drawn with solid strokes; openings with dashes.
// Dimension annotations use built-in Helvetica.
// ============================================================================

import type { Wall } from "./types";

const PAPERS: Record<string, { w: number; h: number }> = {
  A3: { w: 420, h: 297 },
  A1: { w: 841, h: 594 },
};

/** Convert metres to PDF points at a given scale denominator. */
function mToPts(m: number, scaleDenom: number): number {
  return (m / scaleDenom) * 1000 * (72 / 25.4);
}

function buildContent(walls: Wall[], scaleDenom: number, paper: string): string {
  const pSize = PAPERS[paper] ?? PAPERS.A3;
  const pageH = pSize.h * (72 / 25.4);
  const margin = 30;
  const gap = mToPts(1.5, scaleDenom);

  let cs = "";
  let cursorX = margin;
  const fontSize = 8;

  for (const wall of walls) {
    const wPts = mToPts(wall.width, scaleDenom);
    const hPts = mToPts(wall.height, scaleDenom);
    const baseY = (pageH - hPts) / 2;

    const tx = (vx: number) => cursorX + mToPts(vx, scaleDenom);
    const ty = (vy: number) => baseY + mToPts(vy, scaleDenom);

    // Outer boundary (solid).
    cs += "0.3 w\n";
    const ov = wall.outer.vertices;
    if (ov.length > 0) {
      cs += `${tx(ov[0].x).toFixed(4)} ${ty(ov[0].y).toFixed(4)} m\n`;
      for (let i = 1; i < ov.length; i++) {
        cs += `${tx(ov[i].x).toFixed(4)} ${ty(ov[i].y).toFixed(4)} l\n`;
      }
      cs += "s\n";
    }

    // Openings (dashed).
    cs += "[4 2] 0 d\n";
    for (const opening of wall.openings) {
      const iv = opening.vertices;
      if (iv.length === 0) continue;
      cs += `${tx(iv[0].x).toFixed(4)} ${ty(iv[0].y).toFixed(4)} m\n`;
      for (let i = 1; i < iv.length; i++) {
        cs += `${tx(iv[i].x).toFixed(4)} ${ty(iv[i].y).toFixed(4)} l\n`;
      }
      cs += "s\n";
    }
    cs += "[] 0 d\n";

    // Wall label.
    cs += "BT\n";
    cs += `/F1 ${fontSize} Tf\n`;
    cs += `${(cursorX + wPts / 2).toFixed(2)} ${(baseY + hPts + 12).toFixed(2)} Td\n`;
    cs += `(${wall.label}) Tj\n`;
    cs += "ET\n";

    // Width dimension.
    cs += "BT\n";
    cs += `/F1 ${fontSize} Tf\n`;
    cs += `${(cursorX + wPts / 2).toFixed(2)} ${(baseY - 14).toFixed(2)} Td\n`;
    cs += `(${wall.width.toFixed(2)} m) Tj\n`;
    cs += "ET\n";

    // Height dimension.
    cs += "BT\n";
    cs += `/F1 ${fontSize} Tf\n`;
    cs += `${(cursorX + wPts + 6).toFixed(2)} ${(baseY + hPts / 2).toFixed(2)} Td\n`;
    cs += `(${wall.height.toFixed(2)} m) Tj\n`;
    cs += "ET\n";

    cursorX += wPts + gap;
  }

  return cs;
}

export function generatePdf(walls: Wall[], scaleDenom: number, paper: string): string {
  const pSize = PAPERS[paper] ?? PAPERS.A3;
  const pw = (pSize.w * 72 / 25.4).toFixed(2);
  const ph = (pSize.h * 72 / 25.4).toFixed(2);

  const content = buildContent(walls, scaleDenom, paper);

  // Build PDF byte-by-byte so we can compute xref offsets.
  const parts: string[] = [];
  const offsets: number[] = [];
  let cursor = 0;

  const emit = (s: string) => { parts.push(s); cursor += s.length; };

  emit("%PDF-1.4\n");

  // Object 1: Catalog
  offsets.push(cursor);
  emit("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  // Object 2: Pages
  offsets.push(cursor);
  emit("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");

  // Object 3: Page
  offsets.push(cursor);
  emit(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n`);

  // Object 4: Content stream
  offsets.push(cursor);
  emit(`4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`);

  // Object 5: Font
  offsets.push(cursor);
  emit("5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n");

  // Xref
  const xrefOff = cursor;
  emit(`xref\n0 ${offsets.length + 1}\n`);
  emit("0000000000 65535 f \n");
  for (const off of offsets) {
    emit(`${String(off).padStart(10, "0")} 00000 n \n`);
  }

  // Trailer
  emit(`trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\n`);
  emit(`startxref\n${xrefOff}\n%%EOF\n`);

  return parts.join("");
}
