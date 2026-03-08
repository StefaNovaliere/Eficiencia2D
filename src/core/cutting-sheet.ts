// ============================================================================
// Cutting Sheet — Plancha de Corte
//
// Packs wall panels onto standard cutting sheets (1000 x 600 mm) for laser
// cutting. Each facade is treated as one panel with its bounding-box outline.
//
// Uses a simple shelf-packing algorithm:
//   - Sort panels by height (tallest first)
//   - Place panels left-to-right on each shelf
//   - When a panel doesn't fit, start a new shelf or new sheet
// ============================================================================

import type { Facade, Vec2 } from "./types";

const SHEET_W_MM = 1000;
const SHEET_H_MM = 600;
const PANEL_GAP_MM = 10; // gap between panels

export interface CuttingPanel {
  label: string;
  widthMm: number;
  heightMm: number;
  /** Original facade outline vertices, scaled to mm for the cutting sheet. */
  outline: Vec2[];
}

export interface CuttingSheet {
  index: number;
  panels: Array<{
    panel: CuttingPanel;
    x: number; // placement x in mm
    y: number; // placement y in mm
  }>;
}

/** Convert facades into cutting panels (scaled to model mm). */
function facadesToPanels(facades: Facade[], scaleDenom: number): CuttingPanel[] {
  const toMm = 1000 / scaleDenom; // metres → mm at model scale
  return facades.map((f) => {
    const wMm = f.width * toMm;
    const hMm = f.height * toMm;
    const outline: Vec2[] = [];
    for (const poly of f.polygons) {
      for (const v of poly.vertices) {
        outline.push({ x: v.x * toMm, y: v.y * toMm });
      }
    }
    return {
      label: f.label,
      widthMm: wMm,
      heightMm: hMm,
      outline,
    };
  });
}

/** Pack panels onto sheets using shelf-packing. */
function packPanels(panels: CuttingPanel[]): CuttingSheet[] {
  // Sort by height descending for better packing.
  const sorted = [...panels].sort((a, b) => b.heightMm - a.heightMm);

  const sheets: CuttingSheet[] = [];
  let currentSheet: CuttingSheet = { index: 1, panels: [] };
  let shelfX = 0;
  let shelfY = 0;
  let shelfH = 0;

  for (const panel of sorted) {
    const pw = panel.widthMm + PANEL_GAP_MM;
    const ph = panel.heightMm + PANEL_GAP_MM;

    // Try to fit on current shelf.
    if (shelfX + pw <= SHEET_W_MM && shelfY + ph <= SHEET_H_MM) {
      currentSheet.panels.push({ panel, x: shelfX, y: shelfY });
      shelfX += pw;
      shelfH = Math.max(shelfH, ph);
    } else if (shelfY + shelfH + ph <= SHEET_H_MM) {
      // Start new shelf on same sheet.
      shelfY += shelfH;
      shelfX = 0;
      shelfH = ph;
      currentSheet.panels.push({ panel, x: shelfX, y: shelfY });
      shelfX = pw;
    } else {
      // New sheet.
      if (currentSheet.panels.length > 0) {
        sheets.push(currentSheet);
      }
      currentSheet = { index: sheets.length + 1, panels: [] };
      shelfX = pw;
      shelfY = 0;
      shelfH = ph;
      currentSheet.panels.push({ panel, x: 0, y: 0 });
    }
  }

  if (currentSheet.panels.length > 0) {
    sheets.push(currentSheet);
  }

  return sheets;
}

/** Round to 2 decimal places to avoid long floats in DXF. */
function r(n: number): string {
  return Number(n.toFixed(2)).toString();
}

/** Generate a DXF string for one cutting sheet. */
function sheetToDxf(sheet: CuttingSheet, scaleDenom: number): string {
  const lines: string[] = [
    "0", "SECTION", "2", "HEADER",
    "9", "$ACADVER", "1", "AC1009",
    "0", "ENDSEC",
    "0", "SECTION", "2", "TABLES",
    "0", "TABLE", "2", "LTYPE", "70", "1",
    "0", "LTYPE", "2", "CONTINUOUS", "70", "0", "3", "Solid line", "72", "65", "73", "0", "40", "0.0",
    "0", "ENDTAB",
    "0", "TABLE", "2", "LAYER", "70", "3",
    "0", "LAYER", "2", "SHEET",   "70", "0", "62", "8", "6", "CONTINUOUS",
    "0", "LAYER", "2", "PANELS",  "70", "0", "62", "7", "6", "CONTINUOUS",
    "0", "LAYER", "2", "LABELS",  "70", "0", "62", "5", "6", "CONTINUOUS",
    "0", "ENDTAB",
    "0", "ENDSEC",
    "0", "SECTION", "2", "ENTITIES",
  ];

  // Draw sheet outline.
  const addLine = (x1: number, y1: number, x2: number, y2: number, layer: string) => {
    lines.push("0", "LINE", "8", layer,
      "10", r(x1), "20", r(y1),
      "11", r(x2), "21", r(y2));
  };

  const addText = (x: number, y: number, h: number, text: string, layer: string) => {
    lines.push("0", "TEXT", "8", layer,
      "10", r(x), "20", r(y),
      "40", String(h), "1", text);
  };

  // Sheet border.
  addLine(0, 0, SHEET_W_MM, 0, "SHEET");
  addLine(SHEET_W_MM, 0, SHEET_W_MM, SHEET_H_MM, "SHEET");
  addLine(SHEET_W_MM, SHEET_H_MM, 0, SHEET_H_MM, "SHEET");
  addLine(0, SHEET_H_MM, 0, 0, "SHEET");

  // Draw each panel.
  for (const { panel, x, y } of sheet.panels) {
    // Panel bounding box.
    const px = x;
    const py = y;
    const pw = panel.widthMm;
    const ph = panel.heightMm;

    addLine(px, py, px + pw, py, "PANELS");
    addLine(px + pw, py, px + pw, py + ph, "PANELS");
    addLine(px + pw, py + ph, px, py + ph, "PANELS");
    addLine(px, py + ph, px, py, "PANELS");

    // Panel label.
    addText(px + pw / 2, py + ph / 2, 8, panel.label, "LABELS");

    // Dimensions (real-world, not model-scale).
    const realW = (pw / 1000) * scaleDenom;
    const realH = (ph / 1000) * scaleDenom;
    addText(px + pw / 2, py - 5, 5, `${realW.toFixed(2)} m`, "LABELS");
    addText(px + pw + 3, py + ph / 2, 5, `${realH.toFixed(2)} m`, "LABELS");
  }

  lines.push("0", "ENDSEC", "0", "EOF");
  return lines.join("\r\n") + "\r\n";
}

/** Generate cutting sheet DXFs from facade data at model scale. */
export function generateCuttingSheets(
  facades: Facade[],
  scaleDenom: number,
): Array<{ name: string; content: string }> {
  const panels = facadesToPanels(facades, scaleDenom);
  if (panels.length === 0) return [];

  const sheets = packPanels(panels);
  return sheets.map((sheet) => ({
    name: `Plancha_de_Corte${sheets.length > 1 ? `_${sheet.index}` : ""}.dxf`,
    content: sheetToDxf(sheet, scaleDenom),
  }));
}
