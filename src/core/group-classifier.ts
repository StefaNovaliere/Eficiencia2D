// ============================================================================
// Group types (thin client)
//
// La clasificación/agrupado real vive en el backend. Acá sólo quedan los tipos
// que consumen el visor 3D y la UI de Revisión.
// ============================================================================

import type { Vec3 } from "./types";

export type FaceCategory =
  | "floor"
  | "wall"
  | "discard";

export interface GeometryGroup {
  id: number;
  label: string;
  category: FaceCategory;
  faceIndices: number[];
  totalArea: number;
  centroid: Vec3;
  orientation: string;
  representativeNormal: Vec3;
  thickness?: number;
  minY?: number;
  maxY?: number;
  /** Category before the small-area demotion step. Lets consumers tell a
   *  demoted floor slab apart from a horizontal piece that was never a floor. */
  originalCategory?: FaceCategory;
}
