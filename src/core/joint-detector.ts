// ============================================================================
// Joint types (thin client)
//
// La detección de juntas vive en el backend. Acá sólo queda el tipo `Joint`
// que viaja dentro de `Phase1Result` y que la UI usa para referenciar uniones.
// ============================================================================

import type { Vec3 } from "./types";

export interface Joint {
  groupA: number;
  groupB: number;
  totalLength: number;
  dihedralAngle: number;
  edgeMid: Vec3;
  edgeDir: Vec3;
  /** Fraction of shared edge length that is approximately horizontal (|dir.y|/|dir| ≤ 0.3). */
  horizontalFrac: number;
}
