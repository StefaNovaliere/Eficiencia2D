// ============================================================================
// DXF Writer
//
// Generates an AutoCAD-compatible DXF file from projected Wall[] data.
// Walls go on the "WALLS" layer, openings on "OPENINGS" (dashed),
// and dimension annotations on "DIMENSIONS".
// ============================================================================

import type { Loop2D, Wall } from "./types";

const GAP_M = 2.0;

function header(): string {
  return [
    "0", "SECTION", "2", "HEADER",
    "9", "$ACADVER", "1", "AC1015",
    "9", "$INSUNITS", "70", "6",
    "0", "ENDSEC",
    // Tables — layer definitions
    "0", "SECTION", "2", "TABLES",
    "0", "TABLE", "2", "LAYER", "70", "3",
    "0", "LAYER", "2", "WALLS",      "70", "0", "62", "7",  "6", "CONTINUOUS",
    "0", "LAYER", "2", "OPENINGS",   "70", "0", "62", "1",  "6", "DASHED",
    "0", "LAYER", "2", "DIMENSIONS", "70", "0", "62", "3",  "6", "CONTINUOUS",
    "0", "ENDTAB",
    "0", "ENDSEC",
    // Begin entities
    "0", "SECTION", "2", "ENTITIES",
  ].join("\n") + "\n";
}

function footer(): string {
  return "0\nENDSEC\n0\nEOF\n";
}

function polyline(loop: Loop2D, ox: number, oy: number, s: number, layer: string): string {
  if (loop.vertices.length === 0) return "";
  const lines: string[] = [
    "0", "LWPOLYLINE",
    "8", layer,
    "90", String(loop.vertices.length),
    "70", "1", // closed
  ];
  for (const v of loop.vertices) {
    lines.push("10", String((v.x + ox) * s));
    lines.push("20", String((v.y + oy) * s));
  }
  return lines.join("\n") + "\n";
}

function textEntity(x: number, y: number, h: number, text: string, layer: string): string {
  return [
    "0", "TEXT",
    "8", layer,
    "10", String(x),
    "20", String(y),
    "40", String(h),
    "1", text,
    "72", "1", // center-aligned
    "11", String(x),
    "21", String(y),
  ].join("\n") + "\n";
}

export function generateDxf(walls: Wall[], scaleDenom: number): string {
  const s = 1 / scaleDenom;
  const textH = 0.15 * s;
  let out = header();
  let ox = 0;

  for (const wall of walls) {
    // Outer boundary.
    out += polyline(wall.outer, ox, 0, s, "WALLS");

    // Openings.
    for (const opening of wall.openings) {
      out += polyline(opening, ox, 0, s, "OPENINGS");
    }

    // Dimension: width below.
    out += textEntity(
      (ox + wall.width * 0.5) * s,
      -0.4 * s,
      textH,
      `${wall.width.toFixed(2)} m`,
      "DIMENSIONS"
    );

    // Dimension: height to the right.
    out += textEntity(
      (ox + wall.width + 0.3) * s,
      wall.height * 0.5 * s,
      textH,
      `${wall.height.toFixed(2)} m`,
      "DIMENSIONS"
    );

    // Wall label above.
    out += textEntity(
      (ox + wall.width * 0.5) * s,
      (wall.height + 0.3) * s,
      textH,
      wall.label,
      "DIMENSIONS"
    );

    ox += wall.width + GAP_M;
  }

  out += footer();
  return out;
}
