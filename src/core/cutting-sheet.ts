// ============================================================================
// Cutting Sheet — Plancha de Corte
//
// Decomposes the 3D model into individual components using OBJ group names
// (g/o lines). Each group becomes a separate panel on the cutting sheet.
//
// Each panel is projected flat (walls → front view, floors → top view),
// its outline extracted via edge cancellation, and then packed onto
// standard cutting sheets (1000 × 600 mm) using shelf-packing.
//
// Panel IDs follow the pattern: A1, A2… (floor 1), B1, B2… (floor 2).
// ============================================================================

import type { Face3D, Vec2, Vec3 } from "./types";
import { cross, dot, normalize, vlength } from "./types";
import { detectFloorLevels } from "./floor-plan-extractor";

const GAP_M = 0.5; // gap between panels in metres
const VERTICAL_EPSILON = 0.20;
const HORIZONTAL_EPSILON = 0.25;

type UpAxis = "Y" | "Z";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getUp(v: Vec3, up: UpAxis): number {
  return up === "Y" ? v.y : v.z;
}

function getUpVec(up: UpAxis): Vec3 {
  return up === "Y" ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
}

function roundCoord(v: number): number {
  return Math.round(v * 10000) / 10000;
}

function edgeKey(ax: number, ay: number, bx: number, by: number): string {
  const a = `${roundCoord(ax)},${roundCoord(ay)}`;
  const b = `${roundCoord(bx)},${roundCoord(by)}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function r(n: number): string {
  return Number(n.toFixed(2)).toString();
}

// ---------------------------------------------------------------------------
// Panel types
// ---------------------------------------------------------------------------

interface WallPanel {
  id: string;
  groupName: string;
  floorIndex: number;
  widthM: number;
  heightM: number;
  edges: Array<{ a: Vec2; b: Vec2 }>;
}

/** A panel placed at a position in the layout (coordinates in metres). */
interface PlacedPanel {
  panel: WallPanel;
  x: number; // placement x in metres
  y: number; // placement y in metres
}

// ---------------------------------------------------------------------------
// Project a group of faces to 2D and extract outline
// ---------------------------------------------------------------------------

function projectGroupToPanel(
  faces: Face3D[],
  up: UpAxis,
): { widthM: number; heightM: number; edges: Array<{ a: Vec2; b: Vec2 }> } | null {
  if (faces.length === 0) return null;

  // Compute average normal of this group.
  let nx = 0, ny = 0, nz = 0;
  for (const f of faces) {
    nx += f.normal.x;
    ny += f.normal.y;
    nz += f.normal.z;
  }
  const avgNormal = normalize({ x: nx, y: ny, z: nz });

  // Determine if this is a vertical (wall) or horizontal (floor/ceiling) group.
  const upComp = Math.abs(getUp(avgNormal, up));
  const isHorizontal = upComp > 1.0 - HORIZONTAL_EPSILON;

  let uAxis: Vec3;
  let vAxis: Vec3;

  if (isHorizontal) {
    // Floor/ceiling → top-down view: u = X, v = other horizontal axis.
    if (up === "Y") {
      uAxis = { x: 1, y: 0, z: 0 };
      vAxis = { x: 0, y: 0, z: 1 };
    } else {
      uAxis = { x: 1, y: 0, z: 0 };
      vAxis = { x: 0, y: 1, z: 0 };
    }
  } else {
    // Wall → front view: u = horizontal along wall, v = up.
    const hDir: Vec3 =
      up === "Y"
        ? normalize({ x: avgNormal.x, y: 0, z: avgNormal.z })
        : normalize({ x: avgNormal.x, y: avgNormal.y, z: 0 });

    if (vlength(hDir) < 0.01) return null;

    const worldUp = getUpVec(up);
    uAxis = normalize(cross(worldUp, hDir));
    vAxis = worldUp;
  }

  // Project all faces and cancel shared edges.
  const edgeCounts = new Map<
    string,
    { ax: number; ay: number; bx: number; by: number }
  >();

  for (const face of faces) {
    const pts: Vec2[] = face.vertices.map((v) => ({
      x: dot(v, uAxis),
      y: dot(v, vAxis),
    }));

    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      const key = edgeKey(pts[i].x, pts[i].y, pts[j].x, pts[j].y);
      if (edgeCounts.has(key)) {
        edgeCounts.delete(key);
      } else {
        edgeCounts.set(key, {
          ax: pts[i].x, ay: pts[i].y,
          bx: pts[j].x, by: pts[j].y,
        });
      }
    }
  }

  if (edgeCounts.size === 0) return null;

  // Bounding box and normalize to (0,0).
  let minU = Infinity, maxU = -Infinity;
  let minV = Infinity, maxV = -Infinity;

  for (const e of edgeCounts.values()) {
    minU = Math.min(minU, e.ax, e.bx);
    maxU = Math.max(maxU, e.ax, e.bx);
    minV = Math.min(minV, e.ay, e.by);
    maxV = Math.max(maxV, e.ay, e.by);
  }

  const w = maxU - minU;
  const h = maxV - minV;
  if (w < 0.01 || h < 0.01) return null;

  const edges: Array<{ a: Vec2; b: Vec2 }> = [];
  for (const e of edgeCounts.values()) {
    edges.push({
      a: { x: e.ax - minU, y: e.ay - minV },
      b: { x: e.bx - minU, y: e.by - minV },
    });
  }

  return { widthM: w, heightM: h, edges };
}

// ---------------------------------------------------------------------------
// Decompose model into panels using OBJ group names
// ---------------------------------------------------------------------------

function decomposeIntoPanels(
  faces: Face3D[],
  up: UpAxis,
): WallPanel[] {
  // 1. Group faces by panelId (OBJ group name).
  const groups = new Map<string, Face3D[]>();
  let ungroupedIdx = 0;

  for (const face of faces) {
    const gid = face.panelId || `_ungrouped_${ungroupedIdx++}`;
    const arr = groups.get(gid);
    if (arr) arr.push(face);
    else groups.set(gid, [face]);
  }

  // 2. Detect floor levels for assigning floor letters.
  const levels = detectFloorLevels(faces, up);

  // 3. Project each group to a 2D panel.
  const rawPanels: Array<{
    groupName: string;
    floorIndex: number;
    widthM: number;
    heightM: number;
    edges: Array<{ a: Vec2; b: Vec2 }>;
  }> = [];

  for (const [groupName, groupFaces] of groups) {
    const result = projectGroupToPanel(groupFaces, up);
    if (!result) continue;

    // Determine floor index from vertical midpoint of the group.
    const allElevs = groupFaces.flatMap((f) =>
      f.vertices.map((v) => getUp(v, up)),
    );
    const mid = (Math.min(...allElevs) + Math.max(...allElevs)) / 2;

    let floorIdx = 0;
    for (let i = levels.length - 1; i >= 0; i--) {
      if (mid >= levels[i] - 0.5) {
        floorIdx = i;
        break;
      }
    }

    rawPanels.push({
      groupName,
      floorIndex: floorIdx,
      widthM: result.widthM,
      heightM: result.heightM,
      edges: result.edges,
    });
  }

  // 4. Assign IDs per floor: A1, A2… for floor 0, B1, B2… for floor 1.
  const floorLetters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  // Sort by floor, then by area descending for stable numbering.
  rawPanels.sort((a, b) => {
    if (a.floorIndex !== b.floorIndex) return a.floorIndex - b.floorIndex;
    return b.widthM * b.heightM - a.widthM * a.heightM;
  });

  const floorCounters = new Map<number, number>();
  const panels: WallPanel[] = [];

  for (const rp of rawPanels) {
    const count = (floorCounters.get(rp.floorIndex) || 0) + 1;
    floorCounters.set(rp.floorIndex, count);
    const letter = floorLetters[rp.floorIndex] || `F${rp.floorIndex + 1}`;

    panels.push({
      id: `${letter}${count}`,
      groupName: rp.groupName,
      floorIndex: rp.floorIndex,
      widthM: rp.widthM,
      heightM: rp.heightM,
      edges: rp.edges,
    });
  }

  return panels;
}

// ---------------------------------------------------------------------------
// Vertical grid layout — no fixed sheet, grows downward.
// Sort panels by height descending, place left-to-right in rows.
// Largest panels end up at the bottom (DXF Y grows up, so we build
// rows upward and then flip so biggest are at the bottom visually).
// ---------------------------------------------------------------------------

function layoutPanels(panels: WallPanel[]): PlacedPanel[] {
  if (panels.length === 0) return [];

  // Sort by height descending (tallest first → bottom rows).
  const sorted = [...panels].sort((a, b) => b.heightM - a.heightM);

  // Build rows top-to-bottom (we'll flip Y later so largest = bottom).
  const placed: PlacedPanel[] = [];
  let rowX = 0;
  let rowY = 0;    // current row's top edge (grows downward as negative)
  let rowH = 0;

  // Use the widest panel to set a soft max row width.
  const maxRowW = Math.max(...sorted.map((p) => p.widthM)) * 4;

  for (const panel of sorted) {
    const pw = panel.widthM + GAP_M;
    const ph = panel.heightM + GAP_M;

    if (rowX > 0 && rowX + pw > maxRowW) {
      // Start new row below.
      rowY -= rowH;
      rowX = 0;
      rowH = 0;
    }

    placed.push({ panel, x: rowX, y: rowY - panel.heightM });
    rowX += pw;
    rowH = Math.max(rowH, ph);
  }

  // Shift everything so min Y = 0 (all panels above origin).
  const minY = Math.min(...placed.map((p) => p.y));
  for (const p of placed) {
    p.y -= minY;
  }

  return placed;
}

// ---------------------------------------------------------------------------
// DXF generation — all panels in a single DXF, no sheet border
// ---------------------------------------------------------------------------

function panelsToDxf(placed: PlacedPanel[], scaleDenom: number): string {
  const s = 1 / scaleDenom; // metres → model units
  const textH = 0.15 / scaleDenom;
  const dimTextH = 0.12 / scaleDenom;

  const lines: string[] = [
    "0", "SECTION", "2", "HEADER",
    "9", "$ACADVER", "1", "AC1009",
    "0", "ENDSEC",
    "0", "SECTION", "2", "TABLES",
    "0", "TABLE", "2", "LTYPE", "70", "1",
    "0", "LTYPE", "2", "CONTINUOUS", "70", "0", "3", "Solid line", "72", "65", "73", "0", "40", "0.0",
    "0", "ENDTAB",
    "0", "TABLE", "2", "LAYER", "70", "2",
    "0", "LAYER", "2", "PANELS", "70", "0", "62", "7", "6", "CONTINUOUS",
    "0", "LAYER", "2", "LABELS", "70", "0", "62", "1", "6", "CONTINUOUS",
    "0", "ENDTAB",
    "0", "ENDSEC",
    "0", "SECTION", "2", "ENTITIES",
  ];

  const addLine = (x1: number, y1: number, x2: number, y2: number, layer: string) => {
    lines.push("0", "LINE", "8", layer,
      "10", r(x1 * s), "20", r(y1 * s),
      "11", r(x2 * s), "21", r(y2 * s));
  };

  const addText = (x: number, y: number, h: number, text: string, layer: string) => {
    lines.push("0", "TEXT", "8", layer,
      "10", r(x * s), "20", r(y * s),
      "40", r(h), "1", text);
  };

  for (const { panel, x, y } of placed) {
    const pw = panel.widthM;
    const ph = panel.heightM;

    // Draw panel outline edges.
    for (const edge of panel.edges) {
      addLine(
        x + edge.a.x, y + edge.a.y,
        x + edge.b.x, y + edge.b.y,
        "PANELS",
      );
    }

    // Panel ID label (red, above panel).
    addText(x + pw / 2, y + ph + GAP_M * 0.15, textH, panel.id, "LABELS");

    // Dimensions below panel.
    addText(
      x + pw / 2,
      y - GAP_M * 0.3,
      dimTextH,
      `${pw.toFixed(2)} x ${ph.toFixed(2)}`,
      "LABELS",
    );
  }

  lines.push("0", "ENDSEC", "0", "EOF");
  return lines.join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function generateCuttingSheets(
  faces: Face3D[],
  upAxis: "Y" | "Z",
  scaleDenom: number,
): Array<{ name: string; content: string }> {
  const panels = decomposeIntoPanels(faces, upAxis);
  if (panels.length === 0) return [];

  const placed = layoutPanels(panels);
  const content = panelsToDxf(placed, scaleDenom);

  return [{ name: "Plancha_de_Corte.dxf", content }];
}
