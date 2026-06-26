// ============================================================================
// Topology types (thin client)
//
// El backend es dueño de TODA la geometría (parseo → topología → clasificación
// → juntas → encastres 3D → proyección 2D → nesting → DXF/PDF). El frontend es
// un cliente delgado: este módulo sólo conserva las INTERFACES que la UI y el
// visor 3D necesitan para renderizar los datos provistos por el backend y para
// recolectar las decisiones del usuario. No hay cálculo geométrico acá.
// ============================================================================

import type { Face3D, Vec3 } from "./types";
import type { GeometryGroup } from "./group-classifier";
import type { Joint } from "./joint-detector";
import type { DimensionAdjustment, WallWallJoint } from "./assembly-adjuster";
import type { NestingResult, SheetConfig } from "./sheet-nester";

/**
 * Pose 3D de una pieza (grupo) provista por el backend en `topology.placements`.
 * Marco ortonormal en el MISMO espacio 3D que `faces` (eje Y). Permite "liftear"
 * el contorno 2D de corte de la pieza a su pose real:
 *   `world = origin + u_local·uAxis + v·vAxis`  (con `u_local = widthM − u` si `mirrored`).
 * El backend cameliza `u_axis→uAxis`, `v_axis→vAxis`, `width_m→widthM`, etc.
 */
export interface Placement {
  origin: Vec3;
  uAxis: Vec3;
  vAxis: Vec3;
  normal: Vec3;
  /** Ancho del panel en su marco local, en metros reales (sin escalar). */
  widthM: number;
  /** Alto del panel en su marco local, en metros reales (sin escalar). */
  heightM: number;
  /** Si true, el contorno de corte viene espejado horizontalmente. */
  mirrored: boolean;
}

/**
 * Paso de armado provisto por el backend (`topology.assembly_steps`). Define el
 * ORDEN de revelación del instructivo (piso base → paredes N→E→S→O → siguiente
 * nivel → …). El backend cameliza `group_id → groupId`.
 */
export interface AssemblyStep {
  step: number;
  groupId: number;
  label: string;
  /** Índice del nivel/piso al que pertenece la pieza (0 = base). */
  level: number;
}

/**
 * Topología que devuelve el backend (`/api/upload` y `/api/recompute`). El
 * front la renderiza tal cual; no la recalcula.
 */
export interface Phase1Result {
  faces: Face3D[];
  rawFaces: Face3D[];
  appliedAxis: "Y" | "Z";
  groups: GeometryGroup[];
  joints: Joint[];
  adjustments: DimensionAdjustment[];
  wallWallJoints: WallWallJoint[];
  stem: string;
  warnings: string[];
  preSplitFaceCount: number;
  suggestedMerges: number[][];
  /**
   * Etiquetas de panel (A1, B2, …) por id de grupo, calculadas por el backend
   * para que coincidan con el plano de corte. Opcional: si no viene, la UI
   * simplemente no muestra las etiquetas.
   */
  panelIdByGroup?: Record<number, string>;
  /**
   * Pose 3D por id de grupo (no descartado) para el instructivo de armado.
   * Opcional: si el backend no la manda, el instructivo cae al render de cajas.
   */
  placements?: Record<number, Placement>;
  /**
   * Orden de armado del instructivo (piso base → paredes → siguiente nivel).
   * Opcional: si no viene, el front sintetiza un orden por orientación.
   */
  assemblySteps?: AssemblyStep[];
}

export interface ClassificationOverride {
  groupId: number;
  newCategory: GeometryGroup["category"];
}

/**
 * Una división de grupo decidida por el usuario en Revisión. Se acumula y se
 * envía al backend (recompute / generate); el backend la replica.
 */
export interface SplitOp {
  groupId: number;
  mode: "components" | "panels";
}

/**
 * Vista previa de nesting que devuelve el backend (`/api/nesting-preview`).
 * Son datos 2D listos para dibujar; el front no corre el algoritmo de nesting.
 */
export interface NestingPreviewData {
  wallNesting: NestingResult;
  floorNesting: NestingResult;
  config: SheetConfig;
}
