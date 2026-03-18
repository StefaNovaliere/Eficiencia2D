// ============================================================================
// DXF Writer
//
// Generates AutoCAD-compatible DXF files (AC1024 / R2010 with True Color).
//
// Layers (4-layer laser cutting protocol):
//   - CUT_INTERIOR    (green  RGB 0,255,0  / 420=65280)    — interior cuts
//   - ENGRAVE_VECTOR  (blue   RGB 0,0,255  / 420=255)      — titles, annotations
//   - ENGRAVE_RASTER  (black  RGB 0,0,0    / 420=0)        — dimensions
//   - CUT_EXTERIOR    (red    RGB 255,0,0  / 420=16711680) — exterior outlines
// ============================================================================

import type { Facade, FloorPlan } from "./types";

/**
 * Pad a DXF group code to the required width (right-aligned in a 3-char field).
 *   codes 0–9   → "  0" (2 leading spaces)
 *   codes 10–99  → " 10" (1 leading space)
 *   codes 100+   → "420" (no padding)
 */
function padGroupCode(code: string): string {
  if (code.length === 1) return "  " + code;
  if (code.length === 2) return " " + code;
  return code;
}

/**
 * Join an alternating [groupCode, value, groupCode, value, …] array into
 * a DXF-conformant string with padded group codes and \r\n line endings.
 */
function joinDxf(pairs: string[]): string {
  const out: string[] = [];
  for (let i = 0; i < pairs.length; i++) {
    out.push(i % 2 === 0 ? padGroupCode(pairs[i]) : pairs[i]);
  }
  return out.join("\r\n") + "\r\n";
}

/** Layer definitions for the 4-layer laser cutting protocol. */
const LAYERS = [
  { name: "CUT_EXTERIOR",   aci: "1", tc: "16711680" }, // red
  { name: "ENGRAVE_VECTOR", aci: "5", tc: "255" },      // blue
  { name: "ENGRAVE_RASTER", aci: "7", tc: "0" },        // black
  { name: "CUT_INTERIOR",   aci: "3", tc: "65280" },    // green
];

/**
 * Complete TABLES section required by Autodesk Viewer (AC1024 / R2010).
 * Includes: VPORT, LTYPE, LAYER, STYLE, VIEW, UCS, APPID, DIMSTYLE, BLOCK_RECORD.
 */
function dxfTables(layers: Array<{name: string, aci: string, tc: string}>): string {
  const layerDefs = layers.map(l => [
    "  0", "LAYER",
    "  5", Math.floor(Math.random()*0xFFFF).toString(16).toUpperCase(),
    "330", "1",
    "100", "AcDbSymbolTableRecord",
    "100", "AcDbLayerTableRecord",
    "  2", l.name,
    " 70", "0",
    " 62", l.aci,
    "420", l.tc,
    "  6", "Continuous",
    "370", "-3",
  ].join("\r\n")).join("\r\n");
  return [
    "  0", "SECTION",
    "  2", "TABLES",
    // VPORT
    "  0", "TABLE", "  2", "VPORT", "  5", "8", "330", "0",
    "100", "AcDbSymbolTable", " 70", "0",
    "  0", "ENDTAB",
    // LTYPE
    "  0", "TABLE", "  2", "LTYPE", "  5", "2", "330", "0",
    "100", "AcDbSymbolTable", " 70", "1",
    "  0", "LTYPE", "  5", "14", "330", "2",
    "100", "AcDbSymbolTableRecord", "100", "AcDbLinetypeTableRecord",
    "  2", "Continuous", " 70", "0", "  3", "", " 72", "65", " 73", "0", " 40", "0.0",
    "  0", "ENDTAB",
    // LAYER
    "  0", "TABLE", "  2", "LAYER", "  5", "1", "330", "0",
    "100", "AcDbSymbolTable", " 70", String(layers.length),
    layerDefs,
    "  0", "ENDTAB",
    // STYLE
    "  0", "TABLE", "  2", "STYLE", "  5", "5", "330", "0",
    "100", "AcDbSymbolTable", " 70", "1",
    "  0", "STYLE", "  5", "11", "330", "5",
    "100", "AcDbSymbolTableRecord", "100", "AcDbTextStyleTableRecord",
    "  2", "Standard", " 70", "0", " 40", "0.0", " 41", "1.0",
    " 50", "0.0", " 71", "0", " 42", "2.5", "  3", "txt", "  4", "",
    "  0", "ENDTAB",
    // VIEW
    "  0", "TABLE", "  2", "VIEW",  "  5", "7", "330", "0",
    "100", "AcDbSymbolTable", " 70", "0",
    "  0", "ENDTAB",
    // UCS
    "  0", "TABLE", "  2", "UCS",   "  5", "6", "330", "0",
    "100", "AcDbSymbolTable", " 70", "0",
    "  0", "ENDTAB",
    // APPID
    "  0", "TABLE", "  2", "APPID", "  5", "3", "330", "0",
    "100", "AcDbSymbolTable", " 70", "1",
    "  0", "APPID", "  5", "12", "330", "3",
    "100", "AcDbSymbolTableRecord", "100", "AcDbRegAppTableRecord",
    "  2", "ACAD", " 70", "0",
    "  0", "ENDTAB",
    // DIMSTYLE
    "  0", "TABLE", "  2", "DIMSTYLE", "  5", "4", "330", "0",
    "100", "AcDbSymbolTable", " 70", "0",
    "100", "AcDbDimStyleTable",
    "  0", "ENDTAB",
    // BLOCK_RECORD
    "  0", "TABLE", "  2", "BLOCK_RECORD", "  5", "9", "330", "0",
    "100", "AcDbSymbolTable", " 70", "2",
    "  0", "BLOCK_RECORD", "  5", "17", "330", "9",
    "100", "AcDbSymbolTableRecord", "100", "AcDbBlockTableRecord",
    "  2", "*Model_Space", "340", "1A", " 70", "0", "280", "1", "281", "0",
    "  0", "BLOCK_RECORD", "  5", "1B", "330", "9",
    "100", "AcDbSymbolTableRecord", "100", "AcDbBlockTableRecord",
    "  2", "*Paper_Space", "340", "1E", " 70", "0", "280", "1", "281", "0",
    "  0", "ENDTAB",
    "  0", "ENDSEC",
  ].join("\r\n") + "\r\n";
}

/**
 * BLOCKS section required by DXF R2010 — Model_Space + Paper_Space.
 */
function dxfBlocks(): string {
  return [
    "  0", "SECTION",
    "  2", "BLOCKS",
    "  0", "BLOCK", "  5", "1A", "330", "17",
    "100", "AcDbEntity", "  8", "0",
    "100", "AcDbBlockBegin", "  2", "*Model_Space", " 70", "0",
    " 10", "0.0", " 20", "0.0", " 30", "0.0",
    "  3", "*Model_Space", "  1", "",
    "  0", "ENDBLK", "  5", "1C", "330", "17",
    "100", "AcDbEntity", "  8", "0",
    "100", "AcDbBlockEnd",
    "  0", "BLOCK", "  5", "1E", "330", "1B",
    "100", "AcDbEntity", "  8", "0",
    "100", "AcDbBlockBegin", "  2", "*Paper_Space", " 70", "0",
    " 10", "0.0", " 20", "0.0", " 30", "0.0",
    "  3", "*Paper_Space", "  1", "",
    "  0", "ENDBLK", "  5", "1F", "330", "1B",
    "100", "AcDbEntity", "  8", "0",
    "100", "AcDbBlockEnd",
    "  0", "ENDSEC",
  ].join("\r\n") + "\r\n";
}

function dxfHeader(): string {
  // HEADER section
  const header = [
    "  0", "SECTION",
    "  2", "HEADER",
    "  9", "$ACADVER",      "  1", "AC1024",
    "  9", "$ACADMAINTVER", " 70", "6",
    "  9", "$DWGCODEPAGE",  "  3", "ANSI_1252",
    "  9", "$INSBASE",  " 10", "0.0",  " 20", "0.0",  " 30", "0.0",
    "  9", "$EXTMIN",   " 10", "1e+20"," 20", "1e+20"," 30", "1e+20",
    "  9", "$EXTMAX",   " 10", "-1e+20"," 20", "-1e+20"," 30", "-1e+20",
    "  9", "$LIMMIN",   " 10", "0.0",  " 20", "0.0",
    "  9", "$LIMMAX",   " 10", "420.0"," 20", "297.0",
    "  9", "$ORTHOMODE"," 70", "0",
    "  9", "$REGENMODE"," 70", "1",
    "  9", "$FILLMODE", " 70", "1",
    "  9", "$QTEXTMODE"," 70", "0",
    "  9", "$MIRRTEXT", " 70", "1",
    "  9", "$LTSCALE",  " 40", "1.0",
    "  9", "$ATTMODE",  " 70", "1",
    "  9", "$TEXTSIZE", " 40", "2.5",
    "  9", "$TEXTSTYLE","  7", "Standard",
    "  9", "$CLAYER",   "  8", "0",
    "  9", "$CELTYPE",  "  6", "ByLayer",
    "  9", "$CECOLOR",  " 62", "256",
    "  9", "$CELTSCALE"," 40", "1.0",
    "  9", "$INSUNITS", " 70", "6",
    "  9", "$MEASUREMENT"," 70", "1",
    "  0", "ENDSEC",
  ].join("\r\n") + "\r\n";

  // Order: HEADER → TABLES → BLOCKS → open ENTITIES
  const entities = joinDxf(["0", "SECTION", "2", "ENTITIES"]);

  return header + dxfTables(LAYERS) + dxfBlocks() + entities;
}

function dxfFooter(): string {
  return joinDxf(["0", "ENDSEC", "0", "EOF"]);
}

// Layer → [ACI color, True Color 24-bit RGB int] per entity for viewer compat.
const LAYER_STYLE: Record<string, { aci: string; tc: string }> = {
  CUT_EXTERIOR:   { aci: "1", tc: "16711680" }, // red   255,0,0
  ENGRAVE_VECTOR: { aci: "5", tc: "255" },      // blue  0,0,255
  ENGRAVE_RASTER: { aci: "7", tc: "0" },        // black 0,0,0
  CUT_INTERIOR:   { aci: "3", tc: "65280" },    // green 0,255,0
};

function dxfLine(
  x1: number, y1: number,
  x2: number, y2: number,
  layer: string,
  linetype?: string,
): string {
  const style = LAYER_STYLE[layer] ?? { aci: "7", tc: "0" };
  const parts = [
    "0", "LINE",
    "8", layer,
    "62", style.aci,
    "420", style.tc,
  ];
  if (linetype) {
    parts.push("6", linetype);
  }
  parts.push(
    "10", String(x1), "20", String(y1),
    "11", String(x2), "21", String(y2),
  );
  return joinDxf(parts);
}

function dxfText(
  x: number, y: number, h: number, text: string, layer: string,
): string {
  const style = LAYER_STYLE[layer] ?? { aci: "7", tc: "0" };
  return joinDxf([
    "0", "TEXT",
    "8", layer,
    "62", style.aci,
    "420", style.tc,
    "10", String(x), "20", String(y),
    "40", String(h),
    "1", text,
  ]);
}

/** Generate an ARC entity (DXF angles are CCW from +X, in degrees). */
function dxfArc(
  cx: number, cy: number,
  radius: number,
  startAngle: number,
  endAngle: number,
  layer: string,
  linetype?: string,
): string {
  const style = LAYER_STYLE[layer] ?? { aci: "7", tc: "0" };
  const parts = [
    "0", "ARC",
    "8", layer,
    "62", style.aci,
    "420", style.tc,
  ];
  if (linetype) {
    parts.push("6", linetype);
  }
  parts.push(
    "10", String(cx), "20", String(cy),
    "40", String(radius),
    "50", String(startAngle),
    "51", String(endAngle),
  );
  return joinDxf(parts);
}

export function generateFacadeDxf(facade: Facade, scaleDenom: number): string {
  const s = 1 / scaleDenom;
  const textH = 0.003;
  let out = dxfHeader();

  for (const poly of facade.polygons) {
    const verts = poly.vertices;
    if (verts.length < 2) continue;
    if (verts.length === 2) {
      out += dxfLine(
        verts[0].x * s, verts[0].y * s,
        verts[1].x * s, verts[1].y * s,
        "CUT_EXTERIOR",
      );
    } else {
      for (let i = 0; i < verts.length; i++) {
        const j = (i + 1) % verts.length;
        out += dxfLine(
          verts[i].x * s, verts[i].y * s,
          verts[j].x * s, verts[j].y * s,
          "CUT_EXTERIOR",
        );
      }
    }
  }

  // Title.
  out += dxfText(
    facade.width * 0.5 * s,
    (facade.height + 0.5) * s,
    textH * 1.5,
    facade.label,
    "ENGRAVE_VECTOR",
  );

  // Dimensions.
  out += dxfText(
    facade.width * 0.5 * s,
    -0.4 * s,
    textH,
    `${facade.width.toFixed(2)} m`,
    "ENGRAVE_RASTER",
  );
  out += dxfText(
    (facade.width + 0.3) * s,
    facade.height * 0.5 * s,
    textH,
    `${facade.height.toFixed(2)} m`,
    "ENGRAVE_RASTER",
  );

  out += dxfFooter();
  return out;
}

export function generateFloorPlanDxf(
  plan: FloorPlan,
  scaleDenom: number,
): string {
  const s = 1 / scaleDenom;
  const textH = 0.003;
  let out = dxfHeader();

  // --- Wall segments (CUT_EXTERIOR layer) ---
  for (const seg of plan.segments) {
    out += dxfLine(
      seg.a.x * s, seg.a.y * s,
      seg.b.x * s, seg.b.y * s,
      "CUT_EXTERIOR",
    );
  }

  // --- Door symbols (CUT_INTERIOR layer) ---
  if (plan.doors) {
    for (const door of plan.doors) {
      // Door leaf line (solid — from hinge to open position).
      out += dxfLine(
        door.hinge.x * s, door.hinge.y * s,
        door.leafEnd.x * s, door.leafEnd.y * s,
        "CUT_INTERIOR",
        "CONTINUOUS",
      );

      // Swing arc (dashed quarter-circle).
      out += dxfArc(
        door.hinge.x * s, door.hinge.y * s,
        door.width * s,
        door.startAngle,
        door.endAngle,
        "CUT_INTERIOR",
        "DASHED",
      );
    }
  }

  // Title.
  out += dxfText(
    plan.width * 0.5 * s,
    (plan.height + 0.5) * s,
    textH * 1.5,
    plan.label,
    "ENGRAVE_VECTOR",
  );

  // Dimensions.
  out += dxfText(
    plan.width * 0.5 * s,
    -0.4 * s,
    textH,
    `${plan.width.toFixed(2)} m`,
    "ENGRAVE_RASTER",
  );
  out += dxfText(
    (plan.width + 0.3) * s,
    plan.height * 0.5 * s,
    textH,
    `${plan.height.toFixed(2)} m`,
    "ENGRAVE_RASTER",
  );

  out += dxfFooter();
  return out;
}
