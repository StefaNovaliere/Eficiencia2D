"use client";

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { Face3D, Vec3 } from "@/core/types";
import type { FaceCategory, GeometryGroup } from "@/core/group-classifier";

// ---------------------------------------------------------------------------
// Color scheme by category
// ---------------------------------------------------------------------------

const CATEGORY_COLORS: Record<FaceCategory, THREE.Color> = {
  floor: new THREE.Color(0x22c55e),
  wall_exterior: new THREE.Color(0x3b82f6),
  wall_interior: new THREE.Color(0x06b6d4),
  discard: new THREE.Color(0x71717a),
};

const DIM_OPACITY = 0.15;

// ---------------------------------------------------------------------------
// Build geometry for a group of faces
// ---------------------------------------------------------------------------

function buildGroupGeometry(
  faces: Face3D[],
  faceIndices: number[],
): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];

  for (const idx of faceIndices) {
    const face = faces[idx];
    if (!face || face.vertices.length < 3) continue;

    const v0 = face.vertices[0];
    const n = face.normal;

    for (let i = 1; i < face.vertices.length - 1; i++) {
      const v1 = face.vertices[i];
      const v2 = face.vertices[i + 1];
      positions.push(v0.x, v0.y, v0.z);
      positions.push(v1.x, v1.y, v1.z);
      positions.push(v2.x, v2.y, v2.z);
      normals.push(n.x, n.y, n.z);
      normals.push(n.x, n.y, n.z);
      normals.push(n.x, n.y, n.z);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  return geo;
}

// ---------------------------------------------------------------------------
// Group mesh component
// ---------------------------------------------------------------------------

interface GroupMeshProps {
  faces: Face3D[];
  group: GeometryGroup;
  effectiveCategory: FaceCategory;
  isSelected: boolean;
  isDimmed: boolean;
  onSelect: (id: number) => void;
}

function GroupMesh({
  faces,
  group,
  effectiveCategory,
  isSelected,
  isDimmed,
  onSelect,
}: GroupMeshProps) {
  const geometry = useMemo(
    () => buildGroupGeometry(faces, group.faceIndices),
    [faces, group.faceIndices],
  );

  const color = CATEGORY_COLORS[effectiveCategory];

  const material = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: isDimmed ? DIM_OPACITY : 0.85,
      emissive: isSelected ? color : new THREE.Color(0x000000),
      emissiveIntensity: isSelected ? 0.4 : 0,
    });
  }, [color, isSelected, isDimmed]);

  useEffect(() => {
    material.opacity = isDimmed ? DIM_OPACITY : 0.85;
    material.emissive = isSelected ? color : new THREE.Color(0x000000);
    material.emissiveIntensity = isSelected ? 0.4 : 0;
    material.needsUpdate = true;
  }, [material, color, isSelected, isDimmed]);

  return (
    <>
      <mesh
        geometry={geometry}
        material={material}
        userData={{ groupId: group.id }}
        onPointerDown={(e) => {
          e.stopPropagation();
          onSelect(group.id);
        }}
      />
      {isSelected && (
        <mesh geometry={geometry}>
          <meshBasicMaterial
            color={0xffffff}
            wireframe
            transparent
            opacity={0.3}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Camera controller — smoothly focus on selected group
// ---------------------------------------------------------------------------

interface CameraFocusProps {
  target: Vec3 | null;
}

function CameraFocus({ target }: CameraFocusProps) {
  const { camera } = useThree();
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

  return <OrbitControls ref={controlsRef} makeDefault />;
}

// ---------------------------------------------------------------------------
// Scene contents
// ---------------------------------------------------------------------------

interface SceneProps {
  faces: Face3D[];
  groups: GeometryGroup[];
  selectedGroupId: number | null;
  categoryOverrides: Map<number, FaceCategory>;
  onSelectGroup: (id: number) => void;
}

function Scene({
  faces,
  groups,
  selectedGroupId,
  categoryOverrides,
  onSelectGroup,
}: SceneProps) {
  const selectedGroup = groups.find((g) => g.id === selectedGroupId);
  const focusTarget = selectedGroup?.centroid ?? null;

  // Compute bounding box for initial camera position.
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

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 10, 7]} intensity={0.8} />
      <directionalLight position={[-5, -3, -7]} intensity={0.3} />
      <CameraFocus target={focusTarget} />
      <group
        position={[-bounds.center.x, -bounds.center.y, -bounds.center.z]}
      >
        {groups.map((group) => {
          const effectiveCat = categoryOverrides.get(group.id) ?? group.category;
          return (
            <GroupMesh
              key={group.id}
              faces={faces}
              group={group}
              effectiveCategory={effectiveCat}
              isSelected={group.id === selectedGroupId}
              isDimmed={selectedGroupId !== null && group.id !== selectedGroupId}
              onSelect={onSelectGroup}
            />
          );
        })}
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
  onSelectGroup: (id: number) => void;
}

export default function ModelViewer({
  faces,
  groups,
  selectedGroupId,
  categoryOverrides,
  onSelectGroup,
}: ModelViewerProps) {
  const bounds = useMemo(() => {
    let maxDist = 1;
    for (const face of faces) {
      for (const v of face.vertices) {
        const d = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
        if (d > maxDist) maxDist = d;
      }
    }
    return maxDist;
  }, [faces]);

  return (
    <Canvas
      camera={{
        position: [bounds * 1.5, bounds * 1.0, bounds * 1.5],
        fov: 50,
        near: 0.01,
        far: bounds * 10,
      }}
      style={{ background: "#09090b" }}
      onPointerMissed={() => onSelectGroup(-1)}
    >
      <Scene
        faces={faces}
        groups={groups}
        selectedGroupId={selectedGroupId}
        categoryOverrides={categoryOverrides}
        onSelectGroup={onSelectGroup}
      />
    </Canvas>
  );
}
