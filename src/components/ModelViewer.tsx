"use client";

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { Face3D, Vec3 } from "@/core/types";
import type { FaceCategory, GeometryGroup } from "@/core/group-classifier";

// ---------------------------------------------------------------------------
// Shared materials (created once at module load, reused across all renders)
// ---------------------------------------------------------------------------

const CATEGORY_HEX: Record<FaceCategory, number> = {
  floor: 0x22c55e,
  wall: 0xa855f7,
  wall_exterior: 0x3b82f6,
  wall_interior: 0x06b6d4,
  discard: 0x71717a,
};

function makeMaterial(hex: number, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: hex,
    side: THREE.DoubleSide,
    transparent: true,
    opacity,
    depthWrite: opacity > 0.9,
  });
}

const NORMAL_MATERIALS: Record<FaceCategory, THREE.MeshBasicMaterial> = {
  floor: makeMaterial(CATEGORY_HEX.floor, 0.85),
  wall: makeMaterial(CATEGORY_HEX.wall, 0.85),
  wall_exterior: makeMaterial(CATEGORY_HEX.wall_exterior, 0.85),
  wall_interior: makeMaterial(CATEGORY_HEX.wall_interior, 0.85),
  discard: makeMaterial(CATEGORY_HEX.discard, 0.6),
};

const DIMMED_MATERIALS: Record<FaceCategory, THREE.MeshBasicMaterial> = {
  floor: makeMaterial(CATEGORY_HEX.floor, 0.08),
  wall: makeMaterial(CATEGORY_HEX.wall, 0.08),
  wall_exterior: makeMaterial(CATEGORY_HEX.wall_exterior, 0.08),
  wall_interior: makeMaterial(CATEGORY_HEX.wall_interior, 0.08),
  discard: makeMaterial(CATEGORY_HEX.discard, 0.05),
};

const HIGHLIGHT_MATERIAL = new THREE.MeshBasicMaterial({
  color: 0xffffff,
  side: THREE.DoubleSide,
  transparent: true,
  opacity: 0.55,
});

const HIGHLIGHT_WIREFRAME = new THREE.LineBasicMaterial({
  color: 0xffffff,
});

const EDGE_LINE_MATERIAL = new THREE.LineBasicMaterial({
  color: 0x000000,
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

function buildMergedGeometries(
  faces: Face3D[],
  groups: GeometryGroup[],
  overrides: Map<number, FaceCategory>,
): MergedMeshData[] {
  const byCategory = new Map<
    FaceCategory,
    { positions: number[]; groupIds: number[] }
  >();
  for (const cat of ["floor", "wall", "wall_exterior", "wall_interior", "discard"] as FaceCategory[]) {
    byCategory.set(cat, { positions: [], groupIds: [] });
  }

  for (const group of groups) {
    const cat = overrides.get(group.id) ?? group.category;
    const bucket = byCategory.get(cat)!;

    for (const fi of group.faceIndices) {
      const face = faces[fi];
      if (!face || face.vertices.length < 3) continue;
      const v0 = face.vertices[0];
      for (let i = 1; i < face.vertices.length - 1; i++) {
        const v1 = face.vertices[i];
        const v2 = face.vertices[i + 1];
        bucket.positions.push(
          v0.x, v0.y, v0.z,
          v1.x, v1.y, v1.z,
          v2.x, v2.y, v2.z,
        );
        bucket.groupIds.push(group.id);
      }
    }
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
    const v0 = face.vertices[0];
    for (let i = 1; i < face.vertices.length - 1; i++) {
      const v1 = face.vertices[i];
      const v2 = face.vertices[i + 1];
      positions.push(v0.x, v0.y, v0.z, v1.x, v1.y, v1.z, v2.x, v2.y, v2.z);
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
  onPick: (groupId: number) => void;
}

function CategoryMesh({ mesh, isDimmed, onPick }: CategoryMeshProps) {
  const material = isDimmed
    ? DIMMED_MATERIALS[mesh.category]
    : NORMAL_MATERIALS[mesh.category];

  return (
    <>
      <mesh
        geometry={mesh.geometry}
        material={material}
        onPointerDown={(e) => {
          e.stopPropagation();
          const triIdx = e.faceIndex;
          if (typeof triIdx === "number" && triIdx >= 0 && triIdx < mesh.groupIds.length) {
            onPick(mesh.groupIds[triIdx]);
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
  selectedGroupId: number | null;
  categoryOverrides: Map<number, FaceCategory>;
  visibleCategories: Set<FaceCategory>;
  onSelectGroup: (id: number) => void;
}

function Scene({
  faces,
  groups,
  selectedGroupId,
  categoryOverrides,
  visibleCategories,
  onSelectGroup,
}: SceneProps) {
  const selectedGroup = groups.find((g) => g.id === selectedGroupId);

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
    () => buildMergedGeometries(faces, groups, categoryOverrides),
    [faces, groups, categoryOverrides],
  );

  // Cleanup old geometries when mergedMeshes changes.
  useEffect(() => {
    return () => {
      for (const m of mergedMeshes) {
        m.geometry.dispose();
        m.edgeGeometry?.dispose();
      }
    };
  }, [mergedMeshes]);

  // Highlight geometry for the selected group.
  const selectedGeometry = useMemo(() => {
    if (!selectedGroup) return null;
    return buildSelectedGeometry(faces, selectedGroup.faceIndices);
  }, [faces, selectedGroup]);

  useEffect(() => {
    return () => {
      if (selectedGeometry) selectedGeometry.dispose();
    };
  }, [selectedGeometry]);

  // Centred target: selected group, or model centre.
  const focusTarget: Vec3 = selectedGroup
    ? {
        x: selectedGroup.centroid.x - bounds.center.x,
        y: selectedGroup.centroid.y - bounds.center.y,
        z: selectedGroup.centroid.z - bounds.center.z,
      }
    : { x: 0, y: 0, z: 0 };

  const maxDist = bounds.diag * 3;
  const minDist = bounds.diag * 0.05;

  return (
    <>
      <CameraControls
        target={focusTarget}
        maxDistance={maxDist}
        minDistance={minDist}
      />
      <group position={[-bounds.center.x, -bounds.center.y, -bounds.center.z]}>
        {mergedMeshes.map((mm) => {
          if (!visibleCategories.has(mm.category)) return null;
          const isDimmed = selectedGroupId !== null;
          return (
            <CategoryMesh
              key={mm.category}
              mesh={mm}
              isDimmed={isDimmed}
              onPick={onSelectGroup}
            />
          );
        })}

        {selectedGeometry && selectedGroup && (
          <>
            <mesh geometry={selectedGeometry} material={HIGHLIGHT_MATERIAL} />
            <lineSegments>
              <wireframeGeometry args={[selectedGeometry]} />
              <primitive object={HIGHLIGHT_WIREFRAME} attach="material" />
            </lineSegments>
          </>
        )}
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
  selectedGroupId: number | null;
  categoryOverrides: Map<number, FaceCategory>;
  visibleCategories: Set<FaceCategory>;
  onSelectGroup: (id: number) => void;
}

export default function ModelViewer({
  faces,
  groups,
  selectedGroupId,
  categoryOverrides,
  visibleCategories,
  onSelectGroup,
}: ModelViewerProps) {
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
      style={{ background: "#09090b" }}
      onPointerMissed={() => onSelectGroup(-1)}
      dpr={[1, 1.5]}
    >
      <Scene
        faces={faces}
        groups={groups}
        selectedGroupId={selectedGroupId}
        categoryOverrides={categoryOverrides}
        visibleCategories={visibleCategories}
        onSelectGroup={onSelectGroup}
      />
    </Canvas>
  );
}
