"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { OrbitControls, GizmoHelper, GizmoViewcube, Line, Html, PointerLockControls } from "@react-three/drei";
import type React from "react";
import * as THREE from "three";
import type { Face3D, Vec3 } from "@/core/types";
import type { FaceCategory, GeometryGroup } from "@/core/group-classifier";
import { computeMarkedOpeningGroups3D, type MarkOpeningGroupLines } from "@/core/mark-preview";
import { computeFlexPreview3D } from "@/core/flex-preview";
import type { FlexSpec } from "@/core/flex-bending";
import {
  computeCutPreviewSegments,
  panelUVToWorldOnSurface,
  type CutPreviewSegment,
} from "@/core/cut-preview";
import { computeMeasurePreviewSegments, computeMeasureLabelPlacements } from "@/core/measure-preview";
import { frameDistance } from "@/core/camera-frame";
import { advanceCycle, uniqueOrdered, type ClickCycleState } from "@/core/pick-cycle";
import { sectionPlaneParams, type SectionAxis } from "@/core/section-plane";
import type { MeasureDragState, UserMeasure, MeasureLabelOptions } from "@/core/measure-tool";
import { DEFAULT_MEASURE_LABEL_OPTIONS } from "@/core/measure-tool";
import {
  worldPointToPanelUV,
  getGroupPanelSize,
  getGroupProjection,
  panelUVToWorldPoint,
  type PanelProjection,
} from "@/core/cut-preview";
import type { UserCut } from "@/core/user-cuts";
import type { CutDragState } from "@/core/user-cuts";
import {
  cutGroupOwnerId,
  cutDerivedExtractIndex,
  cutDerivedParentId,
  type DerivedPanelPoly,
  type DerivedTriangleRef,
} from "@/core/cut-derived-groups";
import { useViewerPalette, type ViewerPalette } from "@/context/ThemeContext";
import { useCameraNavigation } from "@/context/CameraNavigationContext";

// A floating reference label (panel id) anchored to a component in 3D, drawn
// when the user selects a wall-wall joint in the review list.
export interface LeaderMarker {
  groupId: number;
  anchor: Vec3;     // component centroid, in pre-offset model space
  label: string;    // panel id, e.g. "A2"
  primary: boolean; // the selected wall (true) vs the joined "other" wall
}

// A floating panel-id badge shown in the 3D viewer when the assembly guide
// tab is active. centroid is in pre-offset model space (same convention as
// LeaderMarker.anchor).
export interface AssemblyPanelLabel {
  groupId: number;
  panelId: string;
  centroid: Vec3;
  /** Outward-facing normal — used to hide labels on walls turned away from camera. */
  normal: Vec3;
  isSelected: boolean;
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
  /** Rayos X: translúcido, sin escribir profundidad → se ven las piezas internas. */
  xray: Record<FaceCategory, THREE.MeshStandardMaterial>;
  highlight: THREE.MeshStandardMaterial;
  highlightWire: THREE.LineBasicMaterial;
  /** Resaltado al pasar el cursor (hover). */
  hover: THREE.MeshStandardMaterial;
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
  const xray = {} as Record<FaceCategory, THREE.MeshStandardMaterial>;

  for (const cat of cats) {
    const hex = colorByCat[cat];
    normal[cat] = makeMaterial(hex, cat === "discard" ? 0.82 : 1.0);
    solid[cat] = makeMaterial(hex, 1.0);
    dimmed[cat] = makeMaterial(hex, cat === "discard" ? 0.08 : 0.14);
    // Rayos X: translúcido y sin depthWrite → se ven las piezas de atrás.
    xray[cat] = makeMaterial(hex, cat === "discard" ? 0.06 : 0.16);
    xray[cat].depthWrite = false;
  }

  // El piso tiene caras coplanares con la base de los muros → z-fighting.
  // polygonOffset positivo empuja el piso levemente "detrás" del muro para
  // que el muro siempre gane cuando compiten en la misma posición.
  for (const m of [normal.floor, solid.floor, dimmed.floor, xray.floor]) {
    m.polygonOffset = true;
    m.polygonOffsetFactor = 2;
    m.polygonOffsetUnits = 4;
  }

  return {
    normal,
    solid,
    dimmed,
    xray,
    highlight: new THREE.MeshStandardMaterial({
      color: hexToNumber(palette.highlight),
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.48,
      roughness: 0.45,
      metalness: 0.15,
    }),
    highlightWire: new THREE.LineBasicMaterial({ color: hexToNumber(palette.highlight) }),
    hover: new THREE.MeshStandardMaterial({
      color: 0x22d3ee,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.4,
      depthTest: false,
      depthWrite: false,
      roughness: 0.4,
      metalness: 0.1,
    }),
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
    ...Object.values(materials.xray),
    materials.highlight,
    materials.highlightWire,
    materials.hover,
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

function pushTriangleToBucket(
  bucket: { positions: number[]; groupIds: number[] },
  groupId: number,
  a: Vec3,
  b: Vec3,
  c: Vec3,
): void {
  bucket.positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  bucket.groupIds.push(groupId);
}

function closedRingToContour(ring: [number, number][]): THREE.Vector2[] {
  const n =
    ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]
      ? ring.length - 1
      : ring.length;
  const out: THREE.Vector2[] = [];
  for (let i = 0; i < n; i++) out.push(new THREE.Vector2(ring[i][0], ring[i][1]));
  return out;
}

/** Triangulate a panel-local polygon (outer + holes) into UV triangles.
 *
 * THREE.ShapeUtils.triangulateShape requires:
 *   outer contour → CCW (positive signed area in standard math / Y-up)
 *   holes         → CW  (negative signed area)
 *
 * The rings from edgesToPolygons can arrive in either winding, so we correct
 * them here. We also wrap in try/catch because the Earcut library inside THREE
 * will throw on degenerate or self-intersecting input.
 */
function triangulatePanelPoly(poly: DerivedPanelPoly): THREE.Vector2[][] {
  const outer = closedRingToContour(poly.outer);
  if (outer.length < 3) return [];

  // Positive area = CCW in Y-up (standard math). THREE wants CCW for outer.
  if (THREE.ShapeUtils.area(outer) < 0) outer.reverse();

  const holes = poly.holes
    .map((hole) => closedRingToContour(hole))
    .filter((h) => h.length >= 3)
    .map((h) => {
      // THREE wants CW (negative area) for holes.
      if (THREE.ShapeUtils.area(h) > 0) h.reverse();
      return h;
    });

  try {
    const indices = THREE.ShapeUtils.triangulateShape(outer, holes);
    if (indices.length === 0) return [];
    const allVerts = [...outer, ...holes.flat()];
    const tris: THREE.Vector2[][] = [];
    for (const t of indices) {
      tris.push([allVerts[t[0]], allVerts[t[1]], allVerts[t[2]]]);
    }
    return tris;
  } catch {
    return [];
  }
}

function surfaceCutForDerivedGroup(
  derivedGroupId: number,
  parentId: number | null,
  userCuts: UserCut[],
): UserCut | undefined {
  if (parentId == null) return undefined;
  const extractIdx = cutDerivedExtractIndex(derivedGroupId);
  if (extractIdx != null) {
    const subtractive = userCuts.filter(
      (c) => c.groupId === parentId && c.kind !== "line",
    );
    return subtractive[extractIdx];
  }
  return userCuts.find((c) => c.groupId === parentId);
}

function pushPanelPolyToBucket(
  bucket: { positions: number[]; groupIds: number[] },
  groupId: number,
  poly: DerivedPanelPoly,
  faces: Face3D[],
  parentGroup: GeometryGroup,
  appliedAxis: "Y" | "Z",
  parentCut?: UserCut,
): void {
  const tris = triangulatePanelPoly(poly);
  for (const [a, b, c] of tris) {
    const wa = panelUVToWorldOnSurface(
      a.x, a.y, faces, parentGroup, appliedAxis,
      parentCut?.surfaceNormal, parentCut?.surfaceOffset,
    );
    const wb = panelUVToWorldOnSurface(
      b.x, b.y, faces, parentGroup, appliedAxis,
      parentCut?.surfaceNormal, parentCut?.surfaceOffset,
    );
    const wc = panelUVToWorldOnSurface(
      c.x, c.y, faces, parentGroup, appliedAxis,
      parentCut?.surfaceNormal, parentCut?.surfaceOffset,
    );
    if (!wa || !wb || !wc) continue;
    pushTriangleToBucket(bucket, groupId, wa, wb, wc);
  }
}

function buildMergedGeometries(
  faces: Face3D[],
  groups: GeometryGroup[],
  overrides: Map<number, FaceCategory>,
  hiddenGroupIds: Set<number>,
  derivedCutTriangles?: Map<number, DerivedTriangleRef[]>,
  derivedPanelPolys?: Map<number, DerivedPanelPoly>,
  projectionGroups?: GeometryGroup[],
  appliedAxis: "Y" | "Z" = "Y",
  userCuts: UserCut[] = [],
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

    const panelPoly = derivedPanelPolys?.get(group.id);
    const triSubset = derivedCutTriangles?.get(group.id);
    const isExtractPiece = cutDerivedExtractIndex(group.id) != null;
    const isDerivedPiece = panelPoly != null || (triSubset != null);

    // All derived cut pieces (both "resto/split" and "extract") render via the
    // panel poly (2D triangulation with holes). This is the only approach that
    // can produce a clean visual hole in the wall surface. The triangle-subset
    // fallback is kept only as a last resort so the wall never disappears.
    //
    // Extract pieces pass their cut's surfaceNormal/Offset so they sit slightly
    // in front of the wall. Resto/split pieces pass no offset — they ARE the wall.
    if (isDerivedPiece && panelPoly) {
      const parentId = cutDerivedParentId(group.id);
      const parentGroup =
        parentId != null
          ? projectionGroups?.find((g) => g.id === parentId)
          : undefined;
      if (parentGroup) {
        // Only extract pieces need a surface offset; resto pieces sit on the wall itself.
        const surfaceCut = isExtractPiece
          ? (surfaceCutForDerivedGroup(group.id, parentId, userCuts) ??
             userCuts.find((c) => c.groupId === parentId))
          : undefined;
        pushPanelPolyToBucket(
          bucket,
          group.id,
          panelPoly,
          faces,
          parentGroup,
          appliedAxis,
          surfaceCut,
        );
        continue;
      }
    }

    // Fallback: render the triangle subset. This does NOT create clean holes but
    // prevents the wall from going completely invisible when panel-poly fails.
    if (triSubset && triSubset.length > 0) {
      for (const { faceIndex, i0, i1, i2 } of triSubset) {
        const face = faces[faceIndex];
        if (!face) continue;
        pushTriangleToBucket(
          bucket,
          group.id,
          face.vertices[i0],
          face.vertices[i1],
          face.vertices[i2],
        );
      }
      const parentId = cutDerivedParentId(group.id);
      const thicknessSource =
        parentId != null
          ? projectionGroups?.find((g) => g.id === parentId) ?? group
          : group;
      pushThicknessSides(faces, thicknessSource, (p0, p1, p2) => {
        bucket.positions.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
        bucket.groupIds.push(group.id);
      });
      continue;
    }

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

function buildSelectedGeometryFromTriangles(
  faces: Face3D[],
  tris: DerivedTriangleRef[],
): THREE.BufferGeometry {
  const positions: number[] = [];
  for (const { faceIndex, i0, i1, i2 } of tris) {
    const face = faces[faceIndex];
    if (!face) continue;
    const a = face.vertices[i0];
    const b = face.vertices[i1];
    const c = face.vertices[i2];
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geo;
}

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
  xray?: boolean;
  groupAreaById: Map<number, number>;
  materials: ViewerMaterials;
  onPick: (groupId: number) => void;
  onTogglePick: (groupId: number) => void;
  onContextMenu?: (detail: { clientX: number; clientY: number; groupId: number | null }) => void;
  onHover?: (groupId: number | null, clientX: number, clientY: number) => void;
  cycleRef?: React.MutableRefObject<ClickCycleState | null>;
}

/** Candidatos (groupId) bajo el cursor, ordenados por distancia (frontal→fondo), únicos. */
function candidateGroupIdsFromIntersections(intersections: THREE.Intersection[]): number[] {
  const ids: number[] = [];
  for (const hit of intersections) {
    const data = hit.object.userData.mergedMeshData as MergedMeshData | undefined;
    if (!data || hit.faceIndex == null || hit.faceIndex < 0) continue;
    if (hit.faceIndex >= data.groupIds.length) continue;
    ids.push(data.groupIds[hit.faceIndex]);
  }
  return uniqueOrdered(ids);
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

function CategoryMesh({ mesh, isDimmed, isSolid, xray = false, groupAreaById, materials, onPick, onTogglePick, onContextMenu, onHover, cycleRef }: CategoryMeshProps) {
  const material = xray
    ? materials.xray[mesh.category]
    : isDimmed
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
          const btn = e.nativeEvent.button;
          // Middle/right buttons are for camera controls — never pick components.
          if (btn !== 0) return;
          e.stopPropagation();
          const smart = pickGroupFromIntersections(e.intersections, groupAreaById);
          if (smart == null) return;
          if (e.nativeEvent.ctrlKey || e.nativeEvent.metaKey) {
            if (cycleRef) cycleRef.current = null;
            onTogglePick(smart);
            return;
          }
          // Click cíclico: repetir click ~en el mismo píxel rota entre las piezas
          // superpuestas (frontal→fondo). El primer click usa el pick inteligente.
          if (cycleRef) {
            const ids = candidateGroupIdsFromIntersections(e.intersections);
            const defaultIndex = Math.max(0, ids.indexOf(smart));
            const next = advanceCycle(
              cycleRef.current,
              e.nativeEvent.clientX,
              e.nativeEvent.clientY,
              ids,
              defaultIndex,
            );
            cycleRef.current = next;
            onPick(ids[next.index] ?? smart);
          } else {
            onPick(smart);
          }
        }}
        onPointerMove={(e) => {
          if (!onHover) return;
          const groupId = pickGroupFromIntersections(e.intersections, groupAreaById);
          onHover(groupId, e.nativeEvent.clientX, e.nativeEvent.clientY);
        }}
        onPointerOut={() => onHover?.(null, 0, 0)}
        onContextMenu={(e) => {
          e.stopPropagation();
          e.nativeEvent.preventDefault();
          // Right click must not select components — only open menu if already selected.
          onContextMenu?.({
            clientX: e.nativeEvent.clientX,
            clientY: e.nativeEvent.clientY,
            groupId: null,
          });
        }}
      />
      {mesh.edgeGeometry && !isDimmed && !xray && (
        <lineSegments geometry={mesh.edgeGeometry} material={materials.edge} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Camera + controls — constrained orbit
// ---------------------------------------------------------------------------

export interface CameraCommand {
  nonce: number;
  kind: "frameSelection" | "frameAll" | "reset";
}

export interface SectionState {
  enabled: boolean;
  axis: SectionAxis;
  /** Posición del corte 0..1 dentro del rango del modelo en ese eje. */
  pos: number;
}

function allMaterialsList(m: ViewerMaterials): THREE.Material[] {
  return [
    ...Object.values(m.normal),
    ...Object.values(m.solid),
    ...Object.values(m.dimmed),
    ...Object.values(m.xray),
    m.highlight,
    m.hover,
    m.edge,
    m.highlightWire,
  ];
}

/**
 * Plano de sección (corte): asigna un THREE.Plane a los materiales para ver el
 * interior sin atravesar por zoom. El recorte es sólo visual del visor.
 */
function SectionPlane({
  section,
  min,
  max,
  center,
  materials,
}: {
  section: SectionState;
  min: Vec3;
  max: Vec3;
  center: Vec3;
  materials: ViewerMaterials;
}) {
  const { gl } = useThree();
  const planeRef = useRef(new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0));

  useEffect(() => {
    gl.localClippingEnabled = true;
    return () => {
      gl.localClippingEnabled = false;
    };
  }, [gl]);

  useEffect(() => {
    const list = allMaterialsList(materials);
    const planes = section.enabled ? [planeRef.current] : [];
    for (const mm of list) {
      (mm as THREE.Material).clippingPlanes = planes;
      mm.needsUpdate = true;
    }
    return () => {
      for (const mm of list) {
        (mm as THREE.Material).clippingPlanes = [];
        mm.needsUpdate = true;
      }
    };
  }, [section.enabled, materials]);

  // Actualizar el plano en cada render (cambia eje/posición).
  const { normal, constant } = sectionPlaneParams(section.axis, section.pos, min, max, center);
  planeRef.current.normal.set(normal.x, normal.y, normal.z);
  planeRef.current.constant = constant;

  return null;
}

interface CameraControlsProps {
  target: Vec3 | null;
  maxDistance: number;
  minDistance: number;
  enabled?: boolean;
  /** Esfera envolvente de la selección (coords de escena, ya centradas). */
  selectionSphere?: { center: Vec3; radius: number } | null;
  /** Radio del modelo completo (media diagonal). */
  modelRadius?: number;
  /** Comando imperativo de encuadre (encuadrar / reset). */
  command?: CameraCommand | null;
}

const RESET_DIR = new THREE.Vector3(0.9, 0.6, 0.9).normalize();

/**
 * Modo Caminar/Volar (primera persona): PointerLockControls (mouse-look) + WASD/
 * flechas para avanzar/lados y Espacio/E · Shift/Q para subir/bajar. Se usa en
 * lugar de OrbitControls mientras está activo. `Esc` libera el puntero (nativo).
 */
function WalkControls({ speed }: { speed: number }) {
  const ref = useRef<any>(null);
  const keys = useRef<Record<string, boolean>>({});
  const { camera } = useThree();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      keys.current[e.code] = true;
    };
    const up = (e: KeyboardEvent) => {
      keys.current[e.code] = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      keys.current = {};
    };
  }, []);

  useFrame((_, delta) => {
    const c = ref.current;
    if (!c || !c.isLocked) return;
    const v = speed * Math.min(delta, 0.05);
    const k = keys.current;
    if (k["KeyW"] || k["ArrowUp"]) c.moveForward(v);
    if (k["KeyS"] || k["ArrowDown"]) c.moveForward(-v);
    if (k["KeyD"] || k["ArrowRight"]) c.moveRight(v);
    if (k["KeyA"] || k["ArrowLeft"]) c.moveRight(-v);
    if (k["Space"] || k["KeyE"]) camera.position.y += v;
    if (k["ShiftLeft"] || k["ShiftRight"] || k["KeyQ"]) camera.position.y -= v;
  });

  return <PointerLockControls ref={ref} />;
}

function CameraControls({
  target,
  maxDistance,
  minDistance,
  enabled = true,
  selectionSphere = null,
  modelRadius = 1,
  command = null,
}: CameraControlsProps) {
  const controlsRef = useRef<any>(null);
  const { camera } = useThree();
  const { navigationStyle, applyToControls } = useCameraNavigation();
  // Destination for one-shot focus animation. Set when selection changes;
  // cleared once the lerp finishes so the user can pan freely afterward.
  const destRef = useRef<THREE.Vector3 | null>(null);
  // Optional camera-position destination (frame/reset commands).
  const camDestRef = useRef<THREE.Vector3 | null>(null);
  const prevKeyRef = useRef<string>("");
  const prevNonceRef = useRef<number>(-1);

  // Only trigger a focus animation when the target actually changes (selection
  // changed). We do NOT re-trigger when target becomes null (deselect) so the
  // camera stays where the user left it.
  const targetKey = target ? `${target.x.toFixed(3)},${target.y.toFixed(3)},${target.z.toFixed(3)}` : "";
  if (target && targetKey !== prevKeyRef.current) {
    prevKeyRef.current = targetKey;
    destRef.current = new THREE.Vector3(target.x, target.y, target.z);
  }

  // Encuadrar / reset: recentra el pivote y ubica la cámara para que la esfera
  // (selección o modelo completo) entre en el fov, conservando la dirección de
  // vista (o una isométrica por defecto en reset).
  if (command && command.nonce !== prevNonceRef.current) {
    prevNonceRef.current = command.nonce;
    const ctrls = controlsRef.current;
    if (ctrls) {
      const useSel = command.kind === "frameSelection" && selectionSphere;
      const center = useSel
        ? new THREE.Vector3(selectionSphere!.center.x, selectionSphere!.center.y, selectionSphere!.center.z)
        : new THREE.Vector3(0, 0, 0);
      const radius = useSel ? selectionSphere!.radius : modelRadius;
      const fov = (camera as THREE.PerspectiveCamera).fov ?? 50;
      let dist = frameDistance(radius, fov, 1.3);
      dist = Math.min(maxDistance, Math.max(minDistance, dist));
      let dir: THREE.Vector3;
      if (command.kind === "reset") {
        dir = RESET_DIR.clone();
      } else {
        dir = camera.position.clone().sub(ctrls.target);
        if (dir.lengthSq() < 1e-9) dir = RESET_DIR.clone();
        dir.normalize();
      }
      destRef.current = center.clone();
      camDestRef.current = center.clone().add(dir.multiplyScalar(dist));
    }
  }

  // Aplica preset de navegación (Blender, CAD, Touchpad, …) al controlador.
  useEffect(() => {
    const ctrls = controlsRef.current;
    if (!ctrls) return;
    applyToControls(ctrls);
  }, [enabled, navigationStyle, applyToControls]);

  useFrame(() => {
    const ctrls = controlsRef.current;
    if (!ctrls) return;
    let moving = false;
    if (camDestRef.current) {
      if (camera.position.distanceTo(camDestRef.current) < 0.01) {
        camDestRef.current = null;
      } else {
        camera.position.lerp(camDestRef.current, 0.15);
        moving = true;
      }
    }
    if (destRef.current) {
      if (ctrls.target.distanceTo(destRef.current) < 0.008) {
        destRef.current = null;
      } else {
        ctrls.target.lerp(destRef.current, camDestRef.current ? 0.15 : 0.1);
        moving = true;
      }
    }
    if (moving) ctrls.update();
  });

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enabled={enabled}
      enableDamping
      dampingFactor={0.12}
      maxDistance={maxDistance}
      minDistance={minDistance}
      // Screen-space panning: the camera pans along its own screen plane,
      // not along the world floor. This makes panning intuitive at any angle
      // and lets the user reach corners and low sections without fighting the
      // orbit center.
      screenSpacePanning={true}
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
  // depthTest:false ensures the preview is always visible on the correct wall
  // (transparent walls don't write to depth buffer, so depthTest:true could
  // hide or misplace the preview behind walls).
  depthTest: false,
  depthWrite: false,
  transparent: true,
  opacity: 0.9,
});

const MEASURE_PREVIEW_MATERIAL = new THREE.LineBasicMaterial({
  color: 0x38bdf8,
  depthTest: true,
  depthWrite: false,
});

/** Preview esquemático (no autoritativo) del patrón de flexión kerf/auxético. */
const FLEX_PREVIEW_MATERIAL = new THREE.LineBasicMaterial({
  color: 0x22d3ee,
  depthTest: false,
  depthWrite: false,
  transparent: true,
  opacity: 0.85,
});

function buildCutPreviewGeometry(
  segments: CutPreviewSegment[],
): THREE.BufferGeometry {
  // Segments are in MODEL coords (built from face vertices). They render inside
  // the <group position={[-bounds.center]}> that centers the whole scene, so we
  // must NOT subtract the center here — the parent group already does it. Doing
  // it twice shifts the preview by the center vector (cut floats off the wall).
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
  material,
}: {
  groupId: number;
  segments: CutPreviewSegment[];
  anchor: THREE.Vector3;
  normal: THREE.Vector3;
  material: THREE.LineBasicMaterial;
}) {
  const lineRef = useRef<THREE.LineSegments>(null);
  const viewDir = useRef(new THREE.Vector3());
  const { camera } = useThree();
  const geometry = useMemo(
    () => buildCutPreviewGeometry(segments),
    [segments],
  );

  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame(() => {
    if (!lineRef.current) return;
    viewDir.current.subVectors(camera.position, anchor);
    // Hide only when perfectly edge-on (camera perpendicular to the panel).
    // depthTest:false is now used on the material, so depth culling is not
    // relied on — this check prevents edge-on rendering artefacts only.
    lineRef.current.visible = viewDir.current.length() < 1e-4 || Math.abs(viewDir.current.dot(normal)) > 0.02;
  });

  return (
    <lineSegments
      ref={lineRef}
      geometry={geometry}
      material={material}
      renderOrder={5}
    />
  );
}

function PreviewOverlays({
  segments,
  lookupGroups,
  centerOffset,
  material,
}: {
  segments: CutPreviewSegment[];
  /** Groups used to resolve anchors (parent panels for cuts). */
  lookupGroups: GeometryGroup[];
  centerOffset: Vec3;
  material: THREE.LineBasicMaterial;
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

  const groupById = useMemo(
    () => new Map(lookupGroups.map((g) => [g.id, g])),
    [lookupGroups],
  );

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
            material={material}
          />
        );
      })}
    </>
  );
}

function MeasureHtmlLabels({
  placements,
  highlightMeasureId = null,
}: {
  placements: ReturnType<typeof computeMeasureLabelPlacements>;
  highlightMeasureId?: string | null;
}) {
  if (placements.length === 0) return null;
  return (
    <>
      {placements.map((p) => {
        const highlighted = !p.isDraft && p.id === highlightMeasureId;
        return (
        <Html
          key={p.id}
          position={[p.position.x, p.position.y, p.position.z]}
          center
          occlude={false}
          zIndexRange={[100, 0]}
          style={{ pointerEvents: "none" }}
        >
          <div
            className={`px-2 py-0.5 rounded-lg font-mono text-xs font-semibold shadow-md border whitespace-nowrap ${
              p.isDraft
                ? "bg-base-100/90 border-sky-400/70 text-sky-600 dark:text-sky-300"
                : highlighted
                  ? "bg-amber-400 border-amber-300 text-amber-950 ring-2 ring-amber-200 scale-110"
                  : "bg-sky-500/95 border-sky-400 text-white"
            }`}
          >
            {p.label}
          </div>
        </Html>
        );
      })}
    </>
  );
}

// Assembly guide labels — visible only when the panel is unobstructed from camera.
function AssemblyLabels({
  labels,
  centerOffset,
  hiddenGroupIds,
}: {
  labels: AssemblyPanelLabel[];
  centerOffset: Vec3;
  hiddenGroupIds: Set<number>;
}) {
  const { camera, scene } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const labelWorld = useRef(new THREE.Vector3());
  const ndc = useRef(new THREE.Vector3());
  const ndcScreen = useMemo(() => new THREE.Vector2(), []);
  const lastCamPos = useRef(new THREE.Vector3());
  const lastCamQuat = useRef(new THREE.Quaternion());
  const labelsKey = useMemo(
    () => labels.map((l) => `${l.panelId}:${l.groupId}`).join("|"),
    [labels],
  );
  const lastLabelsKey = useRef("");
  const [visiblePanelIds, setVisiblePanelIds] = useState<Set<string>>(() => new Set());

  useFrame(() => {
    if (labels.length === 0) {
      if (visiblePanelIds.size > 0) setVisiblePanelIds(new Set());
      return;
    }

    const labelsChanged = labelsKey !== lastLabelsKey.current;
    const posDelta = lastCamPos.current.distanceToSquared(camera.position);
    const quatDelta = lastCamQuat.current.angleTo(camera.quaternion);
    if (
      !labelsChanged &&
      posDelta < 1e-10 &&
      quatDelta < 1e-8 &&
      visiblePanelIds.size > 0
    ) {
      return;
    }
    lastLabelsKey.current = labelsKey;
    lastCamPos.current.copy(camera.position);
    lastCamQuat.current.copy(camera.quaternion);

    const next = new Set<string>();

    for (const lbl of labels) {
      labelWorld.current.set(
        lbl.centroid.x - centerOffset.x,
        lbl.centroid.y - centerOffset.y,
        lbl.centroid.z - centerOffset.z,
      );

      ndc.current.copy(labelWorld.current).project(camera);
      if (ndc.current.z > 1) continue;

      ndcScreen.set(ndc.current.x, ndc.current.y);
      raycaster.setFromCamera(ndcScreen, camera);
      const hits = raycaster.intersectObjects(scene.children, true);
      const picked = pickGroupFromRaycast(raycaster, hits, hiddenGroupIds);
      if (picked?.groupId === lbl.groupId) {
        next.add(lbl.panelId);
      }
    }

    setVisiblePanelIds((prev) => {
      if (prev.size === next.size && [...prev].every((id) => next.has(id))) return prev;
      return next;
    });
  });

  if (labels.length === 0) return null;

  return (
    <>
      {labels.map((lbl) => {
        if (!visiblePanelIds.has(lbl.panelId)) return null;
        return (
          <Html
            key={lbl.panelId}
            position={[lbl.centroid.x, lbl.centroid.y, lbl.centroid.z]}
            center
            occlude={false}
            zIndexRange={[200, 0]}
            style={{ pointerEvents: "none" }}
          >
            <div
              className={`px-1.5 py-0.5 rounded-md font-mono text-[11px] font-bold shadow-lg border select-none ${
                lbl.isSelected
                  ? "bg-primary text-primary-content border-primary/50 ring-2 ring-primary/40 scale-110"
                  : "bg-base-100/95 text-base-content border-base-300/60"
              }`}
            >
              {lbl.panelId}
            </div>
          </Html>
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
  /** Specs de flexión (kerf/auxético) por grupo — preview esquemático. */
  flexSpecs?: FlexSpec[];
  /** Comando imperativo de encuadre de cámara (encuadrar / reset). */
  cameraCommand?: CameraCommand | null;
  /** Rayos X: paredes translúcidas para ver piezas internas. */
  xray?: boolean;
  /** Plano de sección (corte) para ver el interior. */
  section?: SectionState | null;
  /** Modo caminar/volar (primera persona) en lugar de órbita. */
  walkMode?: boolean;
  userCuts?: UserCut[];
  cutDraft?: CutDragState | null;
  movingCutId?: string | null;
  measureDraft?: MeasureDragState | null;
  measures?: UserMeasure[];
  measureLabelOptions?: MeasureLabelOptions;
  highlightMeasureId?: string | null;
  panelRaycastRef: React.MutableRefObject<PanelRaycastContext>;
  palette: ViewerPalette;
  materials: ViewerMaterials;
  mergeMemberFaceIndices?: number[] | null;
  /** Original groups for panel UV projection (cuts use parent frame). */
  projectionGroups?: GeometryGroup[];
  /** Triangle subsets for groups created by user cuts. */
  derivedCutTriangles?: Map<number, DerivedTriangleRef[]>;
  /** Exact panel polygons for cut-derived groups (circle, rect, split). */
  derivedPanelPolys?: Map<number, DerivedPanelPoly>;
  /** Assembly guide: floating panel-id labels shown on all components. */
  assemblyPanelLabels?: AssemblyPanelLabel[];
}

export interface PanelRaycastContext {
  faces: Face3D[];
  groups: GeometryGroup[];
  projectionGroups: GeometryGroup[];
  hiddenGroupIds: Set<number>;
  appliedAxis: "Y" | "Z";
  modelCenter: Vec3;
}

const EMPTY_MARK_SET = new Set<number>();
const EMPTY_FLEX: FlexSpec[] = [];

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
  flexSpecs = EMPTY_FLEX,
  cameraCommand = null,
  xray = false,
  section = null,
  walkMode = false,
  userCuts = [],
  cutDraft = null,
  movingCutId = null,
  measureDraft = null,
  measures = [],
  measureLabelOptions = DEFAULT_MEASURE_LABEL_OPTIONS,
  highlightMeasureId = null,
  panelRaycastRef,
  palette,
  materials,
  mergeMemberFaceIndices = null,
  projectionGroups,
  derivedCutTriangles,
  derivedPanelPolys,
  assemblyPanelLabels = [],
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
    return {
      center: { x: cx, y: cy, z: cz },
      diag,
      min: { x: minX, y: minY, z: minZ },
      max: { x: maxX, y: maxY, z: maxZ },
    };
  }, [faces]);

  // Merged geometries — rebuilt when categories or overrides change.
  const mergedMeshes = useMemo(
    () =>
      buildMergedGeometries(
        faces,
        groups,
        categoryOverrides,
        hiddenGroupIds,
        derivedCutTriangles,
        derivedPanelPolys,
        projectionGroups,
        appliedAxis,
        userCuts,
      ),
    [
      faces,
      groups,
      categoryOverrides,
      hiddenGroupIds,
      derivedCutTriangles,
      derivedPanelPolys,
      projectionGroups,
      appliedAxis,
      userCuts,
    ],
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

    const allTris: DerivedTriangleRef[] = [];
    const allFaceIndices: number[] = [];
    const panelPositions: number[] = [];
    for (const g of selectedGroups) {
      const panelPoly = derivedPanelPolys?.get(g.id);
      if (panelPoly) {
        const parentId = cutDerivedParentId(g.id);
        const parentGroup =
          parentId != null
            ? projectionGroups?.find((pg) => pg.id === parentId)
            : undefined;
        if (parentGroup) {
          const surfaceCut =
            surfaceCutForDerivedGroup(g.id, parentId, userCuts) ??
            userCuts.find((c) => c.groupId === parentId);
          for (const tri of triangulatePanelPoly(panelPoly)) {
            const wa = panelUVToWorldOnSurface(
              tri[0].x, tri[0].y, faces, parentGroup, appliedAxis,
              surfaceCut?.surfaceNormal, surfaceCut?.surfaceOffset,
            );
            const wb = panelUVToWorldOnSurface(
              tri[1].x, tri[1].y, faces, parentGroup, appliedAxis,
              surfaceCut?.surfaceNormal, surfaceCut?.surfaceOffset,
            );
            const wc = panelUVToWorldOnSurface(
              tri[2].x, tri[2].y, faces, parentGroup, appliedAxis,
              surfaceCut?.surfaceNormal, surfaceCut?.surfaceOffset,
            );
            if (!wa || !wb || !wc) continue;
            panelPositions.push(
              wa.x,
              wa.y,
              wa.z,
              wb.x,
              wb.y,
              wb.z,
              wc.x,
              wc.y,
              wc.z,
            );
          }
          continue;
        }
      }

      const triSubset = derivedCutTriangles?.get(g.id);
      if (triSubset) allTris.push(...triSubset);
      else allFaceIndices.push(...g.faceIndices);
    }

    if (panelPositions.length > 0 && allTris.length === 0 && allFaceIndices.length === 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(panelPositions, 3),
      );
      return geo;
    }

    if (allTris.length > 0 && allFaceIndices.length === 0 && panelPositions.length === 0) {
      return buildSelectedGeometryFromTriangles(faces, allTris);
    }
    if (allTris.length === 0 && panelPositions.length === 0) {
      return buildSelectedGeometry(faces, allFaceIndices);
    }

    const positions: number[] = [...panelPositions];
    for (const { faceIndex, i0, i1, i2 } of allTris) {
      const face = faces[faceIndex];
      if (!face) continue;
      const a = face.vertices[i0];
      const b = face.vertices[i1];
      const c = face.vertices[i2];
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    }
    for (const idx of allFaceIndices) {
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
  }, [
    faces,
    selectedGroups,
    mergeMemberFaceIndices,
    derivedCutTriangles,
    derivedPanelPolys,
    projectionGroups,
    appliedAxis,
    userCuts,
  ]);

  useEffect(() => {
    return () => {
      if (selectedGeometry) selectedGeometry.dispose();
    };
  }, [selectedGeometry]);

  // Esfera envolvente de la selección (coords de escena, centradas) para encuadrar.
  const selectionSphere = useMemo(() => {
    if (!selectedGeometry) return null;
    selectedGeometry.computeBoundingSphere();
    const bs = selectedGeometry.boundingSphere;
    if (!bs || !Number.isFinite(bs.radius)) return null;
    return {
      center: {
        x: bs.center.x - bounds.center.x,
        y: bs.center.y - bounds.center.y,
        z: bs.center.z - bounds.center.z,
      },
      radius: Math.max(bs.radius, 0.05),
    };
  }, [selectedGeometry, bounds.center]);

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
  // Only produce a focus target when the user has actually selected something.
  // Returning null on deselect prevents the camera from snapping back to
  // the model centre every time the user clicks on empty space.
  const focusTarget: Vec3 | null = selectedGroups.length > 0
    ? {
        x: selectedGroups.reduce((s, g) => s + g.centroid.x, 0) / selectedGroups.length - bounds.center.x,
        y: selectedGroups.reduce((s, g) => s + g.centroid.y, 0) / selectedGroups.length - bounds.center.y,
        z: selectedGroups.reduce((s, g) => s + g.centroid.z, 0) / selectedGroups.length - bounds.center.z,
      }
    : null;

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

  // Preview esquemático (cian) del patrón de flexión kerf/auxético por grupo.
  const flexPreviewSegments = useMemo(() => {
    if (flexSpecs.length === 0) return [] as CutPreviewSegment[];
    const groupLines = computeFlexPreview3D(faces, groups, flexSpecs, appliedAxis, hiddenGroupIds);
    const out: CutPreviewSegment[] = [];
    for (const gl of groupLines) {
      for (const s of gl.segments) {
        out.push({ groupId: gl.groupId, normal: gl.normal, a: s.a, b: s.b });
      }
    }
    return out;
  }, [faces, groups, flexSpecs, appliedAxis, hiddenGroupIds]);

  const cutPreviewSegments = useMemo(() => {
    const parentGroups = projectionGroups ?? groups;
    const fromCuts = computeCutPreviewSegments(
      faces,
      parentGroups,
      userCuts,
      cutDraft,
      appliedAxis,
      movingCutId,
    );
    // userCuts already draw every cut outline; derived polys duplicate and drift.
    return fromCuts;
  }, [
    faces,
    groups,
    projectionGroups,
    userCuts,
    cutDraft,
    appliedAxis,
    movingCutId,
  ]);

  const cutPreviewLookupGroups = projectionGroups ?? groups;

  const measurePreviewSegments = useMemo(
    () =>
      computeMeasurePreviewSegments(
        faces,
        groups,
        measures,
        measureDraft ?? null,
        appliedAxis,
      ),
    [faces, groups, measures, measureDraft, appliedAxis],
  );

  const measureLabelPlacements = useMemo(
    () =>
      computeMeasureLabelPlacements(
        faces,
        groups,
        measures,
        measureDraft ?? null,
        appliedAxis,
        measureLabelOptions,
      ),
    [faces, groups, measures, measureDraft, appliedAxis, measureLabelOptions],
  );

  panelRaycastRef.current = {
    faces,
    groups,
    projectionGroups: projectionGroups ?? groups,
    hiddenGroupIds,
    appliedAxis,
    modelCenter: bounds.center,
  };

  // Hover: resaltar y nombrar el componente bajo el cursor (confirmar qué se
  // va a seleccionar). Click cíclico: rotar entre superpuestos.
  const [hoveredGroupId, setHoveredGroupId] = useState<number | null>(null);
  const cycleRef = useRef<ClickCycleState | null>(null);
  const handleHover = (id: number | null) =>
    setHoveredGroupId((prev) => (prev === id ? prev : id));

  const hoveredGroup =
    hoveredGroupId != null && !selectedGroupIds.has(hoveredGroupId)
      ? groups.find((g) => g.id === hoveredGroupId) ?? null
      : null;
  const hoveredGeometry = useMemo(() => {
    if (!hoveredGroup || !hoveredGroup.faceIndices?.length) return null;
    return buildSelectedGeometry(faces, hoveredGroup.faceIndices);
  }, [hoveredGroup, faces]);
  useEffect(() => () => hoveredGeometry?.dispose(), [hoveredGeometry]);

  return (
    <>
      {walkMode ? (
        <WalkControls speed={Math.max(bounds.diag * 0.4, 1)} />
      ) : (
        <CameraControls
          target={focusTarget}
          maxDistance={maxDist}
          minDistance={minDist}
          enabled={!boxSelectActive}
          selectionSphere={selectionSphere}
          modelRadius={bounds.diag * 0.5}
          command={cameraCommand}
        />
      )}

      {section && (
        <SectionPlane
          section={section}
          min={bounds.min}
          max={bounds.max}
          center={bounds.center}
          materials={materials}
        />
      )}

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
              xray={xray}
              groupAreaById={groupAreaById}
              materials={materials}
              onPick={onSelectGroup}
              onTogglePick={onToggleGroup}
              onContextMenu={onContextMenu}
              onHover={handleHover}
              cycleRef={cycleRef}
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

        {hoveredGeometry && (
          <mesh geometry={hoveredGeometry} material={materials.hover} renderOrder={3} />
        )}
        {hoveredGroup && (
          <Html
            position={[hoveredGroup.centroid.x, hoveredGroup.centroid.y, hoveredGroup.centroid.z]}
            center
            style={{ pointerEvents: "none" }}
            zIndexRange={[100, 0]}
          >
            <div className="px-1.5 py-0.5 rounded-md text-[11px] font-medium bg-base-100/90 border border-base-300/60 text-base-content whitespace-nowrap shadow">
              {hoveredGroup.label || `Pieza ${hoveredGroup.id}`}
            </div>
          </Html>
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
          <PreviewOverlays
            segments={cutPreviewSegments}
            lookupGroups={cutPreviewLookupGroups}
            centerOffset={bounds.center}
            material={CUT_PREVIEW_MATERIAL}
          />
        )}

        {flexPreviewSegments.length > 0 && (
          <PreviewOverlays
            segments={flexPreviewSegments}
            lookupGroups={groups}
            centerOffset={bounds.center}
            material={FLEX_PREVIEW_MATERIAL}
          />
        )}

        {measurePreviewSegments.length > 0 && (
          <PreviewOverlays
            segments={measurePreviewSegments}
            lookupGroups={groups}
            centerOffset={bounds.center}
            material={MEASURE_PREVIEW_MATERIAL}
          />
        )}

        <MeasureHtmlLabels
          placements={measureLabelPlacements}
          highlightMeasureId={highlightMeasureId}
        />

        {/* Assembly guide: panel-id badges centered on each component */}
        {assemblyPanelLabels.length > 0 && (
          <AssemblyLabels
            labels={assemblyPanelLabels}
            centerOffset={bounds.center}
            hiddenGroupIds={hiddenGroupIds}
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
    /** Unit normal of the clicked triangle face (toward camera). */
    surfaceNormal: { x: number; y: number; z: number };
    /** Signed distance from projection plane to clicked face along `surfaceNormal` (m). */
    surfaceOffset: number;
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
    surfaceNormal?: { x: number; y: number; z: number },
  ): { u: number; v: number } | null;
  /** Panel bounding size for the owner group (same frame as raycastPanelFull). */
  getPanelSize(groupId: number): { widthM: number; heightM: number } | null;
  /** Panel size for display groups (measure tool). */
  getDisplayPanelSize(groupId: number): { widthM: number; heightM: number } | null;
  /** Raycast for measure tool — uses visible group id + its panel frame. */
  raycastMeasure(clientX: number, clientY: number): {
    hitGroupId: number;
    u: number;
    v: number;
    scenePoint: { x: number; y: number; z: number };
    projection: PanelProjection;
  } | null;
  /**
   * Combined plane-projection + cross-panel edge snap for the measure endpoint.
   *
   * Internals:
   *  1. Project the ray onto the anchor plane (free-space — works in air and
   *     across walls that share the same plane) → baseUV
   *  2. If snapEnabled: also raycast into the scene. If a panel is hit and the
   *     hit UV is within snap tolerance of one of that panel's edges, snap the
   *     world position to that edge and re-express it in the anchor frame.
   *
   * Returns null only if the plane projection fails (ray parallel to plane).
   */
  snapMeasureEndpoint(
    clientX: number,
    clientY: number,
    sceneAnchor: { x: number; y: number; z: number },
    anchorProjection: PanelProjection,
    snapEnabled: boolean,
  ): { u: number; v: number } | null;
}

/**
 * Pick the best group from a set of raycast hits.
 *
 * Scores every valid merged-mesh hit by how directly its face normal aligns
 * with the ray (visible surface), with distance as tie-breaker. Does not
 * walk past the closest hit into unrelated walls at corners or openings.
 */
function faceNormalWorld(hit: THREE.Intersection, rayDir: THREE.Vector3): THREE.Vector3 {
  if (!hit.face) return new THREE.Vector3(0, 0, 1);
  const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
  // Ensure normal points toward the camera (front face of the clicked surface).
  if (n.dot(rayDir) > 0) n.negate();
  return n;
}

function resolvePanelRaycastGroup(
  ctx: PanelRaycastContext,
  pickedGroupId: number,
): {
  hitGroup: GeometryGroup;
  ownerId: number;
  projGroup: GeometryGroup;
} | null {
  const hitGroup = ctx.groups.find((g) => g.id === pickedGroupId);
  // Only allow cuts on vertical walls; reject floors, ceilings and unknowns
  // that happen to be categorised as "wall" by the exporter.
  if (!hitGroup || hitGroup.category !== "wall" || hitGroup.orientation === "horizontal") {
    return null;
  }

  const ownerId = cutGroupOwnerId(pickedGroupId);
  const projGroup =
    ctx.projectionGroups.find((g) => g.id === ownerId) ?? hitGroup;
  return { hitGroup, ownerId, projGroup };
}

function pickGroupFromRaycast(
  raycaster: THREE.Raycaster,
  hits: THREE.Intersection[],
  hiddenGroupIds: Set<number>,
): {
  groupId: number;
  point: THREE.Vector3;
  faceNormal: THREE.Vector3;
} | null {
  if (hits.length === 0) return null;
  const rayDir = raycaster.ray.direction;

  function tryHit(hit: THREE.Intersection): {
    groupId: number;
    point: THREE.Vector3;
    faceNormal: THREE.Vector3;
  } | null {
    const data = hit.object.userData?.mergedMeshData as { groupIds: number[] } | undefined;
    if (!data || hit.faceIndex == null || hit.faceIndex < 0) return null;
    if (hit.faceIndex >= data.groupIds.length) return null;
    const groupId = data.groupIds[hit.faceIndex];
    if (hiddenGroupIds.has(groupId)) return null;
    return { groupId, point: hit.point.clone(), faceNormal: faceNormalWorld(hit, rayDir) };
  }

  // Prefer the NEAREST wall hit; only use face-facing as tie-breaker within
  // ~3 mm (double-sided / coplanar triangles). Weighting facing over distance
  // picked interior back-faces seen through the transparent shell.
  const COPLANAR_TOL = 0.003;
  let closestDist = Infinity;
  let best: ReturnType<typeof tryHit> = null;
  let bestFacing = -Infinity;

  for (const hit of hits) {
    const r = tryHit(hit);
    if (!r) continue;
    const facing = -r.faceNormal.dot(rayDir);

    if (hit.distance < closestDist - COPLANAR_TOL) {
      closestDist = hit.distance;
      best = r;
      bestFacing = facing;
      continue;
    }

    if (hit.distance <= closestDist + COPLANAR_TOL && facing > bestFacing) {
      closestDist = Math.min(closestDist, hit.distance);
      bestFacing = facing;
      best = r;
    }
  }

  return best;
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

        const resolved = resolvePanelRaycastGroup(ctx, picked.groupId);
        if (!resolved) return null;
        const { ownerId, projGroup } = resolved;

        const modelPoint = {
          x: picked.point.x + ctx.modelCenter.x,
          y: picked.point.y + ctx.modelCenter.y,
          z: picked.point.z + ctx.modelCenter.z,
        };
        const uv = worldPointToPanelUV(
          modelPoint,
          ctx.faces,
          projGroup,
          ctx.appliedAxis,
        );
        if (!uv) return null;
        return { groupId: ownerId, u: uv.u, v: uv.v };
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

        const resolved = resolvePanelRaycastGroup(ctx, picked.groupId);
        if (!resolved) return null;
        const { ownerId, projGroup } = resolved;

        const modelPoint = {
          x: picked.point.x + ctx.modelCenter.x,
          y: picked.point.y + ctx.modelCenter.y,
          z: picked.point.z + ctx.modelCenter.z,
        };
        const uv = worldPointToPanelUV(
          modelPoint,
          ctx.faces,
          projGroup,
          ctx.appliedAxis,
        );
        if (!uv) return null;

        const projection = getGroupProjection(
          ctx.faces,
          projGroup,
          ctx.appliedAxis,
        );
        if (!projection) return null;

        const baseOnPlane = panelUVToWorldPoint(
          uv.u,
          uv.v,
          ctx.faces,
          projGroup,
          ctx.appliedAxis,
        );
        let surfaceOffset = 0;
        let scenePoint = {
          x: picked.point.x,
          y: picked.point.y,
          z: picked.point.z,
        };
        if (baseOnPlane) {
          const dx = modelPoint.x - baseOnPlane.x;
          const dy = modelPoint.y - baseOnPlane.y;
          const dz = modelPoint.z - baseOnPlane.z;
          const fn = picked.faceNormal;
          surfaceOffset = dx * fn.x + dy * fn.y + dz * fn.z;
          // Anchor drag plane on the projection frame, not the raw mesh hit.
          scenePoint = {
            x: baseOnPlane.x - ctx.modelCenter.x,
            y: baseOnPlane.y - ctx.modelCenter.y,
            z: baseOnPlane.z - ctx.modelCenter.z,
          };
        }

        return {
          groupId: ownerId,
          u: uv.u,
          v: uv.v,
          scenePoint,
          projection,
          surfaceNormal: {
            x: picked.faceNormal.x,
            y: picked.faceNormal.y,
            z: picked.faceNormal.z,
          },
          surfaceOffset,
        };
      },

      getUVFromMouseOnPlane(clientX, clientY, sceneAnchor, projection, _surfaceNormal) {
        const canvas = gl.domElement;
        const canvasRect = canvas.getBoundingClientRect();
        if (canvasRect.width === 0 || canvasRect.height === 0) return null;

        const ndcX = ((clientX - canvasRect.left) / canvasRect.width) * 2 - 1;
        const ndcY = -((clientY - canvasRect.top) / canvasRect.height) * 2 + 1;

        const rayOrigin = camera.position.clone();
        const rayDir = new THREE.Vector3(ndcX, ndcY, 0.5)
          .unproject(camera)
          .sub(rayOrigin)
          .normalize();

        // Must intersect the SAME projection plane used for UV axes (representativeNormal),
        // not the clicked face normal — mixing the two skews UV during drag and makes
        // cut outlines float off the wall.
        const n = new THREE.Vector3(
          projection.normal.x,
          projection.normal.y,
          projection.normal.z,
        );
        const anchor = new THREE.Vector3(sceneAnchor.x, sceneAnchor.y, sceneAnchor.z);

        const denom = n.dot(rayDir);
        if (Math.abs(denom) < 1e-6) return null;
        const t = n.dot(anchor.clone().sub(rayOrigin)) / denom;
        if (t < 0) return null;

        const scenePoint = rayOrigin.clone().addScaledVector(rayDir, t);

        const ctx = panelRaycastRef.current;
        const mx = scenePoint.x + ctx.modelCenter.x;
        const my = scenePoint.y + ctx.modelCenter.y;
        const mz = scenePoint.z + ctx.modelCenter.z;

        const { uAxis, vAxis, originU, originV } = projection;
        const u = mx * uAxis.x + my * uAxis.y + mz * uAxis.z - originU;
        const v = mx * vAxis.x + my * vAxis.y + mz * vAxis.z - originV;
        return { u, v };
      },

      getPanelSize(groupId) {
        const ctx = panelRaycastRef.current;
        const ownerId = cutGroupOwnerId(groupId);
        const group =
          ctx.projectionGroups.find((g) => g.id === ownerId) ??
          ctx.groups.find((g) => g.id === ownerId);
        if (!group) return null;
        return getGroupPanelSize(ctx.faces, group, ctx.appliedAxis);
      },

      getDisplayPanelSize(groupId) {
        const ctx = panelRaycastRef.current;
        const group = ctx.groups.find((g) => g.id === groupId);
        if (!group) return null;
        return getGroupPanelSize(ctx.faces, group, ctx.appliedAxis);
      },

      raycastMeasure(clientX, clientY) {
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
        const uv = worldPointToPanelUV(
          modelPoint,
          ctx.faces,
          group,
          ctx.appliedAxis,
          picked.faceNormal,
        );
        if (!uv) return null;

        const projection = getGroupProjection(
          ctx.faces,
          group,
          ctx.appliedAxis,
          picked.faceNormal,
        );
        if (!projection) return null;

        return {
          hitGroupId: picked.groupId,
          u: uv.u,
          v: uv.v,
          scenePoint: { x: picked.point.x, y: picked.point.y, z: picked.point.z },
          projection,
        };
      },

      snapMeasureEndpoint(clientX, clientY, sceneAnchor, anchorProjection, snapEnabled) {
        const ctx = panelRaycastRef.current;
        const canvas = gl.domElement;
        const canvasRect = canvas.getBoundingClientRect();
        if (canvasRect.width === 0 || canvasRect.height === 0) return null;

        const ndcX = ((clientX - canvasRect.left) / canvasRect.width) * 2 - 1;
        const ndcY = -((clientY - canvasRect.top) / canvasRect.height) * 2 + 1;

        const rayOrigin = camera.position.clone();
        const rayDir = new THREE.Vector3(ndcX, ndcY, 0.5)
          .unproject(camera)
          .sub(rayOrigin)
          .normalize();

        // Step 1 — project ray onto the anchor panel's plane (works in air and
        // across walls that share the same normal plane).
        const planeN = new THREE.Vector3(
          anchorProjection.normal.x,
          anchorProjection.normal.y,
          anchorProjection.normal.z,
        );
        const anchorPt = new THREE.Vector3(sceneAnchor.x, sceneAnchor.y, sceneAnchor.z);
        const denom = planeN.dot(rayDir);
        if (Math.abs(denom) < 1e-6) return null;
        const t = planeN.dot(anchorPt.clone().sub(rayOrigin)) / denom;
        if (t < 0) return null;

        const planePt = rayOrigin.clone().addScaledVector(rayDir, t);
        // Convert scene → model space → anchor UV frame.
        const sceneToAnchorUV = (sx: number, sy: number, sz: number) => {
          const mx = sx + ctx.modelCenter.x;
          const my = sy + ctx.modelCenter.y;
          const mz = sz + ctx.modelCenter.z;
          return {
            u: mx * anchorProjection.uAxis.x + my * anchorProjection.uAxis.y + mz * anchorProjection.uAxis.z - anchorProjection.originU,
            v: mx * anchorProjection.vAxis.x + my * anchorProjection.vAxis.y + mz * anchorProjection.vAxis.z - anchorProjection.originV,
          };
        };
        const baseUV = sceneToAnchorUV(planePt.x, planePt.y, planePt.z);

        if (!snapEnabled) return baseUV;

        // Step 2 — raycast to find if we're hovering a panel, and snap to its
        // nearest edge when close enough.
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
        const hits = raycaster.intersectObjects(scene.children, true);
        const picked = pickGroupFromRaycast(raycaster, hits, ctx.hiddenGroupIds);
        if (!picked) return baseUV;

        const hitGroup = ctx.groups.find((g) => g.id === picked.groupId);
        if (!hitGroup) return baseUV;

        const hitModelPt = {
          x: picked.point.x + ctx.modelCenter.x,
          y: picked.point.y + ctx.modelCenter.y,
          z: picked.point.z + ctx.modelCenter.z,
        };
        const hitUV = worldPointToPanelUV(hitModelPt, ctx.faces, hitGroup, ctx.appliedAxis);
        const hitSize = getGroupPanelSize(ctx.faces, hitGroup, ctx.appliedAxis);
        if (!hitUV || !hitSize) return baseUV;

        // Snap within 8 cm OR 6% of the shorter dimension (whichever is larger).
        const snapTol = Math.max(0.08, Math.min(hitSize.widthM, hitSize.heightM) * 0.06);
        let { u: hu, v: hv } = hitUV;
        let snapped = false;

        if (hu <= snapTol) { hu = 0; snapped = true; }
        else if (hu >= hitSize.widthM - snapTol) { hu = hitSize.widthM; snapped = true; }

        if (hv <= snapTol) { hv = 0; snapped = true; }
        else if (hv >= hitSize.heightM - snapTol) { hv = hitSize.heightM; snapped = true; }

        if (!snapped) return baseUV;

        // Re-express the snapped world point in the anchor frame.
        const snappedWorld = panelUVToWorldPoint(hu, hv, ctx.faces, hitGroup, ctx.appliedAxis);
        if (!snappedWorld) return baseUV;

        // snappedWorld is in model space (panelUVToWorldPoint returns model coords).
        const snappedUV = {
          u: snappedWorld.x * anchorProjection.uAxis.x + snappedWorld.y * anchorProjection.uAxis.y + snappedWorld.z * anchorProjection.uAxis.z - anchorProjection.originU,
          v: snappedWorld.x * anchorProjection.vAxis.x + snappedWorld.y * anchorProjection.vAxis.y + snappedWorld.z * anchorProjection.vAxis.z - anchorProjection.originV,
        };
        return snappedUV;
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
  /** Specs de flexión (kerf/auxético) por grupo — preview esquemático. */
  flexSpecs?: FlexSpec[];
  /** Comando imperativo de encuadre de cámara (encuadrar / reset). */
  cameraCommand?: CameraCommand | null;
  /** Rayos X: paredes translúcidas para ver piezas internas. */
  xray?: boolean;
  /** Plano de sección (corte) para ver el interior. */
  section?: SectionState | null;
  /** Modo caminar/volar (primera persona) en lugar de órbita. */
  walkMode?: boolean;
  userCuts?: UserCut[];
  cutDraft?: CutDragState | null;
  movingCutId?: string | null;
  measureDraft?: MeasureDragState | null;
  measures?: UserMeasure[];
  measureLabelOptions?: MeasureLabelOptions;
  highlightMeasureId?: string | null;
  /** Face indices to highlight for a focused merge member (subset of merged group). */
  mergeMemberFaceIndices?: number[] | null;
  /** Original topology groups for cut UV projection (parent panel frame). */
  projectionGroups?: GeometryGroup[];
  /** Triangle subsets for groups created by user cuts. */
  derivedCutTriangles?: Map<number, DerivedTriangleRef[]>;
  /** Exact panel polygons for cut-derived groups (circle, rect, split). */
  derivedPanelPolys?: Map<number, DerivedPanelPoly>;
  /** Assembly guide: floating panel-id labels shown on all components. */
  assemblyPanelLabels?: AssemblyPanelLabel[];
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
  flexSpecs = EMPTY_FLEX,
  cameraCommand = null,
  xray = false,
  section = null,
  walkMode = false,
  userCuts = [],
  cutDraft = null,
  movingCutId = null,
  measureDraft = null,
  measures = [],
  measureLabelOptions = DEFAULT_MEASURE_LABEL_OPTIONS,
  highlightMeasureId = null,
  mergeMemberFaceIndices = null,
  projectionGroups,
  derivedCutTriangles,
  derivedPanelPolys,
  assemblyPanelLabels = [],
}: ModelViewerProps) {
  const palette = useViewerPalette();
  const materials = useMemo(() => createViewerMaterials(palette), [palette]);
  useEffect(() => () => disposeViewerMaterials(materials), [materials]);

  const panelRaycastRef = useRef<PanelRaycastContext>({
    faces: [],
    groups: [],
    projectionGroups: [],
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
        flexSpecs={flexSpecs}
        cameraCommand={cameraCommand}
        xray={xray}
        section={section}
        walkMode={walkMode}
        userCuts={userCuts}
        cutDraft={cutDraft}
        movingCutId={movingCutId}
        measureDraft={measureDraft}
        measures={measures}
        measureLabelOptions={measureLabelOptions}
        highlightMeasureId={highlightMeasureId}
        panelRaycastRef={panelRaycastRef}
        palette={palette}
        materials={materials}
        mergeMemberFaceIndices={mergeMemberFaceIndices}
        projectionGroups={projectionGroups}
        derivedCutTriangles={derivedCutTriangles}
        derivedPanelPolys={derivedPanelPolys}
        assemblyPanelLabels={assemblyPanelLabels}
      />

      {viewerRef && (
        <SceneBridge
          handleRef={viewerRef}
          modelCenter={modelCenter}
          panelRaycastRef={panelRaycastRef}
        />
      )}

      {/* ViewCube: clic en caras/aristas para orientar la vista al instante.
          Oculto en modo caminar (los controles de órbita no están montados). */}
      {!walkMode && (
      <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
        <GizmoViewcube
          color={palette.background}
          textColor={palette.gizmoLabel}
          strokeColor={palette.gizmoLabel}
          hoverColor="#22d3ee"
        />
      </GizmoHelper>
      )}
    </Canvas>
  );
}
