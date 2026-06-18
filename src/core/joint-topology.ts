// ============================================================================
// Joint topology types (thin client)
//
// La clasificación geométrica de la junta (L/T/X) vive en el backend. Acá sólo
// queda el tipo, que viaja dentro de `WallWallJoint`.
// ============================================================================

export type JointTopology = "L" | "T" | "X" | "unknown";
