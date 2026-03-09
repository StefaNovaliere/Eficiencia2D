// ============================================================================
// Door Extractor
//
// Detects door components from OBJ groups and extracts their 2D floor-plan
// representation: hinge point, width, swing direction, and arc angles.
//
// Detection:
//   1. Match group names containing "puerta", "door", or "porta" (case-insensitive).
//   2. Analyse the 3D bounding box to determine door width and orientation.
//   3. Infer swing direction from the dominant vertical-face normal.
//
// Output: Door2D objects for rendering as architectural door symbols
// (arc + leaf line) in floor-plan DXFs and PDFs.
//
// Hinge inference:
//   - Default: the endpoint with the smaller coordinate along the wall axis.
//   - Override via group name: "_der" / "_right" / "_R" → hinge at max end.
//
// Swing inference:
//   - The dominant vertical face's normal projected to the ground plane
//     gives the direction the door opens toward.
// ============================================================================

import type { Face3D, Vec2, Vec3, Door2D } from "./types";
import { cross, sub } from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DOOR_NAME_PATTERN = /puerta|door|porta/i;
const HINGE_RIGHT_PATTERN = /_der|_right|_R\b/i;

/** A door leaf is typically 3–10 cm thick.  Skip thicker groups. */
const MAX_DOOR_THICKNESS = 0.30; // metres
/** Minimum width to be recognised as a door. */
const MIN_DOOR_WIDTH = 0.40; // metres
/** Maximum width (double doors can reach ~2.4 m). */
const MAX_DOOR_WIDTH = 3.0; // metres

type UpAxis = "Y" | "Z";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check whether an OBJ group name looks like a door component. */
export function isDoorGroup(name: string): boolean {
  return DOOR_NAME_PATTERN.test(name);
}

function getUp(v: Vec3, up: UpAxis): number {
  return up === "Y" ? v.y : v.z;
}

function projectTopDown(v: Vec3, up: UpAxis): Vec2 {
  return up === "Y" ? { x: v.x, y: v.z } : { x: v.x, y: v.y };
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

// ---------------------------------------------------------------------------
// Single-door analysis
// ---------------------------------------------------------------------------

/**
 * Analyse a group of faces representing a single door and return its
 * 2D plan-view representation, or `null` if the geometry does not
 * look like a door (wrong dimensions, does not span the cut elevation, etc.).
 */
export function analyzeDoorGroup(
  groupName: string,
  faces: Face3D[],
  cutElev: number,
  up: UpAxis,
): Door2D | null {
  if (faces.length === 0) return null;

  // --- Does the door span the section-cut elevation? ---
  const allVerts = faces.flatMap((f) => f.vertices);
  const elevations = allVerts.map((v) => getUp(v, up));
  const minElev = Math.min(...elevations);
  const maxElev = Math.max(...elevations);
  if (minElev > cutElev || maxElev < cutElev) return null;

  // --- Project every vertex to the ground plane ---
  const pts2D = allVerts.map((v) => projectTopDown(v, up));
  const xs = pts2D.map((p) => p.x);
  const ys = pts2D.map((p) => p.y);

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const dx = maxX - minX;
  const dy = maxY - minY;

  // --- Wall direction (longer axis) vs thickness (shorter axis) ---
  let width: number;
  let thickness: number;
  let hingeA: Vec2; // candidate endpoint A (min-coordinate end)
  let hingeB: Vec2; // candidate endpoint B (max-coordinate end)

  if (dx >= dy) {
    // Door runs along X
    width = dx;
    thickness = dy;
    const midY = (minY + maxY) / 2;
    hingeA = { x: minX, y: midY };
    hingeB = { x: maxX, y: midY };
  } else {
    // Door runs along Y
    width = dy;
    thickness = dx;
    const midX = (minX + maxX) / 2;
    hingeA = { x: midX, y: minY };
    hingeB = { x: midX, y: maxY };
  }

  // --- Dimension validation ---
  if (thickness > MAX_DOOR_THICKNESS) return null;
  if (width < MIN_DOOR_WIDTH || width > MAX_DOOR_WIDTH) return null;

  // --- Swing direction from the largest vertical face normal ---
  let bestArea = 0;
  let bestNormal: Vec3 | null = null;
  for (const face of faces) {
    const upComp = Math.abs(getUp(face.normal, up));
    if (upComp > 0.5) continue; // skip horizontal faces (floor/ceiling of the door frame)
    const area = faceArea(face);
    if (area > bestArea) {
      bestArea = area;
      bestNormal = face.normal;
    }
  }
  if (!bestNormal) return null;

  // Project normal → 2D and normalise.
  const rawSwing = projectTopDown(bestNormal, up);
  const swingLen = Math.sqrt(rawSwing.x * rawSwing.x + rawSwing.y * rawSwing.y);
  if (swingLen < 0.01) return null;
  const swingDir: Vec2 = { x: rawSwing.x / swingLen, y: rawSwing.y / swingLen };

  // --- Hinge selection ---
  // Default: hingeA (min-coordinate end).
  // Override if the group name indicates "right" hinge.
  const hingeRight = HINGE_RIGHT_PATTERN.test(groupName);
  const hinge = hingeRight ? hingeB : hingeA;
  const freeEnd = hingeRight ? hingeA : hingeB;

  // --- Compute DXF arc angles ---
  // wallAngle: from hinge toward the free end (= closed door position).
  const toFree: Vec2 = { x: freeEnd.x - hinge.x, y: freeEnd.y - hinge.y };
  const wallAngleDeg = Math.atan2(toFree.y, toFree.x) * (180 / Math.PI);
  const swingAngleDeg = Math.atan2(swingDir.y, swingDir.x) * (180 / Math.PI);

  // 2D cross-product tells us the rotation sense.
  const crossVal = toFree.x * swingDir.y - toFree.y * swingDir.x;

  let startAngle: number;
  let endAngle: number;

  if (crossVal >= 0) {
    // swingDir is CCW from wallDir → arc goes CCW from wall to swing.
    startAngle = wallAngleDeg;
    endAngle = swingAngleDeg;
  } else {
    // swingDir is CW from wallDir → reverse so DXF arc (always CCW) is correct.
    startAngle = swingAngleDeg;
    endAngle = wallAngleDeg;
  }

  // Normalise to [0, 360).
  startAngle = ((startAngle % 360) + 360) % 360;
  endAngle = ((endAngle % 360) + 360) % 360;

  // --- Leaf endpoint (fully-open position) ---
  const swingRad = swingAngleDeg * (Math.PI / 180);
  const leafEnd: Vec2 = {
    x: hinge.x + width * Math.cos(swingRad),
    y: hinge.y + width * Math.sin(swingRad),
  };

  return { hinge, width, startAngle, endAngle, leafEnd };
}

// ---------------------------------------------------------------------------
// Batch extraction for one floor level
// ---------------------------------------------------------------------------

/**
 * Extract `Door2D` entries for a given section-cut elevation.
 *
 * @param doorFacesByGroup  Faces already grouped by door-group name.
 * @param cutElev           Horizontal section-cut elevation.
 * @param up                Vertical-axis convention.
 */
export function extractDoorsForLevel(
  doorFacesByGroup: Map<string, Face3D[]>,
  cutElev: number,
  up: UpAxis,
): Door2D[] {
  const doors: Door2D[] = [];
  for (const [name, groupFaces] of doorFacesByGroup) {
    const door = analyzeDoorGroup(name, groupFaces, cutElev, up);
    if (door) doors.push(door);
  }
  return doors;
}
