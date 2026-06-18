// ============================================================================
// Topology types (thin client)
//
// El backend es dueño de TODA la geometría (parseo → topología → clasificación
// → juntas → encastres 3D → proyección 2D → nesting → DXF/PDF). El frontend es
// un cliente delgado: este módulo sólo conserva las INTERFACES que la UI y el
// visor 3D necesitan para renderizar los datos provistos por el backend y para
// recolectar las decisiones del usuario. No hay cálculo geométrico acá.
// ============================================================================

import type { Face3D } from "./types";
import type { GeometryGroup } from "./group-classifier";
import type { Joint } from "./joint-detector";
import type { DimensionAdjustment, WallWallJoint } from "./assembly-adjuster";
import type { NestingResult, SheetConfig } from "./sheet-nester";

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
