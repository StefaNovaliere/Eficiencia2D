"use client";

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { OrbitControls, GizmoHelper, GizmoViewport, Line, Html } from "@react-three/drei";
import * as THREE from "three";
import type { Face3D, Vec3 } from "@/core/types";
import type { FaceCategory, GeometryGroup } from "@/core/group-classifier";
import { getViewerBackground, useTheme } from "@/context/ThemeContext";

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

const CATEGORY_HEX: Record<FaceCategory, number> = {
  floor: 0x7F8C8D,
  wall:0xE0DCD1,
  discard: 0x2C3E50,
};

function makeMaterial(hex: number, opacity: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: hex,
    side: THREE.DoubleSide,
    transparent: opacity < 1.0,
    opacity,
    depthWrite: opacity > 0.9,
    roughness: 0.8,
    metalness: 0.1,
  });
}

const NORMAL_MATERIALS: Record<FaceCategory, THREE.MeshStandardMaterial> = {
  floor: makeMaterial(CATEGORY_HEX.floor, 0.85),
  wall: makeMaterial(CATEGORY_HEX.wall, 0.85),
  discard: makeMaterial(CATEGORY_HEX.discard, 0.6),
};

const SOLID_MATERIALS: Record<FaceCategory, THREE.MeshStandardMaterial> = {
  floor: makeMaterial(CATEGORY_HEX.floor, 1.0),
  wall: makeMaterial(CATEGORY_HEX.wall, 1.0),
  discard: makeMaterial(CATEGORY_HEX.discard, 1.0),
};

const DIMMED_MATERIALS: Record<FaceCategory, THREE.MeshStandardMaterial> = {
  floor: makeMaterial(CATEGORY_HEX.floor, 0.08),
  wall: makeMaterial(CATEGORY_HEX.wall, 0.08),
  discard: makeMaterial(CATEGORY_HEX.discard, 0.05),
};

const HIGHLIGHT_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0xf59e0b,
  side: THREE.DoubleSide,
  transparent: true,
  opacity: 0.45,
  roughness: 0.5,
  metalness: 0.2,
});

const HIGHLIGHT_WIREFRAME = new THREE.LineBasicMaterial({
  color: 0xf59e0b,
});

const EDGE_LINE_MATERIAL = new THREE.LineBasicMaterial({
  color: 0x18181b,
  transparent: true,
  opacity: 0.35,
  depthTest: true,
});

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
  onPick: (groupId: number) => void;
  onTogglePick: (groupId: number) => void;
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

function CategoryMesh({ mesh, isDimmed, isSolid, groupAreaById, onPick, onTogglePick }: CategoryMeshProps) {
  const material = isDimmed
    ? DIMMED_MATERIALS[mesh.category]
    : isSolid
    ? SOLID_MATERIALS[mesh.category]
    : NORMAL_MATERIALS[mesh.category];

  return (
    <>
      <mesh
        geometry={mesh.geometry}
        material={material}
        userData={{ mergedMeshData: mesh }}
        onPointerDown={(e) => {
          e.stopPropagation();
          const groupId = pickGroupFromIntersections(e.intersections, groupAreaById);
          if (groupId == null) return;
          if (e.nativeEvent.ctrlKey || e.nativeEvent.metaKey) {
            onTogglePick(groupId);
          } else {
            onPick(groupId);
          }
        }}

      />
      {mesh.edgeGeometry && !isDimmed && (
        <lineSegments geometry={mesh.edgeGeometry} material={EDGE_LINE_MATERIAL} />
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
}

function CameraControls({ target, maxDistance, minDistance }: CameraControlsProps) {
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
  appliedAxis?: "Y" | "Z";
  showCenterAxes?: boolean;
  leaderMarkers?: LeaderMarker[];
  isSolid?: boolean;
}

function Scene({
  faces,
  groups,
  selectedGroupIds,
  categoryOverrides,
  visibleCategories,
  hiddenGroupIds,
  onSelectGroup,
  onToggleGroup,
  appliedAxis = "Y",
  showCenterAxes = true,
  leaderMarkers = [],
  isSolid = false,
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

  // Highlight geometry for all selected groups combined.
  const selectedGeometry = useMemo(() => {
    if (selectedGroups.length === 0) return null;
    const allFaceIndices: number[] = [];
    for (const g of selectedGroups) {
      allFaceIndices.push(...g.faceIndices);
    }
    return buildSelectedGeometry(faces, allFaceIndices);
  }, [faces, selectedGroups]);

  useEffect(() => {
    return () => {
      if (selectedGeometry) selectedGeometry.dispose();
    };
  }, [selectedGeometry]);

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

  return (
    <>
      <CameraControls
        target={focusTarget}
        maxDistance={maxDist}
        minDistance={minDist}
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
              onPick={onSelectGroup}
              onTogglePick={onToggleGroup}
            />
          );
        })}

        {selectedGeometry && selectedGroups.length > 0 && (
          <>
            <mesh geometry={selectedGeometry} material={HIGHLIGHT_MATERIAL} />
            <lineSegments>
              <wireframeGeometry args={[selectedGeometry]} />
              <primitive object={HIGHLIGHT_WIREFRAME} attach="material" />
            </lineSegments>
          </>
        )}

        {/* Leader lines + floating reference tags for the selected joint */}
        {leaders.map((m) => (
          <group key={m.groupId}>
            <Line
              points={[m.start, m.end]}
              color={m.primary ? "#f59e0b" : "#3b82f6"}
              lineWidth={2}
              depthTest={false}
              transparent
              renderOrder={999}
            />
            <mesh position={m.start} renderOrder={999}>
              <sphereGeometry args={[bounds.diag * 0.006, 12, 12]} />
              <meshBasicMaterial
                color={m.primary ? "#f59e0b" : "#3b82f6"}
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
                className={`badge badge-sm font-mono font-bold shadow-md border ${
                  m.primary
                    ? "bg-amber-500 text-white border-amber-600"
                    : "bg-base-100 text-base-content border-base-300"
                }`}
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
  appliedAxis?: "Y" | "Z";
  showCenterAxes?: boolean;
  leaderMarkers?: LeaderMarker[];
  isSolid?: boolean;
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
  appliedAxis = "Y",
  showCenterAxes = true,
  leaderMarkers = [],
  isSolid = false,
}: ModelViewerProps) {
  const { theme } = useTheme();
  const viewerBg = getViewerBackground(theme);

  const camDist = useMemo(() => {
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
    return Math.max(diag, 1);
  }, [faces]);

  return (
    <Canvas
      camera={{
        position: [camDist * 0.9, camDist * 0.6, camDist * 0.9],
        fov: 50,
        near: 0.01,
        far: camDist * 10,
      }}
      style={{ background: viewerBg }}
      onPointerMissed={() => onSelectGroup(-1)}
      dpr={[1, 1.5]}
    >
      {/* Añadimos luces para que los materiales Standard tengan sombreado y volumen */}
      <ambientLight intensity={0.7} />
      <directionalLight position={[100, 200, 100]} intensity={0.6} />
      <directionalLight position={[-100, 50, -100]} intensity={0.3} />

      <Scene
        faces={faces}
        groups={groups}
        selectedGroupIds={selectedGroupIds}
        categoryOverrides={categoryOverrides}
        visibleCategories={visibleCategories}
        hiddenGroupIds={hiddenGroupIds}
        onSelectGroup={onSelectGroup}
        onToggleGroup={onToggleGroup}
        appliedAxis={appliedAxis}
        showCenterAxes={showCenterAxes}
        leaderMarkers={leaderMarkers}
        isSolid={isSolid}
      />

      {/* Gizmo en la esquina para referencia de orientación constante */}
      <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
        <GizmoViewport
          axisColors={
            appliedAxis === "Z"
              ? ["#ef4444", "#3b82f6", "#22c55e"] // X=Red, Y(Up)=Blue(Z), Z(Depth)=Green(Y)
              : ["#ef4444", "#22c55e", "#3b82f6"] // X=Red, Y=Green, Z=Blue
          }
          labels={appliedAxis === "Z" ? ["X", "Z", "Y"] : ["X", "Y", "Z"]}
          labelColor="white"
        />
      </GizmoHelper>
    </Canvas>
  );
}
