// ============================================================================
// Cutting Sheet — Plancha de Corte
//
// Decomposes the 3D model into individual structural components using
// geometric coplanarity clustering (same normal + same plane offset).
//
// Algorithm:
//   1. Cluster ALL faces by coplanarity (normal direction + plane distance d)
//   2. Within each cluster, find connected components via shared vertices
//   3. Classify each component as wall (vertical) or floor (horizontal)
//   4. Project to 2D, extract boundary edges (edges in exactly 1 face)
//   5. Assign ID: A1, A2… for walls; B1, B2… for floors
//
// Boundary edge rule: an edge shared by 2 faces is internal (triangulation)
// and is discarded. Only edges belonging to exactly 1 face are exported.
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

/** Snap to 2 decimal places (~1cm tolerance) for robust edge matching. */
function snap(v: number): number {
  return Math.round(v * 100) / 100;
}

function vertKey(x: number, y: number): string {
  return `${snap(x)},${snap(y)}`;
}

function edgeKey(ax: number, ay: number, bx: number, by: number): string {
  const a = vertKey(ax, ay);
  const b = vertKey(bx, by);
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Snap a 3D coordinate for coplanarity grouping. */
function snap3(v: number): number {
  return Math.round(v * 100) / 100;
}

function r(n: number): string {
  return Number(n.toFixed(4)).toString();
}

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
// Coplanarity clustering: group faces by (normal direction + plane offset d)
// ---------------------------------------------------------------------------

interface CoplanarGroup {
  normal: Vec3;
  d: number;               // plane offset: dot(normal, pointOnPlane)
  faces: Face3D[];
  totalArea: number;
  category: PanelCategory;
}

/**
 * Cluster all faces into coplanar groups.
 * Two faces are coplanar if:
 *   1. Their normals point in the same direction (dot > threshold)
 *   2. Their plane offsets (d = dot(n, v)) are within tolerance
 */
function clusterByCoplanarity(
  faces: Face3D[],
  up: UpAxis,
): CoplanarGroup[] {
  const groups: CoplanarGroup[] = [];
  const D_TOLERANCE = 0.15; // ~15cm tolerance for "same plane"

  for (const face of faces) {
    const n = face.normal;
    if (vlength(n) < 0.01) continue;

    const area = faceArea(face);
    if (area < 1e-6) continue;

    // Plane offset from first vertex.
    const d = dot(n, face.vertices[0]);

    // Classify: horizontal (floor/ceiling) or vertical (wall).
    const upComp = Math.abs(getUp(n, up));
    const category: PanelCategory =
      upComp > HORIZONTAL_THRESHOLD ? "floor" : "wall";

    // Skip faces at weird angles (neither wall nor floor).
    if (category === "wall" && upComp > VERTICAL_THRESHOLD) continue;

    // Try to merge into an existing group.
    let placed = false;
    for (const group of groups) {
      if (
        group.category === category &&
        Math.abs(dot(n, group.normal)) > NORMAL_CLUSTER_DOT &&
        Math.abs(d - group.d) < D_TOLERANCE
      ) {
        group.faces.push(face);
        group.totalArea += area;
        placed = true;
        break;
      }
    }

    if (!placed) {
      groups.push({
        normal: normalize(n),
        d,
        faces: [face],
        totalArea: area,
        category,
      });
    }
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Connected components: split a coplanar group into spatially connected pieces
// ---------------------------------------------------------------------------

/**
 * Within a coplanar group, faces may belong to different walls/slabs that
 * happen to be on the same plane. Split them into connected components
 * by shared (snapped) vertices.
 */
function splitConnectedComponents(faces: Face3D[]): Face3D[][] {
  if (faces.length <= 1) return [faces];

  // Build adjacency via shared snapped 3D vertices.
  const vertToFaces = new Map<string, number[]>();
  for (let fi = 0; fi < faces.length; fi++) {
    for (const v of faces[fi].vertices) {
      const key = `${snap3(v.x)},${snap3(v.y)},${snap3(v.z)}`;
      const arr = vertToFaces.get(key);
      if (arr) arr.push(fi);
      else vertToFaces.set(key, [fi]);
    }
  }

  // Union-Find.
  const parent = faces.map((_, i) => i);
  function find(x: number): number {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  }
  function union(a: number, b: number) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  for (const faceIndices of vertToFaces.values()) {
    for (let i = 1; i < faceIndices.length; i++) {
      union(faceIndices[0], faceIndices[i]);
    }
  }

  // Group by root.
  const componentMap = new Map<number, Face3D[]>();
  for (let fi = 0; fi < faces.length; fi++) {
    const root = find(fi);
    const arr = componentMap.get(root);
    if (arr) arr.push(faces[fi]);
    else componentMap.set(root, [faces[fi]]);
  }

  return Array.from(componentMap.values());
}

// ---------------------------------------------------------------------------
// Project coplanar faces to 2D and extract boundary edges
// ---------------------------------------------------------------------------

function projectFacesTo2D(
  faces: Face3D[],
  groupNormal: Vec3,
  up: UpAxis,
): { widthM: number; heightM: number; edges: Array<{ a: Vec2; b: Vec2 }> } | null {
  if (faces.length === 0) return null;

  const upComp = Math.abs(getUp(groupNormal, up));
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
        ? normalize({ x: groupNormal.x, y: 0, z: groupNormal.z })
        : normalize({ x: groupNormal.x, y: groupNormal.y, z: 0 });

    if (vlength(hDir) < 0.01) return null;

    const worldUp = getUpVec(up);
    uAxis = normalize(cross(worldUp, hDir));
    vAxis = worldUp;
  }

  // Project all faces to 2D; count how many faces each edge belongs to.
  // Boundary edge = appears in exactly 1 face.
  // Internal edge (triangulation) = shared by 2 faces → discard.
  const edgeFaceCount = new Map<string, number>();
  const edgeCoords = new Map<
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
      edgeFaceCount.set(key, (edgeFaceCount.get(key) ?? 0) + 1);
      if (!edgeCoords.has(key)) {
        edgeCoords.set(key, {
          ax: pts[i].x, ay: pts[i].y,
          bx: pts[j].x, by: pts[j].y,
        });
      }
    }
  }

  // Keep only boundary edges (count === 1).
  const boundaryEdges: Array<{ ax: number; ay: number; bx: number; by: number }> = [];
  for (const [key, count] of edgeFaceCount) {
    if (count === 1) {
      const coords = edgeCoords.get(key)!;
      boundaryEdges.push(coords);
    }
  }

  if (boundaryEdges.length === 0) return null;

  // Bounding box and normalize to (0,0).
  let minU = Infinity, maxU = -Infinity;
  let minV = Infinity, maxV = -Infinity;

  for (const e of boundaryEdges) {
    minU = Math.min(minU, e.ax, e.bx);
    maxU = Math.max(maxU, e.ax, e.bx);
    minV = Math.min(minV, e.ay, e.by);
    maxV = Math.max(maxV, e.ay, e.by);
  }

  const w = maxU - minU;
  const h = maxV - minV;
  if (w < 0.01 || h < 0.01) return null;

  const edges: Array<{ a: Vec2; b: Vec2 }> = [];
  for (const e of boundaryEdges) {
    edges.push({
      a: { x: e.ax - minU, y: e.ay - minV },
      b: { x: e.bx - minU, y: e.by - minV },
    });
  }

  return { widthM: w, heightM: h, edges };
}

// ---------------------------------------------------------------------------
// Decompose model into classified panels using geometric coplanarity
// ---------------------------------------------------------------------------

function decomposeIntoPanels(
  faces: Face3D[],
  up: UpAxis,
): Panel[] {
  // 1. Cluster ALL faces by coplanarity (normal + plane offset).
  const coplanarGroups = clusterByCoplanarity(faces, up);

  // 2. Detect floor levels for assigning floor indices.
  const levels = detectFloorLevels(faces, up);

  // 3. For each coplanar group, split into connected components, then project.
  const rawPanels: Array<{
    category: PanelCategory;
    floorIndex: number;
    widthM: number;
    heightM: number;
    edges: Array<{ a: Vec2; b: Vec2 }>;
  }> = [];

  for (const group of coplanarGroups) {
    // Split into spatially connected components (separate walls on same plane).
    const components = splitConnectedComponents(group.faces);

    for (const compFaces of components) {
      // Project and extract boundary edges.
      const result = projectFacesTo2D(compFaces, group.normal, up);
      if (!result) continue;

      // Skip very small panels (artifacts, edges, trim pieces).
      if (result.widthM < 0.05 || result.heightM < 0.05) continue;
      if (result.widthM * result.heightM < 0.01) continue;

      // Determine floor index from vertical midpoint.
      const allElevs = compFaces.flatMap((f) =>
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
        category: group.category,
        floorIndex: floorIdx,
        widthM: result.widthM,
        heightM: result.heightM,
        edges: result.edges,
      });
    }
  }

  // 4. Assign IDs separately for walls (A-prefix) and floors (B-prefix).
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

  let wallCount = 0;
  for (const rp of walls) {
    wallCount++;
    panels.push({
      id: `A${wallCount}`,
      groupName: `wall_${wallCount}`,
      category: "wall",
      floorIndex: rp.floorIndex,
      widthM: rp.widthM,
      heightM: rp.heightM,
      edges: rp.edges,
    });
  }

  let floorCount = 0;
  for (const rp of floors) {
    floorCount++;
    panels.push({
      id: `B${floorCount}`,
      groupName: `floor_${floorCount}`,
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
// DXF generation — Autodesk-compatible AC1024 (R2010) with True Color
// Cutting sheets are always at 1:1 scale (real dimensions in metres).
// ---------------------------------------------------------------------------

/** Layer definitions for the 4-layer laser cutting protocol. */
const CS_LAYERS = [
  { name: "CUT_EXTERIOR",   aci: "1", tc: "16711680" }, // red
  { name: "ENGRAVE_VECTOR", aci: "5", tc: "255" },      // blue
  { name: "ENGRAVE_RASTER", aci: "7", tc: "0" },        // black
  { name: "CUT_INTERIOR",   aci: "3", tc: "65280" },    // green
];

/** Empty CLASSES section — required by Autodesk between HEADER and TABLES. */
function dxfClasses(): string {
  return "  0\r\nSECTION\r\n  2\r\nCLASSES\r\n  0\r\nENDSEC\r\n";
}

/** Empty OBJECTS section — required by Autodesk after ENTITIES. */
function dxfObjects(): string {
  return "  0\r\nSECTION\r\n  2\r\nOBJECTS\r\n  0\r\nENDSEC\r\n";
}

/**
 * Complete TABLES section required by Autodesk Viewer (AC1024 / R2010).
 * Includes: VPORT, LTYPE (ByBlock+ByLayer+Continuous), LAYER, STYLE, VIEW,
 * UCS, APPID, DIMSTYLE, BLOCK_RECORD — with proper handles and subclass markers.
 */
function dxfTables(layers: Array<{name: string, aci: string, tc: string}>): string {
  // Layer "0" is mandatory — referenced by $CLAYER and BLOCK entities.
  const layer0 = [
    "  0", "LAYER",
    "  5", "2F",
    "330", "1",
    "100", "AcDbSymbolTableRecord",
    "100", "AcDbLayerTableRecord",
    "  2", "0",
    " 70", "0",
    " 62", "7",
    "  6", "Continuous",
    "370", "-3",
  ].join("\r\n");

  // Custom layers start at handle 0x30 to avoid collisions with STYLE (0x29)
  // and APPID (0x2A) records.
  const layerRecords = layers.map((l, idx) => [
    "  0", "LAYER",
    "  5", (0x30 + idx).toString(16).toUpperCase(),
    "330", "1",
    "100", "AcDbSymbolTableRecord",
    "100", "AcDbLayerTableRecord",
    "  2", l.name,
    " 70", "0",
    " 62", "7",
    "420", l.tc,
    "  6", "Continuous",
    "370", "-3",
  ].join("\r\n")).join("\r\n");

  return [
    "  0", "SECTION", "  2", "TABLES",
    // VPORT
    "  0", "TABLE", "  2", "VPORT", "  5", "8", "330", "0", "100", "AcDbSymbolTable", " 70", "0",
    "  0", "ENDTAB",
    // LTYPE
    "  0", "TABLE", "  2", "LTYPE", "  5", "2", "330", "0", "100", "AcDbSymbolTable", " 70", "3",
    "  0", "LTYPE", "  5", "24", "330", "2", "100", "AcDbSymbolTableRecord", "100", "AcDbLinetypeTableRecord",
    "  2", "ByBlock", " 70", "0", "  3", "", " 72", "65", " 73", "0", " 40", "0.0",
    "  0", "LTYPE", "  5", "25", "330", "2", "100", "AcDbSymbolTableRecord", "100", "AcDbLinetypeTableRecord",
    "  2", "ByLayer", " 70", "0", "  3", "", " 72", "65", " 73", "0", " 40", "0.0",
    "  0", "LTYPE", "  5", "26", "330", "2", "100", "AcDbSymbolTableRecord", "100", "AcDbLinetypeTableRecord",
    "  2", "Continuous", " 70", "0", "  3", "", " 72", "65", " 73", "0", " 40", "0.0",
    "  0", "ENDTAB",
    // LAYER (count = custom layers + layer "0")
    "  0", "TABLE", "  2", "LAYER", "  5", "1", "330", "0", "100", "AcDbSymbolTable", " 70", String(layers.length + 1),
    layer0,
    layerRecords,
    "  0", "ENDTAB",
    // STYLE
    "  0", "TABLE", "  2", "STYLE", "  5", "5", "330", "0", "100", "AcDbSymbolTable", " 70", "1",
    "  0", "STYLE", "  5", "29", "330", "5", "100", "AcDbSymbolTableRecord", "100", "AcDbTextStyleTableRecord",
    "  2", "Standard", " 70", "0", " 40", "0.0", " 41", "1.0", " 50", "0.0", " 71", "0", " 42", "2.5", "  3", "txt", "  4", "",
    "  0", "ENDTAB",
    // VIEW
    "  0", "TABLE", "  2", "VIEW", "  5", "7", "330", "0", "100", "AcDbSymbolTable", " 70", "0",
    "  0", "ENDTAB",
    // UCS
    "  0", "TABLE", "  2", "UCS", "  5", "6", "330", "0", "100", "AcDbSymbolTable", " 70", "0",
    "  0", "ENDTAB",
    // APPID
    "  0", "TABLE", "  2", "APPID", "  5", "3", "330", "0", "100", "AcDbSymbolTable", " 70", "1",
    "  0", "APPID", "  5", "2A", "330", "3", "100", "AcDbSymbolTableRecord", "100", "AcDbRegAppTableRecord",
    "  2", "ACAD", " 70", "0",
    "  0", "ENDTAB",
    // DIMSTYLE
    "  0", "TABLE", "  2", "DIMSTYLE", "  5", "4", "330", "0", "100", "AcDbSymbolTable", " 70", "0",
    "100", "AcDbDimStyleTable",
    "  0", "ENDTAB",
    // BLOCK_RECORD
    "  0", "TABLE", "  2", "BLOCK_RECORD", "  5", "9", "330", "0", "100", "AcDbSymbolTable", " 70", "2",
    "  0", "BLOCK_RECORD", "  5", "17", "330", "9", "100", "AcDbSymbolTableRecord", "100", "AcDbBlockTableRecord",
    "  2", "*Model_Space", "340", "1A", " 70", "0", "280", "1", "281", "0",
    "  0", "BLOCK_RECORD", "  5", "1B", "330", "9", "100", "AcDbSymbolTableRecord", "100", "AcDbBlockTableRecord",
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

function panelsToDxf(placed: PlacedPanel[]): string {
  const textH = 0.15;     // panel ID text height (metres)
  const dimTextH = 0.10;  // dimension text height (metres)

  // HEADER section
  const headerStr = [
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

  // ENTITIES section content (goes through joinDxf for padding)
  const lines: string[] = [
    "0", "SECTION", "2", "ENTITIES",
  ];

  // Layer → [ACI color, True Color 24-bit RGB int] per entity.
  const layerStyle: Record<string, { aci: string; tc: string }> = {
    CUT_EXTERIOR:   { aci: "1", tc: "16711680" }, // red   255,0,0
    ENGRAVE_VECTOR: { aci: "5", tc: "255" },      // blue  0,0,255
    ENGRAVE_RASTER: { aci: "7", tc: "0" },        // black 0,0,0
    CUT_INTERIOR:   { aci: "3", tc: "65280" },    // green 0,255,0
  };

  /** Incremental entity handle counter (starts at 0x100 to avoid table handles). */
  let handleCounter = 0x100;
  const nextHandle = () => (handleCounter++).toString(16).toUpperCase();

  const addLine = (x1: number, y1: number, x2: number, y2: number, layer: string) => {
    const s = layerStyle[layer] ?? { aci: "7", tc: "0" };
    lines.push("0", "LINE",
      "5", nextHandle(), "330", "17",
      "100", "AcDbEntity",
      "8", layer,
      "62", s.aci, "420", s.tc,
      "100", "AcDbLine",
      "10", r(x1), "20", r(y1), "30", "0.0",
      "11", r(x2), "21", r(y2), "31", "0.0");
  };

  const addText = (x: number, y: number, h: number, text: string, layer: string) => {
    const s = layerStyle[layer] ?? { aci: "7", tc: "0" };
    lines.push("0", "TEXT",
      "5", nextHandle(), "330", "17",
      "100", "AcDbEntity",
      "8", layer,
      "62", s.aci, "420", s.tc,
      "100", "AcDbText",
      "10", r(x), "20", r(y), "30", "0.0",
      "40", r(h), "1", text,
      "72", "1",  // horizontal justification = center
      "11", r(x), "21", r(y), "31", "0.0");  // alignment point for centered text
  };

  for (const { panel, x, y } of placed) {
    const pw = panel.widthM;
    const ph = panel.heightM;

    // Draw panel outline edges (CUT_EXTERIOR layer — red).
    for (const edge of panel.edges) {
      addLine(
        x + edge.a.x, y + edge.a.y,
        x + edge.b.x, y + edge.b.y,
        "CUT_EXTERIOR",
      );
    }

    // Panel ID label centered above panel (ENGRAVE_VECTOR layer — blue).
    addText(
      x + pw / 2,
      y + ph + GAP_M * 0.2,
      textH,
      panel.id,
      "ENGRAVE_VECTOR",
    );

    // Dimensions below panel (ENGRAVE_RASTER layer — black).
    addText(
      x + pw / 2,
      y - GAP_M * 0.35,
      dimTextH,
      `${pw.toFixed(2)} x ${ph.toFixed(2)} m`,
      "ENGRAVE_RASTER",
    );
  }

  lines.push("0", "ENDSEC");
  // Order: HEADER → CLASSES → TABLES → BLOCKS → ENTITIES → OBJECTS → EOF
  return headerStr + dxfClasses() + dxfTables(CS_LAYERS) + dxfBlocks() + joinDxf(lines) + dxfObjects() + joinDxf(["0", "EOF"]);
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
