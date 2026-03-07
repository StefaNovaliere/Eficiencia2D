// ============================================================================
// Shared geometry types for the Eficiencia2D processing pipeline.
// ============================================================================

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Vec2 {
  x: number;
  y: number;
}

/** A closed loop of 2D points (outer boundary or polygon outline). */
export interface Loop2D {
  vertices: Vec2[];
  panelId?: string;
}

/** A 3D face extracted from the source model. */
export interface Face3D {
  vertices: Vec3[];
  normal: Vec3;
  innerLoops: Vec3[][];
  panelId?: string;
}

/** One elevation view of the building (N/S/E/W). */
export interface Facade {
  label: string;
  direction: Vec3;
  polygons: Loop2D[];
  width: number;
  height: number;
}

/** A 2D line segment in a floor plan. */
export interface FloorPlanSegment {
  a: Vec2;
  b: Vec2;
  isInterior: boolean;
}

/** One horizontal section-cut view at a specific floor level. */
export interface FloorPlan {
  label: string;
  segments: FloorPlanSegment[];
  width: number;
  height: number;
  elevation: number;
}

/** Options that travel through the full pipeline. */
export interface PipelineOptions {
  scaleDenom: number;
  paper: string;
  includeCuttingSheet?: boolean;
}

/** A generated output file ready for download. */
export interface OutputFile {
  name: string;
  blob: Blob;
}

// --- Vector math helpers ---------------------------------------------------

export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function scaleVec(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function vlength(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

export function normalize(v: Vec3): Vec3 {
  const len = vlength(v);
  if (len < 1e-12) return { x: 0, y: 0, z: 0 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}
