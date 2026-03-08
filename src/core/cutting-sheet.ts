// ============================================================================
// Cutting Sheet — Plancha de Corte
//
// Decomposes the 3D model into individual wall panels per floor, assigns
// IDs (A1, A2… for floor 1; B1, B2… for floor 2; etc.), and packs them
// onto standard cutting sheets (1000 × 600 mm) for laser cutting.
//
// Algorithm:
//   1. Detect floor levels (reuses histogram-based detection).
//   2. Filter vertical faces and assign each to a floor.
//   3. Within each floor, find connected components → individual panels.
//   4. Project each panel onto its wall plane to get 2D outline + bbox.
//   5. Pack panels onto sheets using shelf-packing.
// ============================================================================

import type { Face3D, Vec2, Vec3 } from "./types";
import { cross, dot, normalize, vlength } from "./types";
import { detectFloorLevels } from "./floor-plan-extractor";

const SHEET_W_MM = 1000;
const SHEET_H_MM = 600;
const PANEL_GAP_MM = 10;
const VERTICAL_EPSILON = 0.20;

type UpAxis = "Y" | "Z";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getUp(v: Vec3, up: UpAxis): number {
  return up === "Y" ? v.y : v.z;
}

function vertexKey(v: Vec3): string {
  return `${Math.round(v.x * 1000)},${Math.round(v.y * 1000)},${Math.round(v.z * 1000)}`;
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
// Connected components via Union-Find
// ---------------------------------------------------------------------------

function findConnectedComponents(faces: Face3D[]): Face3D[][] {
  const n = faces.length;
  if (n === 0) return [];

  const vtxToFaces = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    for (const v of faces[i].vertices) {
      const key = vertexKey(v);
      const arr = vtxToFaces.get(key);
      if (arr) arr.push(i);
      else vtxToFaces.set(key, [i]);
    }
  }

  const parent = Array.from({ length: n }, (_, i) => i);
  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }
  function union(a: number, b: number) {
    parent[find(a)] = find(b);
  }

  for (const indices of vtxToFaces.values()) {
    for (let i = 1; i < indices.length; i++) {
      union(indices[0], indices[i]);
    }
  }

  const groups = new Map<number, Face3D[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const g = groups.get(root);
    if (g) g.push(faces[i]);
    else groups.set(root, [faces[i]]);
  }

  return [...groups.values()];
}

// ---------------------------------------------------------------------------
// Panel types
// ---------------------------------------------------------------------------

interface WallPanel {
  id: string;
  widthM: number;
  heightM: number;
  edges: Array<{ a: Vec2; b: Vec2 }>; // outline in local coords (metres)
}

interface CuttingPanel {
  id: string;
  widthMm: number;
  heightMm: number;
  edges: Array<{ a: Vec2; b: Vec2 }>; // outline in mm on the sheet
  realWidthM: number;
  realHeightM: number;
}

interface CuttingSheet {
  index: number;
  panels: Array<{
    panel: CuttingPanel;
    x: number;
    y: number;
  }>;
}

// ---------------------------------------------------------------------------
// Decompose 3D faces → individual wall panels per floor
// ---------------------------------------------------------------------------

function decomposeIntoPanels(
  faces: Face3D[],
  up: UpAxis,
): WallPanel[] {
  // 1. Filter vertical faces.
  const verticalFaces = faces.filter(
    (f) => Math.abs(getUp(f.normal, up)) <= VERTICAL_EPSILON,
  );
  if (verticalFaces.length === 0) return [];

  // 2. Detect floor levels.
  const levels = detectFloorLevels(faces, up);
  if (levels.length === 0) {
    // Single floor fallback: use the lowest vertical extent.
    const minElev = Math.min(
      ...verticalFaces.flatMap((f) => f.vertices.map((v) => getUp(v, up))),
    );
    levels.push(minElev);
  }

  // 3. Assign each vertical face to a floor.
  const floorBuckets: Face3D[][] = levels.map(() => []);

  for (const face of verticalFaces) {
    const elevs = face.vertices.map((v) => getUp(v, up));
    const mid = (Math.min(...elevs) + Math.max(...elevs)) / 2;

    let floorIdx = 0;
    for (let i = levels.length - 1; i >= 0; i--) {
      if (mid >= levels[i] - 0.5) {
        floorIdx = i;
        break;
      }
    }
    floorBuckets[floorIdx].push(face);
  }

  // 4. For each floor, find connected components → panels.
  const panels: WallPanel[] = [];
  const floorLetters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  for (let fi = 0; fi < levels.length; fi++) {
    const components = findConnectedComponents(floorBuckets[fi]);
    const letter = floorLetters[fi] || `F${fi + 1}`;

    // Sort by number of faces descending for stable numbering.
    components.sort((a, b) => b.length - a.length);

    for (let ci = 0; ci < components.length; ci++) {
      const comp = components[ci];

      // Average normal to determine projection direction.
      let nx = 0, ny = 0, nz = 0;
      for (const f of comp) {
        nx += f.normal.x;
        ny += f.normal.y;
        nz += f.normal.z;
      }
      const avgNormal = normalize({ x: nx, y: ny, z: nz });

      const hDir: Vec3 =
        up === "Y"
          ? normalize({ x: avgNormal.x, y: 0, z: avgNormal.z })
          : normalize({ x: avgNormal.x, y: avgNormal.y, z: 0 });

      if (vlength(hDir) < 0.01) continue;

      // Projection axes: u = horizontal along wall, v = vertical.
      const worldUp: Vec3 =
        up === "Y" ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
      const uAxis = normalize(cross(worldUp, hDir));
      const vAxis = worldUp;

      // Project faces and collect outline edges (cancel shared internals).
      const edgeCounts = new Map<
        string,
        { ax: number; ay: number; bx: number; by: number }
      >();

      for (const face of comp) {
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
              ax: pts[i].x,
              ay: pts[i].y,
              bx: pts[j].x,
              by: pts[j].y,
            });
          }
        }
      }

      if (edgeCounts.size === 0) continue;

      // Bounding box.
      let minU = Infinity,
        maxU = -Infinity;
      let minV = Infinity,
        maxV = -Infinity;
      const edges: Array<{ a: Vec2; b: Vec2 }> = [];

      for (const e of edgeCounts.values()) {
        minU = Math.min(minU, e.ax, e.bx);
        maxU = Math.max(maxU, e.ax, e.bx);
        minV = Math.min(minV, e.ay, e.by);
        maxV = Math.max(maxV, e.ay, e.by);
        edges.push({
          a: { x: e.ax, y: e.ay },
          b: { x: e.bx, y: e.by },
        });
      }

      const w = maxU - minU;
      const h = maxV - minV;
      if (w < 0.01 || h < 0.01) continue;

      // Normalize to (0,0) origin.
      const normEdges = edges.map((e) => ({
        a: { x: e.a.x - minU, y: e.a.y - minV },
        b: { x: e.b.x - minU, y: e.b.y - minV },
      }));

      panels.push({
        id: `${letter}${ci + 1}`,
        widthM: w,
        heightM: h,
        edges: normEdges,
      });
    }
  }

  return panels;
}

// ---------------------------------------------------------------------------
// Scale panels from metres → mm at model scale
// ---------------------------------------------------------------------------

function panelsToCuttingPanels(
  panels: WallPanel[],
  scaleDenom: number,
): CuttingPanel[] {
  const toMm = 1000 / scaleDenom;
  return panels.map((p) => ({
    id: p.id,
    widthMm: p.widthM * toMm,
    heightMm: p.heightM * toMm,
    edges: p.edges.map((e) => ({
      a: { x: e.a.x * toMm, y: e.a.y * toMm },
      b: { x: e.b.x * toMm, y: e.b.y * toMm },
    })),
    realWidthM: p.widthM,
    realHeightM: p.heightM,
  }));
}

// ---------------------------------------------------------------------------
// Shelf-packing
// ---------------------------------------------------------------------------

function packPanels(panels: CuttingPanel[]): CuttingSheet[] {
  const sorted = [...panels].sort((a, b) => b.heightMm - a.heightMm);

  const sheets: CuttingSheet[] = [];
  let currentSheet: CuttingSheet = { index: 1, panels: [] };
  let shelfX = 0;
  let shelfY = 0;
  let shelfH = 0;

  for (const panel of sorted) {
    const pw = panel.widthMm + PANEL_GAP_MM;
    const ph = panel.heightMm + PANEL_GAP_MM;

    if (shelfX + pw <= SHEET_W_MM && shelfY + ph <= SHEET_H_MM) {
      currentSheet.panels.push({ panel, x: shelfX, y: shelfY });
      shelfX += pw;
      shelfH = Math.max(shelfH, ph);
    } else if (shelfY + shelfH + ph <= SHEET_H_MM) {
      shelfY += shelfH;
      shelfX = 0;
      shelfH = ph;
      currentSheet.panels.push({ panel, x: shelfX, y: shelfY });
      shelfX = pw;
    } else {
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

// ---------------------------------------------------------------------------
// DXF generation
// ---------------------------------------------------------------------------

function sheetToDxf(sheet: CuttingSheet): string {
  const lines: string[] = [
    "0", "SECTION", "2", "HEADER",
    "9", "$ACADVER", "1", "AC1009",
    "0", "ENDSEC",
    "0", "SECTION", "2", "TABLES",
    "0", "TABLE", "2", "LTYPE", "70", "1",
    "0", "LTYPE", "2", "CONTINUOUS", "70", "0", "3", "Solid line", "72", "65", "73", "0", "40", "0.0",
    "0", "ENDTAB",
    "0", "TABLE", "2", "LAYER", "70", "3",
    "0", "LAYER", "2", "SHEET",  "70", "0", "62", "8", "6", "CONTINUOUS",
    "0", "LAYER", "2", "PANELS", "70", "0", "62", "7", "6", "CONTINUOUS",
    "0", "LAYER", "2", "LABELS", "70", "0", "62", "5", "6", "CONTINUOUS",
    "0", "ENDTAB",
    "0", "ENDSEC",
    "0", "SECTION", "2", "ENTITIES",
  ];

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
    const pw = panel.widthMm;
    const ph = panel.heightMm;

    // Draw panel outline edges (translated to placement position).
    for (const edge of panel.edges) {
      addLine(
        x + edge.a.x, y + edge.a.y,
        x + edge.b.x, y + edge.b.y,
        "PANELS",
      );
    }

    // Panel ID label (red, above the panel).
    addText(x + pw / 2, y + ph + 2, 5, panel.id, "LABELS");

    // Dimensions below the panel.
    addText(
      x + pw / 2,
      y - 5,
      4,
      `${panel.realWidthM.toFixed(2)} x ${panel.realHeightM.toFixed(2)}`,
      "LABELS",
    );
  }

  lines.push("0", "ENDSEC", "0", "EOF");
  return lines.join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Generate cutting sheet DXFs by decomposing the model into individual panels. */
export function generateCuttingSheets(
  faces: Face3D[],
  upAxis: "Y" | "Z",
  scaleDenom: number,
): Array<{ name: string; content: string }> {
  const wallPanels = decomposeIntoPanels(faces, upAxis);
  if (wallPanels.length === 0) return [];

  const cuttingPanels = panelsToCuttingPanels(wallPanels, scaleDenom);
  const sheets = packPanels(cuttingPanels);

  return sheets.map((sheet) => ({
    name: `Plancha_de_Corte${sheets.length > 1 ? `_${sheet.index}` : ""}.dxf`,
    content: sheetToDxf(sheet),
  }));
}
