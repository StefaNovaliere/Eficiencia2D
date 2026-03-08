// ============================================================================
// Cutting Sheet — Plancha de Corte
//
// Decomposes the 3D model into individual structural components using OBJ
// group names (g/o lines). Generates separate DXF files for walls and floors.
//
// Algorithm per OBJ group:
//   1. Cluster faces by normal direction (front/back/top/bottom/sides)
//   2. Pick the dominant cluster (largest total area) — this is the cutting face
//   3. Classify as wall (vertical normal) or floor (horizontal normal)
//   4. Project only dominant-cluster faces to 2D
//   5. Extract outline via edge cancellation
//   6. Assign ID: A1, A2… for walls; B1, B2… for floors (per floor level)
//
// Layout: simple row-based grid with gap between panels.
// DXF output: 1:1 scale (real dimensions for laser/CNC cutting).
// ============================================================================

import type { Face3D, Vec2, Vec3 } from "./types";
import { cross, dot, normalize, sub, vlength } from "./types";
import { detectFloorLevels } from "./floor-plan-extractor";

const GAP_M = 0.5;              // gap between panels in metres
const NORMAL_CLUSTER_DOT = 0.85; // faces with dot > this are "same direction"
const HORIZONTAL_THRESHOLD = 0.75; // |upComponent| > this → horizontal face
const VERTICAL_THRESHOLD = 0.25;   // |upComponent| < this → vertical face

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

function faceArea(face: Face3D): number {
  const verts = face.vertices;
  if (verts.length < 3) return 0;
  let sx = 0, sy = 0, sz = 0;
  for (let i = 1; i < verts.length - 1; i++) {
    const e1 = sub(verts[i], verts[0]);
    const e2 = sub(verts[i + 1], verts[0]);
    const c = cross(e1, e2);
    sx += c.x; sy += c.y; sz += c.z;
  }
  return 0.5 * Math.sqrt(sx * sx + sy * sy + sz * sz);
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
  return Number(n.toFixed(4)).toString();
}

// ---------------------------------------------------------------------------
// Panel types
// ---------------------------------------------------------------------------

type PanelCategory = "wall" | "floor";

interface Panel {
  id: string;
  groupName: string;
  category: PanelCategory;
  floorIndex: number;
  widthM: number;
  heightM: number;
  edges: Array<{ a: Vec2; b: Vec2 }>;
}

interface PlacedPanel {
  panel: Panel;
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// Cluster faces by normal direction within a single OBJ group
// ---------------------------------------------------------------------------

interface NormalCluster {
  representative: Vec3;
  faces: Face3D[];
  totalArea: number;
}

function clusterFacesByNormal(faces: Face3D[]): NormalCluster[] {
  const clusters: NormalCluster[] = [];

  for (const face of faces) {
    const n = face.normal;
    if (vlength(n) < 0.01) continue;

    const area = faceArea(face);
    if (area < 1e-6) continue;

    // Try to add to an existing cluster.
    let placed = false;
    for (const cluster of clusters) {
      if (dot(n, cluster.representative) > NORMAL_CLUSTER_DOT) {
        cluster.faces.push(face);
        cluster.totalArea += area;
        placed = true;
        break;
      }
    }

    if (!placed) {
      clusters.push({
        representative: normalize(n),
        faces: [face],
        totalArea: area,
      });
    }
  }

  return clusters;
}

// ---------------------------------------------------------------------------
// Project a set of coplanar faces to 2D and extract outline
// ---------------------------------------------------------------------------

function projectFacesTo2D(
  faces: Face3D[],
  dominantNormal: Vec3,
  up: UpAxis,
): { widthM: number; heightM: number; edges: Array<{ a: Vec2; b: Vec2 }> } | null {
  if (faces.length === 0) return null;

  const upComp = Math.abs(getUp(dominantNormal, up));
  const isHorizontal = upComp > HORIZONTAL_THRESHOLD;

  let uAxis: Vec3;
  let vAxis: Vec3;

  if (isHorizontal) {
    // Floor/ceiling → top-down projection: u = X, v = other horizontal axis.
    if (up === "Y") {
      uAxis = { x: 1, y: 0, z: 0 };
      vAxis = { x: 0, y: 0, z: 1 };
    } else {
      uAxis = { x: 1, y: 0, z: 0 };
      vAxis = { x: 0, y: 1, z: 0 };
    }
  } else {
    // Wall → front-view projection: u = horizontal along wall, v = up.
    const hDir: Vec3 =
      up === "Y"
        ? normalize({ x: dominantNormal.x, y: 0, z: dominantNormal.z })
        : normalize({ x: dominantNormal.x, y: dominantNormal.y, z: 0 });

    if (vlength(hDir) < 0.01) return null;

    const worldUp = getUpVec(up);
    uAxis = normalize(cross(worldUp, hDir));
    vAxis = worldUp;
  }

  // Project all faces and cancel shared edges (internal triangulation edges).
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
// Decompose model into classified panels using OBJ group names
// ---------------------------------------------------------------------------

function decomposeIntoPanels(
  faces: Face3D[],
  up: UpAxis,
): Panel[] {
  // 1. Group faces by panelId (OBJ group name).
  const groups = new Map<string, Face3D[]>();
  let ungroupedIdx = 0;

  for (const face of faces) {
    const gid = face.panelId || `_ungrouped_${ungroupedIdx++}`;
    const arr = groups.get(gid);
    if (arr) arr.push(face);
    else groups.set(gid, [face]);
  }

  // 2. Detect floor levels for assigning floor indices.
  const levels = detectFloorLevels(faces, up);

  // 3. Process each group: cluster faces by normal, pick dominant, classify.
  const rawPanels: Array<{
    groupName: string;
    category: PanelCategory;
    floorIndex: number;
    widthM: number;
    heightM: number;
    edges: Array<{ a: Vec2; b: Vec2 }>;
  }> = [];

  for (const [groupName, groupFaces] of groups) {
    // Skip ungrouped singleton faces (mesh artifacts).
    if (groupName.startsWith("_ungrouped_")) continue;

    // Cluster faces in this group by normal direction.
    const clusters = clusterFacesByNormal(groupFaces);
    if (clusters.length === 0) continue;

    // Pick the dominant cluster (largest total area).
    clusters.sort((a, b) => b.totalArea - a.totalArea);
    const dominant = clusters[0];

    // Classify: is the dominant face horizontal (floor) or vertical (wall)?
    const upComp = Math.abs(getUp(dominant.representative, up));
    const category: PanelCategory =
      upComp > HORIZONTAL_THRESHOLD ? "floor" : "wall";

    // Only keep actual walls and floors (skip faces at weird angles).
    if (category === "wall" && upComp > VERTICAL_THRESHOLD) continue;

    // Project only the dominant-cluster faces to 2D.
    const result = projectFacesTo2D(dominant.faces, dominant.representative, up);
    if (!result) continue;

    // Skip very small panels (artifacts, edges, trim pieces).
    if (result.widthM < 0.05 || result.heightM < 0.05) continue;
    if (result.widthM * result.heightM < 0.01) continue;

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
      category,
      floorIndex: floorIdx,
      widthM: result.widthM,
      heightM: result.heightM,
      edges: result.edges,
    });
  }

  // 4. Assign IDs separately for walls (A-prefix) and floors (B-prefix).
  //    Within each category, number per floor level.
  const walls = rawPanels
    .filter((p) => p.category === "wall")
    .sort((a, b) => {
      if (a.floorIndex !== b.floorIndex) return a.floorIndex - b.floorIndex;
      return b.widthM * b.heightM - a.widthM * a.heightM;
    });

  const floors = rawPanels
    .filter((p) => p.category === "floor")
    .sort((a, b) => {
      if (a.floorIndex !== b.floorIndex) return a.floorIndex - b.floorIndex;
      return b.widthM * b.heightM - a.widthM * a.heightM;
    });

  const panels: Panel[] = [];

  // Walls: A1, A2, A3… (global sequential numbering, letter A)
  let wallCount = 0;
  for (const rp of walls) {
    wallCount++;
    panels.push({
      id: `A${wallCount}`,
      groupName: rp.groupName,
      category: "wall",
      floorIndex: rp.floorIndex,
      widthM: rp.widthM,
      heightM: rp.heightM,
      edges: rp.edges,
    });
  }

  // Floors: B1, B2, B3… (global sequential numbering, letter B)
  let floorCount = 0;
  for (const rp of floors) {
    floorCount++;
    panels.push({
      id: `B${floorCount}`,
      groupName: rp.groupName,
      category: "floor",
      floorIndex: rp.floorIndex,
      widthM: rp.widthM,
      heightM: rp.heightM,
      edges: rp.edges,
    });
  }

  return panels;
}

// ---------------------------------------------------------------------------
// Row-based grid layout — panels flow left-to-right, then down.
// Sorted by height descending so rows are uniform.
// ---------------------------------------------------------------------------

function layoutPanels(panels: Panel[]): PlacedPanel[] {
  if (panels.length === 0) return [];

  // Sort by height descending for efficient row packing.
  const sorted = [...panels].sort((a, b) => b.heightM - a.heightM);

  // Determine a reasonable max row width (4× the widest panel).
  const maxRowW = Math.max(
    ...sorted.map((p) => p.widthM),
    2, // at least 2m
  ) * 4;

  const placed: PlacedPanel[] = [];
  let rowX = 0;
  let rowY = 0;     // current row's baseline Y
  let rowMaxH = 0;  // tallest panel in current row

  for (const panel of sorted) {
    const pw = panel.widthM;
    const ph = panel.heightM;

    // Start a new row if this panel would exceed max width.
    if (rowX > 0 && rowX + pw > maxRowW) {
      rowY += rowMaxH + GAP_M;
      rowX = 0;
      rowMaxH = 0;
    }

    placed.push({ panel, x: rowX, y: rowY });
    rowX += pw + GAP_M;
    rowMaxH = Math.max(rowMaxH, ph);
  }

  return placed;
}

// ---------------------------------------------------------------------------
// DXF generation — clean, Autodesk-compatible AC1009 (R12) format
// Cutting sheets are always at 1:1 scale (real dimensions in metres).
// ---------------------------------------------------------------------------

function panelsToDxf(placed: PlacedPanel[]): string {
  const textH = 0.15;     // panel ID text height (metres)
  const dimTextH = 0.10;  // dimension text height (metres)

  const lines: string[] = [
    // HEADER
    "0", "SECTION", "2", "HEADER",
    "9", "$ACADVER", "1", "AC1009",
    "9", "$INSUNITS", "70", "6",  // 6 = metres
    "0", "ENDSEC",
    // TABLES
    "0", "SECTION", "2", "TABLES",
    // Line types
    "0", "TABLE", "2", "LTYPE", "70", "1",
    "0", "LTYPE", "2", "CONTINUOUS", "70", "0", "3", "Solid line", "72", "65", "73", "0", "40", "0.0",
    "0", "ENDTAB",
    // Layers
    "0", "TABLE", "2", "LAYER", "70", "3",
    "0", "LAYER", "2", "CORTE",     "70", "0", "62", "7",  "6", "CONTINUOUS",
    "0", "LAYER", "2", "ETIQUETAS", "70", "0", "62", "1",  "6", "CONTINUOUS",
    "0", "LAYER", "2", "COTAS",     "70", "0", "62", "3",  "6", "CONTINUOUS",
    "0", "ENDTAB",
    "0", "ENDSEC",
    // ENTITIES
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
      "40", r(h), "1", text,
      "72", "1",  // horizontal justification = center
      "11", r(x), "21", r(y));  // alignment point for centered text
  };

  for (const { panel, x, y } of placed) {
    const pw = panel.widthM;
    const ph = panel.heightM;

    // Draw panel outline edges (CORTE layer — black).
    for (const edge of panel.edges) {
      addLine(
        x + edge.a.x, y + edge.a.y,
        x + edge.b.x, y + edge.b.y,
        "CORTE",
      );
    }

    // Panel ID label centered above panel (ETIQUETAS layer — red).
    addText(
      x + pw / 2,
      y + ph + GAP_M * 0.2,
      textH,
      panel.id,
      "ETIQUETAS",
    );

    // Dimensions below panel (COTAS layer — green).
    addText(
      x + pw / 2,
      y - GAP_M * 0.35,
      dimTextH,
      `${pw.toFixed(2)} x ${ph.toFixed(2)} m`,
      "COTAS",
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
  _scaleDenom: number,
): Array<{ name: string; content: string }> {
  const panels = decomposeIntoPanels(faces, upAxis);
  if (panels.length === 0) return [];

  const results: Array<{ name: string; content: string }> = [];

  // Separate walls and floors.
  const wallPanels = panels.filter((p) => p.category === "wall");
  const floorPanels = panels.filter((p) => p.category === "floor");

  // Generate wall cutting sheet.
  if (wallPanels.length > 0) {
    const placed = layoutPanels(wallPanels);
    const content = panelsToDxf(placed);
    results.push({ name: "Descomposicion_Paredes.dxf", content });
  }

  // Generate floor cutting sheet.
  if (floorPanels.length > 0) {
    const placed = layoutPanels(floorPanels);
    const content = panelsToDxf(placed);
    results.push({ name: "Descomposicion_Pisos.dxf", content });
  }

  return results;
}
