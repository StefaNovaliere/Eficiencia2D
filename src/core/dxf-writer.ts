// ============================================================================
// DXF Writer
//
// Generates AutoCAD-compatible DXF files.
//
// Layers:
//   - CORTE    (color 1 / red)   — wall and facade outlines (cut lines)
//   - TITULO   (color 5 / blue)  — titles and annotations (engrave)
//   - COTAS    (color 7 / black) — dimensions (engrave)
// ============================================================================

import type { Facade, FloorPlan } from "./types";

function dxfHeader(): string {
  return [
    "0", "SECTION", "2", "HEADER",
    "9", "$ACADVER", "1", "AC1009",
    "0", "ENDSEC",
    "0", "SECTION", "2", "TABLES",
    "0", "TABLE", "2", "LTYPE", "70", "1",
    "0", "LTYPE", "2", "CONTINUOUS", "70", "0", "3", "Solid line", "72", "65", "73", "0", "40", "0.0",
    "0", "ENDTAB",
    "0", "TABLE", "2", "LAYER", "70", "3",
    "0", "LAYER", "2", "CORTE",     "70", "0", "62", "1",  "6", "CONTINUOUS",
    "0", "LAYER", "2", "TITULO",    "70", "0", "62", "5",  "6", "CONTINUOUS",
    "0", "LAYER", "2", "COTAS",     "70", "0", "62", "7",  "6", "CONTINUOUS",
    "0", "ENDTAB",
    "0", "ENDSEC",
    "0", "SECTION", "2", "ENTITIES",
  ].join("\r\n") + "\r\n";
}

function dxfFooter(): string {
  return "0\r\nENDSEC\r\n0\r\nEOF\r\n";
}

// Layer → ACI color mapping (explicit per entity for viewer compatibility).
const LAYER_COLOR: Record<string, string> = {
  CORTE: "1",    // red — cut lines
  TITULO: "5",   // blue — titles (engrave)
  COTAS: "7",    // black — dimensions (engrave)
};

function dxfLine(
  x1: number, y1: number,
  x2: number, y2: number,
  layer: string,
): string {
  return [
    "0", "LINE",
    "8", layer,
    "62", LAYER_COLOR[layer] ?? "7",
    "10", String(x1), "20", String(y1),
    "11", String(x2), "21", String(y2),
  ].join("\r\n") + "\r\n";
}

function dxfText(
  x: number, y: number, h: number, text: string, layer: string,
): string {
  return [
    "0", "TEXT",
    "8", layer,
    "62", LAYER_COLOR[layer] ?? "7",
    "10", String(x), "20", String(y),
    "40", String(h),
    "1", text,
  ].join("\r\n") + "\r\n";
}

export function generateFacadeDxf(facade: Facade, scaleDenom: number): string {
  const s = 1 / scaleDenom;
  const textH = 0.003;
  let out = dxfHeader();

  for (const poly of facade.polygons) {
    const verts = poly.vertices;
    if (verts.length < 2) continue;
    // Each polygon is a 2-vertex line segment (edge).
    if (verts.length === 2) {
      out += dxfLine(
        verts[0].x * s, verts[0].y * s,
        verts[1].x * s, verts[1].y * s,
        "CORTE",
      );
    } else {
      // Closed polyline for legacy polygons.
      for (let i = 0; i < verts.length; i++) {
        const j = (i + 1) % verts.length;
        out += dxfLine(
          verts[i].x * s, verts[i].y * s,
          verts[j].x * s, verts[j].y * s,
          "CORTE",
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
    "TITULO",
  );

  // Dimensions.
  out += dxfText(
    facade.width * 0.5 * s,
    -0.4 * s,
    textH,
    `${facade.width.toFixed(2)} m`,
    "COTAS",
  );
  out += dxfText(
    (facade.width + 0.3) * s,
    facade.height * 0.5 * s,
    textH,
    `${facade.height.toFixed(2)} m`,
    "COTAS",
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

  for (const seg of plan.segments) {
    out += dxfLine(
      seg.a.x * s, seg.a.y * s,
      seg.b.x * s, seg.b.y * s,
      "CORTE",
    );
  }

  // Title.
  out += dxfText(
    plan.width * 0.5 * s,
    (plan.height + 0.5) * s,
    textH * 1.5,
    plan.label,
    "TITULO",
  );

  // Dimensions.
  out += dxfText(
    plan.width * 0.5 * s,
    -0.4 * s,
    textH,
    `${plan.width.toFixed(2)} m`,
    "COTAS",
  );
  out += dxfText(
    (plan.width + 0.3) * s,
    plan.height * 0.5 * s,
    textH,
    `${plan.height.toFixed(2)} m`,
    "COTAS",
  );

  out += dxfFooter();
  return out;
}
