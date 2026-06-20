"use client";

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { OrbitControls, GizmoHelper, GizmoViewport, Line, Html } from "@react-three/drei";
import type React from "react";
import * as THREE from "three";
import type { Face3D, Vec3 } from "@/core/types";
import type { FaceCategory, GeometryGroup } from "@/core/group-classifier";
import { computeMarkedOpeningGroups3D, type MarkOpeningGroupLines } from "@/core/mark-preview";
import { computeCutPreviewSegments, type CutPreviewSegment } from "@/core/cut-preview";
import {
  worldPointToPanelUV,
  getGroupPanelSize,
  getGroupProjection,
  type PanelProjection,
} from "@/core/cut-preview";
import type { UserCut } from "@/core/user-cuts";
import type { CutDragState } from "@/core/user-cuts";
import { useViewerPalette, type ViewerPalette } from "@/context/ThemeContext";

// A floating reference label (panel id) anchored to a component in 3D, drawn
// when the user selects a wall-wall joint in the review list.
export interface LeaderMarker {
  groupId: number;
  anchor: Vec3;     // component centroid, in pre-offset model space
  label: string;    // panel id, e.g. "A2"
  primary: boolean; // the selected wall (true) vs the joined "other" wall
}

// ---------------------------------------------------------------------------
// Shared materials (created once at module load, reused across all renders)
// ---------------------------------------------------------------------------

function hexToNumber(hex: string): number {
  return parseInt(hex.replace("#", ""), 16);
}

function makeMaterial(hex: string, opacity: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: hexToNumber(hex),
    side: THREE.DoubleSide,
    transparent: opacity < 1.0,
    opacity,
    depthWrite: opacity > 0.9,
    roughness: 0.55,
    metalness: 0.12,
  });
}

export interface ViewerMaterials {
  normal: Record<FaceCategory, THREE.MeshStandardMaterial>;
  solid: Record<FaceCategory, THREE.MeshStandardMaterial>;
  dimmed: Record<FaceCategory, THREE.MeshStandardMaterial>;
  highlight: THREE.MeshStandardMaterial;
  highlightWire: THREE.LineBasicMaterial;
  edge: THREE.LineBasicMaterial;
}

function createViewerMaterials(palette: ViewerPalette): ViewerMaterials {
  const cats: FaceCategory[] = ["floor", "wall", "discard"];
  const colorByCat: Record<FaceCategory, string> = {
    floor: palette.floor,
    wall: palette.wall,
    discard: palette.discard,
  };

  const normal = {} as Record<FaceCategory, THREE.MeshStandardMaterial>;
  const solid = {} as Record<FaceCategory, THREE.MeshStandardMaterial>;
  const dimmed = {} as Record<FaceCategory, THREE.MeshStandardMaterial>;

  for (const cat of cats) {
    const hex = colorByCat[cat];
    normal[cat] = makeMaterial(hex, cat === "discard" ? 0.82 : 1.0);
    solid[cat] = makeMaterial(hex, 1.0);
    dimmed[cat] = makeMaterial(hex, cat === "discard" ? 0.08 : 0.14);
  }

  return {
    normal,
    solid,
    dimmed,
    highlight: new THREE.MeshStandardMaterial({
      color: hexToNumber(palette.highlight),
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.48,
      roughness: 0.45,
      metalness: 0.15,
    }),
    highlightWire: new THREE.LineBasicMaterial({ color: hexToNumber(palette.highlight) }),
    edge: new THREE.LineBasicMaterial({
      color: hexToNumber(palette.edge),
      transparent: true,
      opacity: palette.edgeOpacity,
      depthTest: true,
    }),
  };
}

function disposeViewerMaterials(materials: ViewerMaterials) {
  const all = [
    ...Object.values(materials.normal),
    ...Object.values(materials.solid),
    ...Object.values(materials.dimmed),
    materials.highlight,
    materials.highlightWire,
    materials.edge,
  ];
  for (const m of all) m.dispose();
}

// ---------------------------------------------------------------------------
// Merged geometry per (effective category)
// ---------------------------------------------------------------------------

interface MergedMeshData {
  category: FaceCategory;
  geometry: THREE.BufferGeometry;
  edgeGeometry: THREE.BufferGeometry | null;
  groupIds: number[]; // groupId per triangle, for raycasting
}

function edgeKey(ax: number, ay: number, az: number, bx: number, by: number, bz: number): string {
  const p = 5;
  const a = `${ax.toFixed(p)},${ay.toFixed(p)},${az.toFixed(p)}`;
  const b = `${bx.toFixed(p)},${by.toFixed(p)},${bz.toFixed(p)}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Triangula una cara (posible n-gon CÓNCAVO) proyectándola a 2D según su normal,
 * con ShapeUtils (earcut interno). Devuelve índices (de a 3) dentro de
 * face.vertices. Reemplaza la triangulación "fan", que rellenaba las concavidades
 * (p. ej. losas en U / huecos de escalera).
 */
function triangulateFace(face: Face3D): number[] {
  const vs = face.vertices;
  if (vs.length < 3) return [];
  if (vs.length === 3) return [0, 1, 2];

  const nx = Math.abs(face.normal.x);
  const ny = Math.abs(face.normal.y);
  const nz = Math.abs(face.normal.z);

  // Proyectar al plano que descarta el eje dominante de la normal.
  const contour: THREE.Vector2[] = [];
  if (nx >= ny && nx >= nz) {
    for (const v of vs) contour.push(new THREE.Vector2(v.y, v.z));
  } else if (ny >= nx && ny >= nz) {
    for (const v of vs) contour.push(new THREE.Vector2(v.x, v.z));
  } else {
    for (const v of vs) contour.push(new THREE.Vector2(v.x, v.y));
  }

  const tris = THREE.ShapeUtils.triangulateShape(contour, []);

  // Fallback a fan si earcut no pudo (cara degenerada): mejor algo que nada.
  if (tris.length === 0) {
    const out: number[] = [];
    for (let i = 1; i < vs.length - 1; i++) out.push(0, i, i + 1);
    return out;
  }

  const out: number[] = [];
  for (const t of tris) out.push(t[0], t[1], t[2]);
  return out;
}

/**
 * For a group with detected thickness, fill the open perimeter band between
 * its two parallel skins so the slab renders as a solid volume instead of two
 * floating planes. Splits the group's faces into a near/far skin along the
 * representative normal, finds the near skin's boundary loop, and extrudes it
 * to the far skin as side quads.
 */
function pushThicknessSides(
  faces: Face3D[],
  group: GeometryGroup,
  pushTri: (p0: Vec3, p1: Vec3, p2: Vec3) => void,
): void {
  const t = group.thickness;
  if (t == null || t < 0.001) return;
  const n = group.representativeNormal;
  const nlen = Math.hypot(n.x, n.y, n.z);
  if (nlen < 1e-6) return;
  const nx = n.x / nlen, ny = n.y / nlen, nz = n.z / nlen;

  const groupFaces = group.faceIndices
    .map((fi) => faces[fi])
    .filter((f): f is Face3D => !!f && f.vertices.length >= 3);
  if (groupFaces.length < 2) return;

  // Offset of each face centroid along the normal; split at the midpoint.
  const offsets = groupFaces.map((f) => {
    let cx = 0, cy = 0, cz = 0;
    for (const v of f.vertices) { cx += v.x; cy += v.y; cz += v.z; }
    const k = f.vertices.length;
    return (cx / k) * nx + (cy / k) * ny + (cz / k) * nz;
  });
  const minO = Math.min(...offsets);
  const maxO = Math.max(...offsets);
  if (maxO - minO < 0.001) return; // single skin, nothing to fill
  const mid = (minO + maxO) / 2;
  const near = groupFaces.filter((_, i) => offsets[i] <= mid);
  if (near.length === 0) return;
  const shift = maxO - minO; // distance to the far skin

  // Boundary edges of the near skin = edges used by exactly one near face.
  const snap = (v: number) => Math.round(v * 1000) / 1000;
  const key = (a: Vec3, b: Vec3) => {
    const ka = `${snap(a.x)},${snap(a.y)},${snap(a.z)}`;
    const kb = `${snap(b.x)},${snap(b.y)},${snap(b.z)}`;
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  };
  const edgeCount = new Map<string, { a: Vec3; b: Vec3; count: number }>();
  for (const f of near) {
    for (let i = 0; i < f.vertices.length; i++) {
      const a = f.vertices[i];
      const b = f.vertices[(i + 1) % f.vertices.length];
      const k = key(a, b);
      const ex = edgeCount.get(k);
      if (ex) ex.count++;
      else edgeCount.set(k, { a, b, count: 1 });
    }
  }

  for (const { a, b, count } of edgeCount.values()) {
    if (count !== 1) continue; // interior edge
    const a2 = { x: a.x + nx * shift, y: a.y + ny * shift, z: a.z + nz * shift };
    const b2 = { x: b.x + nx * shift, y: b.y + ny * shift, z: b.z + nz * shift };
    pushTri(a, b, b2);
    pushTri(a, b2, a2);
  }
}

function buildMergedGeometries(
  faces: Face3D[],
  groups: GeometryGroup[],
  overrides: Map<number, FaceCategory>,
  hiddenGroupIds: Set<number>,
): MergedMeshData[] {
  const byCategory = new Map<
    FaceCategory,
    { positions: number[]; groupIds: number[] }
  >();
  for (const cat of ["floor", "wall", "discard"] as FaceCategory[]) {
    byCategory.set(cat, { positions: [], groupIds: [] });
  }

  for (const group of groups) {
    if (hiddenGroupIds.has(group.id)) continue;
    const cat = overrides.get(group.id) ?? group.category;
    const bucket = byCategory.get(cat)!;

    for (const fi of group.faceIndices) {
      const face = faces[fi];
      if (!face || face.vertices.length < 3) continue;
      const tris = triangulateFace(face);
      for (let i = 0; i < tris.length; i += 3) {
        const a = face.vertices[tris[i]];
        const b = face.vertices[tris[i + 1]];
        const c = face.vertices[tris[i + 2]];
        bucket.positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
        bucket.groupIds.push(group.id);
      }
    }

    // Fill the side band so detected-thickness slabs render as solids.
    pushThicknessSides(faces, group, (p0, p1, p2) => {
      bucket.positions.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
      bucket.groupIds.push(group.id);
    });
  }

  const result: MergedMeshData[] = [];
  for (const [cat, bucket] of byCategory.entries()) {
    if (bucket.positions.length === 0) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(bucket.positions, 3));
    geo.computeVertexNormals();

    // Build boundary edges between different groups within this category.
    const edgeMap = new Map<string, { gid: number; ax: number; ay: number; az: number; bx: number; by: number; bz: number }>();
    const boundaryEdgePositions: number[] = [];
    const triCount = bucket.groupIds.length;

    for (let t = 0; t < triCount; t++) {
      const gid = bucket.groupIds[t];
      const base = t * 9;
      const p = bucket.positions;
      const triVerts = [
        [p[base], p[base + 1], p[base + 2]],
        [p[base + 3], p[base + 4], p[base + 5]],
        [p[base + 6], p[base + 7], p[base + 8]],
      ];
      for (let e = 0; e < 3; e++) {
        const a = triVerts[e];
        const b = triVerts[(e + 1) % 3];
        const ek = edgeKey(a[0], a[1], a[2], b[0], b[1], b[2]);
        const existing = edgeMap.get(ek);
        if (existing) {
          if (existing.gid !== gid) {
            boundaryEdgePositions.push(
              existing.ax, existing.ay, existing.az,
              existing.bx, existing.by, existing.bz,
            );
          }
          edgeMap.delete(ek);
        } else {
          edgeMap.set(ek, { gid, ax: a[0], ay: a[1], az: a[2], bx: b[0], by: b[1], bz: b[2] });
        }
      }
    }

    let edgeGeometry: THREE.BufferGeometry | null = null;
    if (boundaryEdgePositions.length > 0) {
      edgeGeometry = new THREE.BufferGeometry();
      edgeGeometry.setAttribute("position", new THREE.Float32BufferAttribute(boundaryEdgePositions, 3));
    }

    result.push({ category: cat, geometry: geo, edgeGeometry, groupIds: bucket.groupIds });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Selected-group overlay geometry (just the faces of one group)
// ---------------------------------------------------------------------------

function buildSelectedGeometry(
  faces: Face3D[],
  faceIndices: number[],
): THREE.BufferGeometry {
  const positions: number[] = [];
  for (const idx of faceIndices) {
    const face = faces[idx];
    if (!face || face.vertices.length < 3) continue;
    const tris = triangulateFace(face);
    for (let i = 0; i < tris.length; i += 3) {
      const a = face.vertices[tris[i]];
      const b = face.vertices[tris[i + 1]];
      const c = face.vertices[tris[i + 2]];
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geo;
}

// ---------------------------------------------------------------------------
// Category mesh — one big merged mesh per category
// ---------------------------------------------------------------------------

interface CategoryMeshProps {
  mesh: MergedMeshData;
  isDimmed: boolean;
  isSolid: boolean;
  groupAreaById: Map<number, number>;
  materials: ViewerMaterials;
  onPick: (groupId: number) => void;
  onTogglePick: (groupId: number) => void;
  onContextMenu?: (detail: { clientX: number; clientY: number; groupId: number | null }) => void;
}

const PICK_DEPTH_EPS = 0.02;

function pickGroupFromIntersections(
  intersections: THREE.Intersection[],
  groupAreaById: Map<number, number>,
): number | null {
  if (intersections.length === 0) return null;

  const closestDist = intersections[0].distance;
  let bestId: number | null = null;
  let bestArea = Infinity;

  for (const hit of intersections) {
    if (hit.distance - closestDist > PICK_DEPTH_EPS) break;
    const data = hit.object.userData.mergedMeshData as MergedMeshData | undefined;
    if (!data || hit.faceIndex == null || hit.faceIndex < 0) continue;
    if (hit.faceIndex >= data.groupIds.length) continue;
    const groupId = data.groupIds[hit.faceIndex];
    const area = groupAreaById.get(groupId) ?? Infinity;
    if (area < bestArea) {
      bestArea = area;
      bestId = groupId;
    }
  }

  return bestId;
}

function CategoryMesh({ mesh, isDimmed, isSolid, groupAreaById, materials, onPick, onTogglePick, onContextMenu }: CategoryMeshProps) {
  const material = isDimmed
    ? materials.dimmed[mesh.category]
    : isSolid
    ? materials.solid[mesh.category]
    : materials.normal[mesh.category];

  return (
    <>
      <mesh
        geometry={mesh.geometry}
        material={material}
        userData={{ mergedMeshData: mesh }}
        onPointerDown={(e) => {
          if (e.nativeEvent.button !== 0) return;
          e.stopPropagation();
          const groupId = pickGroupFromIntersections(e.intersections, groupAreaById);
          if (groupId == null) return;
          if (e.nativeEvent.ctrlKey || e.nativeEvent.metaKey) {
            onTogglePick(groupId);
          } else {
            onPick(groupId);
          }
        }}
        onContextMenu={(e) => {
          e.stopPropagation();
          e.nativeEvent.preventDefault();
          const groupId = pickGroupFromIntersections(e.intersections, groupAreaById);
          onContextMenu?.({
            clientX: e.nativeEvent.clientX,
            clientY: e.nativeEvent.clientY,
            groupId,
          });
        }}
      />
      {mesh.edgeGeometry && !isDimmed && (
        <lineSegments geometry={mesh.edgeGeometry} material={materials.edge} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Camera + controls — constrained orbit
// ---------------------------------------------------------------------------

interface CameraControlsProps {
  target: Vec3 | null;
  maxDistance: number;
  minDistance: number;
  enabled?: boolean;
}

function CameraControls({ target, maxDistance, minDistance, enabled = true }: CameraControlsProps) {
  const controlsRef = useRef<any>(null);
  const targetVec = useMemo(
    () => (target ? new THREE.Vector3(target.x, target.y, target.z) : null),
    [target],
  );

  useFrame(() => {
    if (!targetVec || !controlsRef.current) return;
    controlsRef.current.target.lerp(targetVec, 0.08);
    controlsRef.current.update();
  });

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enabled={enabled}
      enableDamping
      dampingFactor={0.1}
      minPolarAngle={0.05}
      maxPolarAngle={Math.PI / 2 + 0.2}
      maxDistance={maxDistance}
      minDistance={minDistance}
      screenSpacePanning={false}
    />
  );
}

// ---------------------------------------------------------------------------
// Mark opening overlays — red hole contours, hidden on back faces & behind geometry
// ---------------------------------------------------------------------------

const MARK_OPENING_MATERIAL = new THREE.LineBasicMaterial({
  color: 0xdc2626,
  depthTest: true,
  depthWrite: false,
});

function buildMarkOpeningGeometry(segments: MarkOpeningGroupLines["segments"]): THREE.BufferGeometry {
  const positions = new Float32Array(segments.length * 6);
  let i = 0;
  for (const s of segments) {
    positions[i++] = s.a.x;
    positions[i++] = s.a.y;
    positions[i++] = s.a.z;
    positions[i++] = s.b.x;
    positions[i++] = s.b.y;
    positions[i++] = s.b.z;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return geo;
}

function MarkOpeningGroupOverlay({
  data,
  anchor,
}: {
  data: MarkOpeningGroupLines;
  anchor: THREE.Vector3;
}) {
  const lineRef = useRef<THREE.LineSegments>(null);
  const viewDir = useRef(new THREE.Vector3());
  const { camera } = useThree();
  const normal = useMemo(
    () => new THREE.Vector3(data.normal.x, data.normal.y, data.normal.z),
    [data.normal.x, data.normal.y, data.normal.z],
  );
  const geometry = useMemo(
    () => buildMarkOpeningGeometry(data.segments),
    [data.segments],
  );

  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame(() => {
    if (!lineRef.current) return;
    viewDir.current.subVectors(camera.position, anchor);
    lineRef.current.visible = viewDir.current.dot(normal) > 0.02;
  });

  return (
    <lineSegments ref={lineRef} geometry={geometry} material={MARK_OPENING_MATERIAL} renderOrder={2} />
  );
}

function MarkOpeningOverlays({
  groupLines,
  groups,
  centerOffset,
}: {
  groupLines: MarkOpeningGroupLines[];
  groups: GeometryGroup[];
  centerOffset: Vec3;
}) {
  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);

  const anchors = useMemo(() => {
    const map = new Map<number, THREE.Vector3>();
    for (const data of groupLines) {
      const group = groupById.get(data.groupId);
      if (!group) continue;
      map.set(
        data.groupId,
        new THREE.Vector3(
          group.centroid.x - centerOffset.x,
          group.centroid.y - centerOffset.y,
          group.centroid.z - centerOffset.z,
        ),
      );
    }
    return map;
  }, [groupLines, groupById, centerOffset.x, centerOffset.y, centerOffset.z]);

  return (
    <>
      {groupLines.map((data) => {
        const anchor = anchors.get(data.groupId);
        if (!anchor) return null;
        return <MarkOpeningGroupOverlay key={data.groupId} data={data} anchor={anchor} />;
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// User cut overlays — orange preview of subtract regions
// ---------------------------------------------------------------------------

const CUT_PREVIEW_MATERIAL = new THREE.LineBasicMaterial({
  color: 0xf97316,
  depthTest: true,
  depthWrite: false,
});

function buildCutPreviewGeometry(segments: CutPreviewSegment[]): THREE.BufferGeometry {
  const positions = new Float32Array(segments.length * 6);
  let i = 0;
  for (const s of segments) {
    positions[i++] = s.a.x;
    positions[i++] = s.a.y;
    positions[i++] = s.a.z;
    positions[i++] = s.b.x;
    positions[i++] = s.b.y;
    positions[i++] = s.b.z;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return geo;
}

function CutGroupOverlay({
  groupId,
  segments,
  anchor,
  normal,
}: {
  groupId: number;
  segments: CutPreviewSegment[];
  anchor: THREE.Vector3;
  normal: THREE.Vector3;
}) {
  const lineRef = useRef<THREE.LineSegments>(null);
  const viewDir = useRef(new THREE.Vector3());
  const { camera } = useThree();
  const geometry = useMemo(() => buildCutPreviewGeometry(segments), [segments]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame(() => {
    if (!lineRef.current) return;
    viewDir.current.subVectors(camera.position, anchor);
    // Show from BOTH sides: representativeNormal can point inward or outward
    // depending on the model exporter. depthTest:true prevents the lines from
    // showing through opaque geometry, so only hide when perfectly edge-on.
    lineRef.current.visible = Math.abs(viewDir.current.dot(normal)) > 0.02;
  });

  return (
    <lineSegments
      ref={lineRef}
      geometry={geometry}
      material={CUT_PREVIEW_MATERIAL}
      renderOrder={3}
    />
  );
}

function CutPreviewOverlays({
  segments,
  groups,
  centerOffset,
}: {
  segments: CutPreviewSegment[];
  groups: GeometryGroup[];
  centerOffset: Vec3;
}) {
  const byGroup = useMemo(() => {
    const map = new Map<number, CutPreviewSegment[]>();
    for (const s of segments) {
      const arr = map.get(s.groupId);
      if (arr) arr.push(s);
      else map.set(s.groupId, [s]);
    }
    return map;
  }, [segments]);

  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);

  return (
    <>
      {[...byGroup.entries()].map(([groupId, segs]) => {
        const group = groupById.get(groupId);
        if (!group || segs.length === 0) return null;
        const anchor = new THREE.Vector3(
          group.centroid.x - centerOffset.x,
          group.centroid.y - centerOffset.y,
          group.centroid.z - centerOffset.z,
        );
        const n = segs[0].normal;
        const normal = new THREE.Vector3(n.x, n.y, n.z);
        return (
          <CutGroupOverlay
            key={groupId}
            groupId={groupId}
            segments={segs}
            anchor={anchor}
            normal={normal}
          />
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

interface SceneProps {
  faces: Face3D[];
  groups: GeometryGroup[];
  selectedGroupIds: Set<number>;
  categoryOverrides: Map<number, FaceCategory>;
  visibleCategories: Set<FaceCategory>;
  hiddenGroupIds: Set<number>;
  onSelectGroup: (id: number) => void;
  onToggleGroup: (id: number) => void;
  onContextMenu?: (detail: { clientX: number; clientY: number; groupId: number | null }) => void;
  appliedAxis?: "Y" | "Z";
  showCenterAxes?: boolean;
  leaderMarkers?: LeaderMarker[];
  isSolid?: boolean;
  boxSelectActive?: boolean;
  markGroupIds?: Set<number>;
  userCuts?: UserCut[];
  cutDraft?: CutDragState | null;
  movingCutId?: string | null;
  panelRaycastRef: React.MutableRefObject<PanelRaycastContext>;
  palette: ViewerPalette;
  materials: ViewerMaterials;
  mergeMemberFaceIndices?: number[] | null;
}

export interface PanelRaycastContext {
  faces: Face3D[];
  groups: GeometryGroup[];
  hiddenGroupIds: Set<number>;
  appliedAxis: "Y" | "Z";
  modelCenter: Vec3;
}

const EMPTY_MARK_SET = new Set<number>();

function Scene({
  faces,
  groups,
  selectedGroupIds,
  categoryOverrides,
  visibleCategories,
  hiddenGroupIds,
  onSelectGroup,
  onToggleGroup,
  onContextMenu,
  appliedAxis = "Y",
  showCenterAxes = true,
  leaderMarkers = [],
  isSolid = false,
  boxSelectActive = false,
  markGroupIds = EMPTY_MARK_SET,
  userCuts = [],
  cutDraft = null,
  movingCutId = null,
  panelRaycastRef,
  palette,
  materials,
  mergeMemberFaceIndices = null,
}: SceneProps) {
  const selectedGroups = groups.filter((g) => selectedGroupIds.has(g.id));

  // Bounding-box centre for camera target offset.
  const bounds = useMemo(() => {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const face of faces) {
      for (const v of face.vertices) {
        if (v.x < minX) minX = v.x;
        if (v.y < minY) minY = v.y;
        if (v.z < minZ) minZ = v.z;
        if (v.x > maxX) maxX = v.x;
        if (v.y > maxY) maxY = v.y;
        if (v.z > maxZ) maxZ = v.z;
      }
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;
    const diag = Math.sqrt(
      (maxX - minX) ** 2 + (maxY - minY) ** 2 + (maxZ - minZ) ** 2,
    );
    return { center: { x: cx, y: cy, z: cz }, diag };
  }, [faces]);

  // Merged geometries — rebuilt when categories or overrides change.
  const mergedMeshes = useMemo(
    () => buildMergedGeometries(faces, groups, categoryOverrides, hiddenGroupIds),
    [faces, groups, categoryOverrides, hiddenGroupIds],
  );

  const groupAreaById = useMemo(() => {
    const map = new Map<number, number>();
    for (const g of groups) map.set(g.id, g.totalArea);
    return map;
  }, [groups]);

  // Cleanup old geometries when mergedMeshes changes.
  useEffect(() => {
    return () => {
      for (const m of mergedMeshes) {
        m.geometry.dispose();
        m.edgeGeometry?.dispose();
      }
    };
  }, [mergedMeshes]);

  // Highlight geometry for selected groups, or a focused merge member subset.
  const selectedGeometry = useMemo(() => {
    if (mergeMemberFaceIndices && mergeMemberFaceIndices.length > 0) {
      return buildSelectedGeometry(faces, mergeMemberFaceIndices);
    }
    if (selectedGroups.length === 0) return null;
    const allFaceIndices: number[] = [];
    for (const g of selectedGroups) {
      allFaceIndices.push(...g.faceIndices);
    }
    return buildSelectedGeometry(faces, allFaceIndices);
  }, [faces, selectedGroups, mergeMemberFaceIndices]);

  useEffect(() => {
    return () => {
      if (selectedGeometry) selectedGeometry.dispose();
    };
  }, [selectedGeometry]);

  // When reviewing wall-wall encounters, tint the yielding wall (la que se acorta).
  const secondaryEncounterGeometry = useMemo(() => {
    const secondaryIds = leaderMarkers.filter((m) => !m.primary).map((m) => m.groupId);
    if (secondaryIds.length === 0) return null;
    const byId = new Map(groups.map((g) => [g.id, g]));
    const faceIndices: number[] = [];
    for (const gid of secondaryIds) {
      const g = byId.get(gid);
      if (!g) continue;
      faceIndices.push(...g.faceIndices);
    }
    if (faceIndices.length === 0) return null;
    return buildSelectedGeometry(faces, faceIndices);
  }, [faces, groups, leaderMarkers]);

  useEffect(() => {
    return () => {
      secondaryEncounterGeometry?.dispose();
    };
  }, [secondaryEncounterGeometry]);

  const secondaryEncounterMaterial = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      color: hexToNumber(palette.leaderSecondary),
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.22,
      depthTest: true,
      depthWrite: false,
      roughness: 0.65,
      metalness: 0.05,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    return m;
  }, [palette.leaderSecondary]);

  useEffect(() => {
    return () => secondaryEncounterMaterial.dispose();
  }, [secondaryEncounterMaterial]);

  // Centred target: average centroid of selected groups, or model centre.
  const focusTarget: Vec3 = selectedGroups.length > 0
    ? {
        x: selectedGroups.reduce((s, g) => s + g.centroid.x, 0) / selectedGroups.length - bounds.center.x,
        y: selectedGroups.reduce((s, g) => s + g.centroid.y, 0) / selectedGroups.length - bounds.center.y,
        z: selectedGroups.reduce((s, g) => s + g.centroid.z, 0) / selectedGroups.length - bounds.center.z,
      }
    : { x: 0, y: 0, z: 0 };

  const maxDist = bounds.diag * 3;
  const minDist = bounds.diag * 0.05;

  const isZUp = appliedAxis === "Z";

  // Vertical axis (building "up") for floating the reference label above the
  // component, matching the axesHelper orientation.
  const upVec = useMemo<[number, number, number]>(
    () => (isZUp ? [0, 0, 1] : [0, 1, 0]),
    [isZUp],
  );

  // Leader line endpoints: from the component centroid up to the floating tag.
  const leaders = useMemo(() => {
    const len = bounds.diag * 0.18;
    return leaderMarkers.map((m) => {
      const start: [number, number, number] = [m.anchor.x, m.anchor.y, m.anchor.z];
      const end: [number, number, number] = [
        m.anchor.x + upVec[0] * len,
        m.anchor.y + upVec[1] * len,
        m.anchor.z + upVec[2] * len,
      ];
      return { ...m, start, end };
    });
  }, [leaderMarkers, bounds.diag, upVec]);

  // Red contours for marked openings — one overlay per group, culled by facing.
  const markOpeningGroups = useMemo(
    () =>
      computeMarkedOpeningGroups3D(
        faces,
        groups,
        markGroupIds,
        appliedAxis,
        hiddenGroupIds,
      ),
    [faces, groups, markGroupIds, appliedAxis, hiddenGroupIds],
  );

  const cutPreviewSegments = useMemo(
    () => computeCutPreviewSegments(faces, groups, userCuts, cutDraft, appliedAxis, movingCutId),
    [faces, groups, userCuts, cutDraft, appliedAxis, movingCutId],
  );

  panelRaycastRef.current = {
    faces,
    groups,
    hiddenGroupIds,
    appliedAxis,
    modelCenter: bounds.center,
  };

  return (
    <>
      <CameraControls
        target={focusTarget}
        maxDistance={maxDist}
        minDistance={minDist}
        enabled={!boxSelectActive}
      />

      {/* Ejes cartesianos en el centro del modelo */}
      {showCenterAxes && (
        <axesHelper
          args={[bounds.diag * 0.5]}
          rotation={isZUp ? [-Math.PI / 2, 0, 0] : [0, 0, 0]}
        />
      )}

      <group position={[-bounds.center.x, -bounds.center.y, -bounds.center.z]}>
        {mergedMeshes.map((mm) => {
          if (!visibleCategories.has(mm.category)) return null;
          const isDimmed = selectedGroupIds.size > 0;
          return (
            <CategoryMesh
              key={mm.category}
              mesh={mm}
              isDimmed={isDimmed}
              isSolid={isSolid}
              groupAreaById={groupAreaById}
              materials={materials}
              onPick={onSelectGroup}
              onTogglePick={onToggleGroup}
              onContextMenu={onContextMenu}
            />
          );
        })}

        {(selectedGeometry && (selectedGroups.length > 0 || (mergeMemberFaceIndices?.length ?? 0) > 0)) && (
          <>
            <mesh geometry={selectedGeometry} material={materials.highlight} />
            <lineSegments>
              <wireframeGeometry args={[selectedGeometry]} />
              <primitive object={materials.highlightWire} attach="material" />
            </lineSegments>
          </>
        )}

        {secondaryEncounterGeometry && (
          <mesh
            geometry={secondaryEncounterGeometry}
            material={secondaryEncounterMaterial}
            renderOrder={2}
          />
        )}

        {markOpeningGroups.length > 0 && (
          <MarkOpeningOverlays
            groupLines={markOpeningGroups}
            groups={groups}
            centerOffset={bounds.center}
          />
        )}

        {cutPreviewSegments.length > 0 && (
          <CutPreviewOverlays
            segments={cutPreviewSegments}
            groups={groups}
            centerOffset={bounds.center}
          />
        )}

        {/* Leader lines + floating reference tags for the selected joint */}
        {leaders.map((m) => (
          <group key={m.groupId}>
            <Line
              points={[m.start, m.end]}
              color={m.primary ? palette.leaderPrimary : palette.leaderSecondary}
              lineWidth={2}
              depthTest={false}
              transparent
              renderOrder={999}
            />
            <mesh position={m.start} renderOrder={999}>
              <sphereGeometry args={[bounds.diag * 0.006, 12, 12]} />
              <meshBasicMaterial
                color={m.primary ? palette.leaderPrimary : palette.leaderSecondary}
                depthTest={false}
                transparent
              />
            </mesh>
            <Html
              position={m.end}
              center
              occlude={false}
              zIndexRange={[100, 0]}
              style={{ pointerEvents: "none" }}
            >
              <div
                className="badge badge-sm font-mono font-bold shadow-md border"
                style={
                  m.primary
                    ? {
                        backgroundColor: palette.leaderPrimary,
                        borderColor: palette.leaderPrimary,
                        color: palette.isDark ? "#fff" : "#fff",
                      }
                    : {
                        backgroundColor: palette.background,
                        borderColor: palette.edge,
                        color: palette.edge,
                      }
                }
              >
                {m.label}
              </div>
            </Html>
          </group>
        ))}

      </group>
    </>
  );
}

// ---------------------------------------------------------------------------
// Public interface — lets ReviewScreen project world coords to screen pixels
// for box selection without importing THREE.
// ---------------------------------------------------------------------------

export interface ModelViewerHandle {
  /** Projects a world-space point (in model coords, before center-offset) to
   *  viewport pixels.  Returns null when the canvas isn't mounted yet. */
  projectToScreen(worldX: number, worldY: number, worldZ: number): { x: number; y: number } | null;
  /**
   * Raycasts a grid of points inside the screen-space rect and returns the
   * groupIds of every surface that is actually visible (frontmost hit per
   * ray sample) within that area.
   */
  selectGroupsInRect(
    rectX: number,
    rectY: number,
    rectW: number,
    rectH: number,
    hiddenGroupIds: Set<number>,
  ): Set<number>;
  /** Raycast to a panel surface; returns group id and UV in panel metres. */
  raycastPanelUV(clientX: number, clientY: number): {
    groupId: number;
    u: number;
    v: number;
  } | null;
  /**
   * Full raycast that also returns the panel projection so subsequent
   * pointer-move events can use the cheap getUVFromMouseOnPlane instead of
   * a full scene raycast.
   */
  raycastPanelFull(clientX: number, clientY: number): {
    groupId: number;
    u: number;
    v: number;
    /** 3-D hit point in scene (shifted) coords — use as the plane anchor. */
    scenePoint: { x: number; y: number; z: number };
    projection: PanelProjection;
  } | null;
  /**
   * O(1) ray-plane intersection — no scene traversal.
   * Uses the projection cached from a previous raycastPanelFull call.
   */
  getUVFromMouseOnPlane(
    clientX: number,
    clientY: number,
    sceneAnchor: { x: number; y: number; z: number },
    projection: PanelProjection,
  ): { u: number; v: number } | null;
  /** Panel bounding size in metres (same frame as raycastPanelUV). */
  getPanelSize(groupId: number): { widthM: number; heightM: number } | null;
}

/**
 * Pick the best group from a set of raycast hits.
 *
 * Strategy — priority order:
 *  1. Nearest hit whose triangle face-normal opposes the ray (front face).
 *     Uses a 5 mm "same-surface" window so both sides of a zero-thickness
 *     panel are considered ties and the front face wins.
 *  2. Nearest hit at the same surface distance regardless of face direction
 *     (handles models with flipped/missing face normals).
 *  3. Nearest non-hidden hit up to 5 cm away (thick walls / layered meshes).
 *
 * NOTE: group representativeNormal is intentionally NOT used here. It is not
 * reliable for choosing the correct surface because the model exporter can
 * set it to point in any direction. Nearest-hit = visible surface is the
 * only safe rule.
 */
function pickGroupFromRaycast(
  raycaster: THREE.Raycaster,
  hits: THREE.Intersection[],
  hiddenGroupIds: Set<number>,
): { groupId: number; point: THREE.Vector3 } | null {
  if (hits.length === 0) return null;
  const rayDir = raycaster.ray.direction;
  const closestDist = hits[0].distance;

  function tryHit(hit: THREE.Intersection): { groupId: number; point: THREE.Vector3 } | null {
    const data = hit.object.userData?.mergedMeshData as { groupIds: number[] } | undefined;
    if (!data || hit.faceIndex == null || hit.faceIndex < 0) return null;
    if (hit.faceIndex >= data.groupIds.length) return null;
    const groupId = data.groupIds[hit.faceIndex];
    if (hiddenGroupIds.has(groupId)) return null;
    return { groupId, point: hit.point.clone() };
  }

  function isFrontFace(hit: THREE.Intersection): boolean {
    if (!hit.face) return true;
    const wn = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    return wn.dot(rayDir) <= 0;
  }

  // Pass 1: same-surface window (5 mm), front-face triangles only
  for (const hit of hits) {
    if (hit.distance - closestDist > 0.005) break;
    if (!isFrontFace(hit)) continue;
    const r = tryHit(hit);
    if (r) return r;
  }

  // Pass 2: same-surface window, any triangle winding
  for (const hit of hits) {
    if (hit.distance - closestDist > 0.005) break;
    const r = tryHit(hit);
    if (r) return r;
  }

  // Pass 3: up to 5 cm — handles thick walls / layered surfaces
  for (const hit of hits) {
    if (hit.distance - closestDist > 0.05) break;
    const r = tryHit(hit);
    if (r) return r;
  }

  return null;
}

function SceneBridge({
  handleRef,
  modelCenter,
  panelRaycastRef,
}: {
  handleRef: React.MutableRefObject<ModelViewerHandle | null>;
  modelCenter: { x: number; y: number; z: number };
  panelRaycastRef: React.MutableRefObject<PanelRaycastContext>;
}) {
  const { camera, gl, scene } = useThree();

  useEffect(() => {
    handleRef.current = {
      projectToScreen(worldX, worldY, worldZ) {
        const canvas = gl.domElement;
        const rect = canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return null;

        const vec = new THREE.Vector3(
          worldX - modelCenter.x,
          worldY - modelCenter.y,
          worldZ - modelCenter.z,
        ).project(camera);

        return {
          x: ((vec.x + 1) / 2) * rect.width + rect.left,
          y: ((-vec.y + 1) / 2) * rect.height + rect.top,
        };
      },

      selectGroupsInRect(rectX, rectY, rectW, rectH, hiddenGroupIds) {
        const canvas = gl.domElement;
        const canvasRect = canvas.getBoundingClientRect();
        if (canvasRect.width === 0 || canvasRect.height === 0) return new Set();

        const raycaster = new THREE.Raycaster();
        const hitGroupIds = new Set<number>();

        // Sample a grid — roughly one ray every 8 px, capped to 20×20 = 400 rays
        const stepsX = Math.min(Math.max(Math.ceil(rectW / 8), 3), 20);
        const stepsY = Math.min(Math.max(Math.ceil(rectH / 8), 3), 20);

        for (let si = 0; si <= stepsX; si++) {
          for (let sj = 0; sj <= stepsY; sj++) {
            const clientX = rectX + (rectW / stepsX) * si;
            const clientY = rectY + (rectH / stepsY) * sj;

            const ndcX = ((clientX - canvasRect.left) / canvasRect.width) * 2 - 1;
            const ndcY = -((clientY - canvasRect.top) / canvasRect.height) * 2 + 1;

            raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
            const hits = raycaster.intersectObjects(scene.children, true);
            if (hits.length === 0) continue;

            // Accept hits within a small depth band of the closest one so
            // coplanar faces (e.g. two walls flush with each other) are both
            // captured, while walls behind the building are excluded.
            const closestDist = hits[0].distance;
            for (const hit of hits) {
              if (hit.distance - closestDist > 0.05) break;
              const data = hit.object.userData?.mergedMeshData as
                | { groupIds: number[] }
                | undefined;
              if (!data || hit.faceIndex == null || hit.faceIndex < 0) continue;
              if (hit.faceIndex >= data.groupIds.length) continue;
              const groupId = data.groupIds[hit.faceIndex];
              if (!hiddenGroupIds.has(groupId)) hitGroupIds.add(groupId);
            }
          }
        }

        return hitGroupIds;
      },

      raycastPanelUV(clientX, clientY) {
        const ctx = panelRaycastRef.current;
        const canvas = gl.domElement;
        const canvasRect = canvas.getBoundingClientRect();
        if (canvasRect.width === 0 || canvasRect.height === 0) return null;

        const ndcX = ((clientX - canvasRect.left) / canvasRect.width) * 2 - 1;
        const ndcY = -((clientY - canvasRect.top) / canvasRect.height) * 2 + 1;

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
        const hits = raycaster.intersectObjects(scene.children, true);
        const picked = pickGroupFromRaycast(raycaster, hits, ctx.hiddenGroupIds);
        if (!picked) return null;

        const group = ctx.groups.find((g) => g.id === picked.groupId);
        if (!group) return null;

        const modelPoint = {
          x: picked.point.x + ctx.modelCenter.x,
          y: picked.point.y + ctx.modelCenter.y,
          z: picked.point.z + ctx.modelCenter.z,
        };
        const uv = worldPointToPanelUV(modelPoint, ctx.faces, group, ctx.appliedAxis);
        if (!uv) return null;
        return { groupId: picked.groupId, u: uv.u, v: uv.v };
      },

      raycastPanelFull(clientX, clientY) {
        const ctx = panelRaycastRef.current;
        const canvas = gl.domElement;
        const canvasRect = canvas.getBoundingClientRect();
        if (canvasRect.width === 0 || canvasRect.height === 0) return null;

        const ndcX = ((clientX - canvasRect.left) / canvasRect.width) * 2 - 1;
        const ndcY = -((clientY - canvasRect.top) / canvasRect.height) * 2 + 1;

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
        const hits = raycaster.intersectObjects(scene.children, true);
        const picked = pickGroupFromRaycast(raycaster, hits, ctx.hiddenGroupIds);
        if (!picked) return null;

        const group = ctx.groups.find((g) => g.id === picked.groupId);
        if (!group) return null;

        const modelPoint = {
          x: picked.point.x + ctx.modelCenter.x,
          y: picked.point.y + ctx.modelCenter.y,
          z: picked.point.z + ctx.modelCenter.z,
        };
        const uv = worldPointToPanelUV(modelPoint, ctx.faces, group, ctx.appliedAxis);
        if (!uv) return null;

        const projection = getGroupProjection(ctx.faces, group, ctx.appliedAxis);
        if (!projection) return null;

        return {
          groupId: picked.groupId,
          u: uv.u,
          v: uv.v,
          scenePoint: { x: picked.point.x, y: picked.point.y, z: picked.point.z },
          projection,
        };
      },

      getUVFromMouseOnPlane(clientX, clientY, sceneAnchor, projection) {
        const canvas = gl.domElement;
        const canvasRect = canvas.getBoundingClientRect();
        if (canvasRect.width === 0 || canvasRect.height === 0) return null;

        const ndcX = ((clientX - canvasRect.left) / canvasRect.width) * 2 - 1;
        const ndcY = -((clientY - canvasRect.top) / canvasRect.height) * 2 + 1;

        // Build ray from camera through pixel
        const rayOrigin = camera.position.clone();
        const rayDir = new THREE.Vector3(ndcX, ndcY, 0.5)
          .unproject(camera)
          .sub(rayOrigin)
          .normalize();

        // Ray-plane intersection: n · (P - anchor) = 0, P = origin + t*dir
        const n = new THREE.Vector3(
          projection.normal.x,
          projection.normal.y,
          projection.normal.z,
        );
        const anchor = new THREE.Vector3(sceneAnchor.x, sceneAnchor.y, sceneAnchor.z);

        const denom = n.dot(rayDir);
        if (Math.abs(denom) < 1e-6) return null; // ray parallel to plane
        const t = n.dot(anchor.clone().sub(rayOrigin)) / denom;
        if (t < 0) return null; // behind camera

        const scenePoint = rayOrigin.clone().addScaledVector(rayDir, t);

        // Scene coords → model coords (undo the centering shift)
        const ctx = panelRaycastRef.current;
        const mx = scenePoint.x + ctx.modelCenter.x;
        const my = scenePoint.y + ctx.modelCenter.y;
        const mz = scenePoint.z + ctx.modelCenter.z;

        // Project onto UV axes
        const { uAxis, vAxis, originU, originV } = projection;
        const u = mx * uAxis.x + my * uAxis.y + mz * uAxis.z - originU;
        const v = mx * vAxis.x + my * vAxis.y + mz * vAxis.z - originV;
        return { u, v };
      },

      getPanelSize(groupId) {
        const ctx = panelRaycastRef.current;
        const group = ctx.groups.find((g) => g.id === groupId);
        if (!group) return null;
        return getGroupPanelSize(ctx.faces, group, ctx.appliedAxis);
      },
    };
    return () => {
      handleRef.current = null;
    };
  }); // intentionally no deps — keeps camera/gl/scene always fresh

  return null;
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

export interface ModelViewerProps {
  faces: Face3D[];
  groups: GeometryGroup[];
  selectedGroupIds: Set<number>;
  categoryOverrides: Map<number, FaceCategory>;
  visibleCategories: Set<FaceCategory>;
  hiddenGroupIds: Set<number>;
  onSelectGroup: (id: number) => void;
  onToggleGroup: (id: number) => void;
  onContextMenu?: (detail: { clientX: number; clientY: number; groupId: number | null }) => void;
  appliedAxis?: "Y" | "Z";
  showCenterAxes?: boolean;
  leaderMarkers?: LeaderMarker[];
  isSolid?: boolean;
  boxSelectActive?: boolean;
  viewerRef?: React.MutableRefObject<ModelViewerHandle | null>;
  /** Groups whose openings (holes) are engraved in red on the cut sheet. */
  markGroupIds?: Set<number>;
  userCuts?: UserCut[];
  cutDraft?: CutDragState | null;
  movingCutId?: string | null;
  /** Face indices to highlight for a focused merge member (subset of merged group). */
  mergeMemberFaceIndices?: number[] | null;
}

export default function ModelViewer({
  faces,
  groups,
  selectedGroupIds,
  categoryOverrides,
  visibleCategories,
  hiddenGroupIds,
  onSelectGroup,
  onToggleGroup,
  onContextMenu,
  appliedAxis = "Y",
  showCenterAxes = true,
  leaderMarkers = [],
  isSolid = false,
  boxSelectActive = false,
  viewerRef,
  markGroupIds = EMPTY_MARK_SET,
  userCuts = [],
  cutDraft = null,
  movingCutId = null,
  mergeMemberFaceIndices = null,
}: ModelViewerProps) {
  const palette = useViewerPalette();
  const materials = useMemo(() => createViewerMaterials(palette), [palette]);
  useEffect(() => () => disposeViewerMaterials(materials), [materials]);

  const panelRaycastRef = useRef<PanelRaycastContext>({
    faces: [],
    groups: [],
    hiddenGroupIds: new Set(),
    appliedAxis: "Y",
    modelCenter: { x: 0, y: 0, z: 0 },
  });

  const { camDist, modelCenter } = useMemo(() => {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const face of faces) {
      for (const v of face.vertices) {
        if (v.x < minX) minX = v.x;
        if (v.y < minY) minY = v.y;
        if (v.z < minZ) minZ = v.z;
        if (v.x > maxX) maxX = v.x;
        if (v.y > maxY) maxY = v.y;
        if (v.z > maxZ) maxZ = v.z;
      }
    }
    const diag = Math.sqrt(
      (maxX - minX) ** 2 + (maxY - minY) ** 2 + (maxZ - minZ) ** 2,
    );
    return {
      camDist: Math.max(diag, 1),
      modelCenter: {
        x: (minX + maxX) / 2,
        y: (minY + maxY) / 2,
        z: (minZ + maxZ) / 2,
      },
    };
  }, [faces]);

  return (
    <Canvas
      camera={{
        position: [camDist * 0.9, camDist * 0.6, camDist * 0.9],
        fov: 50,
        near: 0.01,
        far: camDist * 10,
      }}
      style={{ background: palette.background }}
      onPointerMissed={() => onSelectGroup(-1)}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu?.({
          clientX: e.clientX,
          clientY: e.clientY,
          groupId: null,
        });
      }}
      dpr={[1, 1.5]}
    >
      <ambientLight intensity={palette.ambientLight} />
      <directionalLight position={[100, 200, 100]} intensity={palette.keyLight} />
      <directionalLight position={[-100, 50, -100]} intensity={palette.fillLight} />

      <Scene
        faces={faces}
        groups={groups}
        selectedGroupIds={selectedGroupIds}
        categoryOverrides={categoryOverrides}
        visibleCategories={visibleCategories}
        hiddenGroupIds={hiddenGroupIds}
        onSelectGroup={onSelectGroup}
        onToggleGroup={onToggleGroup}
        onContextMenu={onContextMenu}
        appliedAxis={appliedAxis}
        showCenterAxes={showCenterAxes}
        leaderMarkers={leaderMarkers}
        isSolid={isSolid}
        boxSelectActive={boxSelectActive}
        markGroupIds={markGroupIds}
        userCuts={userCuts}
        cutDraft={cutDraft}
        movingCutId={movingCutId}
        panelRaycastRef={panelRaycastRef}
        palette={palette}
        materials={materials}
        mergeMemberFaceIndices={mergeMemberFaceIndices}
      />

      {viewerRef && (
        <SceneBridge
          handleRef={viewerRef}
          modelCenter={modelCenter}
          panelRaycastRef={panelRaycastRef}
        />
      )}

      {/* Gizmo en la esquina para referencia de orientación constante */}
      <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
        <GizmoViewport
          axisColors={
            appliedAxis === "Z"
              ? ["#ef4444", "#3b82f6", "#22c55e"]
              : ["#ef4444", "#22c55e", "#3b82f6"]
          }
          labels={appliedAxis === "Z" ? ["X", "Z", "Y"] : ["X", "Y", "Z"]}
          labelColor={palette.gizmoLabel}
        />
      </GizmoHelper>
    </Canvas>
  );
}
