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

/** A closed loop of 2D points (outer boundary or inner opening). */
export interface Loop2D {
  vertices: Vec2[];
}

/** A 3D face extracted from the source model. */
export interface Face3D {
  /** Vertices of the outer boundary in world space. */
  vertices: Vec3[];
  /** Normal vector (unit length). */
  normal: Vec3;
  /** Inner loops (window/door openings). */
  innerLoops: Vec3[][];
}

/** A wall projected to its local 2D plane. */
export interface Wall {
  label: string;
  normal: Vec3;
  vertices3d: Vec3[];
  outer: Loop2D;
  openings: Loop2D[];
  /** Bounding-box width in metres. */
  width: number;
  /** Bounding-box height in metres. */
  height: number;
}

/** Options that travel through the full pipeline. */
export interface PipelineOptions {
  scaleDenom: number;     // 50 | 100
  paper: "A3" | "A1";
  formats: ("dxf" | "pdf")[];
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

export function scale(v: Vec3, s: number): Vec3 {
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

export function length(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

export function normalize(v: Vec3): Vec3 {
  const len = length(v);
  if (len < 1e-12) return { x: 0, y: 0, z: 0 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}
