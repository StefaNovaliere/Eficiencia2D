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

import type { DecompositionMode, Face3D, Vec2, Vec3 } from "./types";
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

/** Snap to 1cm grid for robust edge-key matching (output uses original coords). */
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

/** Snap a 3D coordinate for connectivity grouping (1cm grid). */
function snap3(v: number): number {
  return Math.round(v * 100) / 100;
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
): { edges: Array<{ a: Vec2; b: Vec2 }> } | null {
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

  // Return edges in raw projected coordinates (no normalization).
  // The caller will normalize per-polygon after cycle extraction.
  const edges: Array<{ a: Vec2; b: Vec2 }> = [];
  for (const e of boundaryEdges) {
    edges.push({
      a: { x: e.ax, y: e.ay },
      b: { x: e.bx, y: e.by },
    });
  }

  return { edges };
}

// ---------------------------------------------------------------------------
// Planar graph cycle extraction: split branching edge graphs into simple polygons
// ---------------------------------------------------------------------------

/**
 * Given a set of 2D boundary edges, check if the graph has branching vertices
 * (degree > 2). If so, use planar face extraction (always-turn-left) to
 * decompose into simple polygon cycles. Returns an array of edge arrays,
 * each forming a closed simple polygon.
 */
function extractSimplePolygons(
  edges: Array<{ a: Vec2; b: Vec2 }>,
): Array<Array<{ a: Vec2; b: Vec2 }>> {
  // Build adjacency: vertex key → list of neighbor vertex keys
  const adj = new Map<string, Array<{ key: string; x: number; y: number }>>();

  function vk(p: Vec2): string {
    return `${snap(p.x)},${snap(p.y)}`;
  }
  function vCoord(p: Vec2): { key: string; x: number; y: number } {
    return { key: vk(p), x: snap(p.x), y: snap(p.y) };
  }

  // Collect all vertex positions
  const vertPos = new Map<string, { x: number; y: number }>();

  for (const e of edges) {
    const ak = vk(e.a);
    const bk = vk(e.b);
    const ac = vCoord(e.a);
    const bc = vCoord(e.b);

    vertPos.set(ak, { x: ac.x, y: ac.y });
    vertPos.set(bk, { x: bc.x, y: bc.y });

    if (!adj.has(ak)) adj.set(ak, []);
    if (!adj.has(bk)) adj.set(bk, []);
    adj.get(ak)!.push(bc);
    adj.get(bk)!.push(ac);
  }

  // Check if any vertex has degree > 2
  let hasBranching = false;
  for (const [, neighbors] of adj) {
    if (neighbors.length > 2) { hasBranching = true; break; }
  }

  // If no branching, return original edges as single polygon
  if (!hasBranching) return [edges];

  // Sort neighbors of each vertex by angle for planar face extraction
  for (const [key, neighbors] of adj) {
    const pos = vertPos.get(key)!;
    neighbors.sort((a, b) => {
      const angA = Math.atan2(a.y - pos.y, a.x - pos.x);
      const angB = Math.atan2(b.y - pos.y, b.x - pos.x);
      return angA - angB;
    });
  }

  // Build half-edge structure for cycle extraction
  // A half-edge goes from src → dst. The "twin" goes from dst → src.
  // For each half-edge (src→dst), find "next": at dst, find twin (dst→src) in
  // dst's sorted neighbor list, then take the NEXT neighbor clockwise.
  // This gives the next half-edge (dst→nextNeighbor) in the face.

  const usedHalfEdges = new Set<string>();
  const cycles: Array<Array<{ a: Vec2; b: Vec2 }>> = [];

  function halfEdgeKey(from: string, to: string): string {
    return `${from}->${to}`;
  }

  function getNextHalfEdge(fromKey: string, toKey: string): string {
    // At vertex toKey, find the reverse direction (toKey→fromKey) in the sorted
    // neighbor list, then return the NEXT neighbor (wrapping around).
    const neighbors = adj.get(toKey)!;
    let reverseIdx = -1;
    for (let i = 0; i < neighbors.length; i++) {
      if (neighbors[i].key === fromKey) {
        reverseIdx = i;
        break;
      }
    }
    if (reverseIdx === -1) return fromKey; // shouldn't happen

    // Next clockwise = previous in the CCW-sorted list (wrap around)
    const nextIdx = (reverseIdx - 1 + neighbors.length) % neighbors.length;
    return neighbors[nextIdx].key;
  }

  // Extract all cycles
  for (const [srcKey, neighbors] of adj) {
    for (const dst of neighbors) {
      const heKey = halfEdgeKey(srcKey, dst.key);
      if (usedHalfEdges.has(heKey)) continue;

      // Trace cycle
      const cycle: Array<{ fromKey: string; toKey: string }> = [];
      let curFrom = srcKey;
      let curTo = dst.key;
      let safe = 0;

      while (safe < 10000) {
        const ck = halfEdgeKey(curFrom, curTo);
        if (usedHalfEdges.has(ck)) break;
        usedHalfEdges.add(ck);
        cycle.push({ fromKey: curFrom, toKey: curTo });

        const nextTo = getNextHalfEdge(curFrom, curTo);
        curFrom = curTo;
        curTo = nextTo;
        safe++;

        if (curFrom === srcKey && curTo === dst.key) break;
      }

      if (cycle.length >= 3) {
        // Convert cycle to edges with original coordinates
        const polyEdges: Array<{ a: Vec2; b: Vec2 }> = [];
        for (const he of cycle) {
          const aPos = vertPos.get(he.fromKey)!;
          const bPos = vertPos.get(he.toKey)!;
          polyEdges.push({
            a: { x: aPos.x, y: aPos.y },
            b: { x: bPos.x, y: bPos.y },
          });
        }
        cycles.push(polyEdges);
      }
    }
  }

  if (cycles.length === 0) return [edges];

  // Discard the outer (unbounded) face: it has clockwise winding (negative signed area).
  // Interior faces have counter-clockwise winding (positive signed area).
  return cycles.filter(c => {
    if (c.length < 3) return false;
    // Compute signed area using the shoelace formula on the cycle vertices.
    let signedArea = 0;
    for (const e of c) {
      signedArea += (e.b.x - e.a.x) * (e.b.y + e.a.y);
    }
    // Negative signedArea in this formulation = CCW = interior face (keep)
    // Positive signedArea = CW = outer face (discard)
    return signedArea < 0;
  });
}

// ---------------------------------------------------------------------------
// Simple-mode filter: keep only the largest face per wall orientation
// ---------------------------------------------------------------------------

/**
 * For "simple" mode, reduce coplanar groups to one per wall orientation:
 *   1. Pair up groups with opposite normals (interior + exterior of same wall)
 *      that are close together (within wall thickness ≈ 0.5m).
 *   2. From each pair, keep only the group with the larger total area (exterior).
 *   3. Discard any remaining group whose area is < 10% of the largest (cantos).
 *
 * Floor groups pass through unchanged.
 */
function filterGroupsForSimpleMode(groups: CoplanarGroup[]): CoplanarGroup[] {
  const walls = groups.filter((g) => g.category === "wall");
  const floors = groups.filter((g) => g.category === "floor");

  // Pair interior/exterior faces of the same wall.
  const used = new Set<number>();
  const kept: CoplanarGroup[] = [];

  for (let i = 0; i < walls.length; i++) {
    if (used.has(i)) continue;
    used.add(i);

    let best = walls[i];

    for (let j = i + 1; j < walls.length; j++) {
      if (used.has(j)) continue;

      // Opposite normals → same wall, interior vs exterior.
      const d = dot(walls[i].normal, walls[j].normal);
      if (d > -0.85) continue;

      // Close in space → wall thickness (|d_i + d_j| ≈ thickness).
      if (Math.abs(walls[i].d + walls[j].d) > 0.5) continue;

      used.add(j);
      if (walls[j].totalArea > best.totalArea) {
        best = walls[j];
      }
    }

    kept.push(best);
  }

  // Discard cantos: groups with area < 10% of the largest.
  const maxArea = Math.max(...kept.map((g) => g.totalArea), 0);
  const filtered = kept.filter((g) => g.totalArea >= maxArea * 0.10);

  return [...filtered, ...floors];
}

// ---------------------------------------------------------------------------
// Decompose model into classified panels using geometric coplanarity
// ---------------------------------------------------------------------------

function decomposeIntoPanels(
  faces: Face3D[],
  up: UpAxis,
  simpleMode: boolean,
): Panel[] {
  // 1. Cluster ALL faces by coplanarity (normal + plane offset).
  let coplanarGroups = clusterByCoplanarity(faces, up);

  // 1b. In simple mode, keep only the largest face per wall orientation.
  if (simpleMode) {
    coplanarGroups = filterGroupsForSimpleMode(coplanarGroups);
  }

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

      // Split branching edge graphs into simple polygon cycles.
      const polygons = extractSimplePolygons(result.edges);

      for (const polyEdges of polygons) {
        // Compute bounding box for this polygon.
        let minU = Infinity, maxU = -Infinity;
        let minV = Infinity, maxV = -Infinity;
        for (const e of polyEdges) {
          minU = Math.min(minU, e.a.x, e.b.x);
          maxU = Math.max(maxU, e.a.x, e.b.x);
          minV = Math.min(minV, e.a.y, e.b.y);
          maxV = Math.max(maxV, e.a.y, e.b.y);
        }
        const w = maxU - minU;
        const h = maxV - minV;

        // Skip very small panels (artifacts, edges, trim pieces).
        if (w < 0.05 || h < 0.05) continue;
        if (w * h < 0.01) continue;

        // Normalize edges to (0,0) origin.
        const normalizedEdges = polyEdges.map(e => ({
          a: { x: e.a.x - minU, y: e.a.y - minV },
          b: { x: e.b.x - minU, y: e.b.y - minV },
        }));

        rawPanels.push({
          category: group.category,
          floorIndex: floorIdx,
          widthM: w,
          heightM: h,
          edges: normalizedEdges,
        });
      }
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
// DXF generation — AC1009 (R12) for maximum compatibility with Autodesk
// Viewer, QCAD, LibreCAD, and laser-cutting software.
// Cutting sheets are always at 1:1 scale (real dimensions in metres).
// ---------------------------------------------------------------------------

/** Layer definitions for the 4-layer laser cutting protocol. */
const CS_LAYERS = [
  { name: "CUT_EXTERIOR",   aci: "1" }, // red
  { name: "ENGRAVE_VECTOR", aci: "5" }, // blue
  { name: "ENGRAVE_RASTER", aci: "7" }, // white
  { name: "CUT_INTERIOR",   aci: "3" }, // green
];


function panelsToDxf(placed: PlacedPanel[]): string {
  const textH = 0.15;     // panel ID text height (metres)
  const dimTextH = 0.10;  // dimension text height (metres)

  const lines: string[] = [];

  // HEADER section
  lines.push(
    "0", "SECTION",
    "2", "HEADER",
    "9", "$ACADVER",
    "1", "AC1009",
    "9", "$INSUNITS",
    "70", "6",
    "0", "ENDSEC",
  );

  // TABLES section
  lines.push(
    "0", "SECTION",
    "2", "TABLES",
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
    "0", "TABLE",
    "2", "LAYER",
    "70", String(CS_LAYERS.length),
  );

  for (const l of CS_LAYERS) {
    lines.push(
      "0", "LAYER",
      "2", l.name,
      "70", "0",
      "62", l.aci,
      "6", "CONTINUOUS",
    );
  }

  lines.push("0", "ENDTAB", "0", "ENDSEC");

  // ENTITIES section
  lines.push("0", "SECTION", "2", "ENTITIES");

  for (const { panel, x, y } of placed) {
    const pw = panel.widthM;
    const ph = panel.heightM;

    // Draw panel outline edges (CUT_EXTERIOR layer — red).
    for (const edge of panel.edges) {
      lines.push(
        "0", "LINE",
        "8", "CUT_EXTERIOR",
        "62", "1",
        "10", r(x + edge.a.x),
        "20", r(y + edge.a.y),
        "11", r(x + edge.b.x),
        "21", r(y + edge.b.y),
      );
    }

    // Panel ID label centered above panel (ENGRAVE_VECTOR layer — blue).
    const labelX = r(x + pw / 2);
    const labelY = r(y + ph + GAP_M * 0.2);
    lines.push(
      "0", "TEXT",
      "8", "ENGRAVE_VECTOR",
      "62", "5",
      "10", labelX,
      "20", labelY,
      "40", r(textH),
      "1", panel.id,
      "72", "1",
      "11", labelX,
      "21", labelY,
    );

    // Dimensions below panel (ENGRAVE_RASTER layer — white/7).
    const dimX = r(x + pw / 2);
    const dimY = r(y - GAP_M * 0.35);
    lines.push(
      "0", "TEXT",
      "8", "ENGRAVE_RASTER",
      "62", "7",
      "10", dimX,
      "20", dimY,
      "40", r(dimTextH),
      "1", `${pw.toFixed(2)} x ${ph.toFixed(2)} m`,
      "72", "1",
      "11", dimX,
      "21", dimY,
    );
  }

  lines.push("0", "ENDSEC", "0", "EOF");
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function generateCuttingSheets(
  faces: Face3D[],
  upAxis: "Y" | "Z",
  _scaleDenom: number,
  mode?: DecompositionMode,
): Array<{ name: string; content: string }> {
  const simpleMode = (mode ?? "simple") === "simple";
  const panels = decomposeIntoPanels(faces, upAxis, simpleMode);
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
