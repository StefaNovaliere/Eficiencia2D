// ============================================================================
// DXF Writer
//
// Generates AutoCAD-compatible DXF files (AC1009 / R12).
// Uses simple R12 format for maximum compatibility with Autodesk Viewer,
// QCAD, LibreCAD, and laser-cutting software.
//
// Layers (4-layer laser cutting protocol):
//   - CUT_EXTERIOR    (ACI 1 / red)   — exterior outlines
//   - ENGRAVE_VECTOR  (ACI 5 / blue)  — titles, annotations
//   - ENGRAVE_RASTER  (ACI 7 / white) — dimensions
//   - CUT_INTERIOR    (ACI 3 / green) — interior cuts
// ============================================================================

import type { Facade, FloorPlan } from "./types";

/** Layer definitions for the 4-layer laser cutting protocol. */
const LAYERS = [
  { name: "CUT_EXTERIOR",   aci: "1" }, // red
  { name: "ENGRAVE_VECTOR", aci: "5" }, // blue
  { name: "ENGRAVE_RASTER", aci: "7" }, // white
  { name: "CUT_INTERIOR",   aci: "3" }, // green
];

/** ACI color per layer name. */
const LAYER_ACI: Record<string, string> = Object.fromEntries(
  LAYERS.map((l) => [l.name, l.aci]),
);

function dxfHeader(): string {
  const lines = [
    "0", "SECTION",
    "2", "HEADER",
    "9", "$ACADVER",
    "1", "AC1009",
    "9", "$INSUNITS",
    "70", "6",
    "0", "ENDSEC",
  ];
  return lines.join("\n") + "\n";
}

function dxfTables(): string {
  const lines = [
    "0", "SECTION",
    "2", "TABLES",
    // LTYPE table
    "0", "TABLE",
    "2", "LTYPE",
    "70", "1",
    "0", "LTYPE",
    "2", "CONTINUOUS",
    "70", "0",
    "3", "Solid line",
    "72", "65",
    "73", "0",
    "40", "0.0",
    "0", "ENDTAB",
    // LAYER table
    "0", "TABLE",
    "2", "LAYER",
    "70", String(LAYERS.length),
  ];

  for (const l of LAYERS) {
    lines.push(
      "0", "LAYER",
      "2", l.name,
      "70", "0",
      "62", l.aci,
      "6", "CONTINUOUS",
    );
  }

  lines.push("0", "ENDTAB", "0", "ENDSEC");
  return lines.join("\n") + "\n";
}

function dxfLine(
  x1: number, y1: number,
  x2: number, y2: number,
  layer: string,
): string {
  const aci = LAYER_ACI[layer] ?? "7";
  return [
    "0", "LINE",
    "8", layer,
    "62", aci,
    "10", String(x1),
    "20", String(y1),
    "11", String(x2),
    "21", String(y2),
  ].join("\n") + "\n";
}

function dxfText(
  x: number, y: number, h: number, text: string, layer: string,
): string {
  const aci = LAYER_ACI[layer] ?? "7";
  return [
    "0", "TEXT",
    "8", layer,
    "62", aci,
    "10", String(x),
    "20", String(y),
    "40", String(h),
    "1", text,
    "72", "1",
    "11", String(x),
    "21", String(y),
  ].join("\n") + "\n";
}

/** Generate an ARC entity (DXF angles are CCW from +X, in degrees). */
function dxfArc(
  cx: number, cy: number,
  radius: number,
  startAngle: number,
  endAngle: number,
  layer: string,
): string {
  const aci = LAYER_ACI[layer] ?? "7";
  return [
    "0", "ARC",
    "8", layer,
    "62", aci,
    "10", String(cx),
    "20", String(cy),
    "40", String(radius),
    "50", String(startAngle),
    "51", String(endAngle),
  ].join("\n") + "\n";
}

function dxfFooter(): string {
  return "0\nENDSEC\n0\nEOF\n";
}

export function generateFacadeDxf(facade: Facade, scaleDenom: number): string {
  const s = 1 / scaleDenom;
  const textH = 0.003;
  let out = dxfHeader() + dxfTables();

  // Open ENTITIES section
  out += "0\nSECTION\n2\nENTITIES\n";

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
  let out = dxfHeader() + dxfTables();

  // Open ENTITIES section
  out += "0\nSECTION\n2\nENTITIES\n";

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
      );

      // Swing arc (quarter-circle).
      out += dxfArc(
        door.hinge.x * s, door.hinge.y * s,
        door.width * s,
        door.startAngle,
        door.endAngle,
        "CUT_INTERIOR",
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
