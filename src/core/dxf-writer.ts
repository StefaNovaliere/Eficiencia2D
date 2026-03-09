// ============================================================================
// DXF Writer
//
// Generates AutoCAD-compatible DXF files.
//
// Layers:
//   - CORTE      (color 1 / red)       — wall and facade outlines (cut lines)
//   - TITULO     (color 5 / blue)      — titles and annotations (engrave)
//   - COTAS      (color 7 / black)     — dimensions (engrave)
//   - ABERTURAS  (color 8 / dark gray) — door arcs + leaves (thin, dashed arc)
// ============================================================================

import type { Facade, FloorPlan } from "./types";

function dxfHeader(): string {
  return [
    "0", "SECTION", "2", "HEADER",
    "9", "$ACADVER", "1", "AC1009",
    "0", "ENDSEC",
    "0", "SECTION", "2", "TABLES",
    // --- Line types ---
    "0", "TABLE", "2", "LTYPE", "70", "2",
    "0", "LTYPE", "2", "CONTINUOUS", "70", "0", "3", "Solid line", "72", "65", "73", "0", "40", "0.0",
    "0", "LTYPE", "2", "DASHED", "70", "0", "3", "Dashed __ __ __", "72", "65", "73", "2", "40", "0.005", "49", "0.003", "49", "-0.002",
    "0", "ENDTAB",
    // --- Layers ---
    "0", "TABLE", "2", "LAYER", "70", "4",
    "0", "LAYER", "2", "CORTE",      "70", "0", "62", "1",  "6", "CONTINUOUS",
    "0", "LAYER", "2", "TITULO",     "70", "0", "62", "5",  "6", "CONTINUOUS",
    "0", "LAYER", "2", "COTAS",      "70", "0", "62", "7",  "6", "CONTINUOUS",
    "0", "LAYER", "2", "ABERTURAS",  "70", "0", "62", "8",  "6", "DASHED",
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
  CORTE: "1",       // red — cut lines
  TITULO: "5",      // blue — titles (engrave)
  COTAS: "7",       // black — dimensions (engrave)
  ABERTURAS: "8",   // dark gray — door symbols
};

function dxfLine(
  x1: number, y1: number,
  x2: number, y2: number,
  layer: string,
  linetype?: string,
): string {
  const parts = [
    "0", "LINE",
    "8", layer,
    "62", LAYER_COLOR[layer] ?? "7",
  ];
  if (linetype) {
    parts.push("6", linetype);
  }
  parts.push(
    "10", String(x1), "20", String(y1),
    "11", String(x2), "21", String(y2),
  );
  return parts.join("\r\n") + "\r\n";
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

/** Generate an ARC entity (DXF angles are CCW from +X, in degrees). */
function dxfArc(
  cx: number, cy: number,
  radius: number,
  startAngle: number,
  endAngle: number,
  layer: string,
  linetype?: string,
): string {
  const parts = [
    "0", "ARC",
    "8", layer,
    "62", LAYER_COLOR[layer] ?? "8",
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
  return parts.join("\r\n") + "\r\n";
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
        "CORTE",
      );
    } else {
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

  // --- Wall segments (CORTE layer) ---
  for (const seg of plan.segments) {
    out += dxfLine(
      seg.a.x * s, seg.a.y * s,
      seg.b.x * s, seg.b.y * s,
      "CORTE",
    );
  }

  // --- Door symbols (ABERTURAS layer) ---
  if (plan.doors) {
    for (const door of plan.doors) {
      // Door leaf line (solid — from hinge to open position).
      out += dxfLine(
        door.hinge.x * s, door.hinge.y * s,
        door.leafEnd.x * s, door.leafEnd.y * s,
        "ABERTURAS",
        "CONTINUOUS",
      );

      // Swing arc (dashed quarter-circle).
      out += dxfArc(
        door.hinge.x * s, door.hinge.y * s,
        door.width * s,
        door.startAngle,
        door.endAngle,
        "ABERTURAS",
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
