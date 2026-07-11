/**
 * Marcas de APOYO (rojas): dónde se apoya/pega un piso o estante sobre la cara
 * interior de una pared. Es el "mapa" de armado grabado en rojo.
 *
 * La geometría ya existe: el backend expone `PlateJoint {a,b,width}` (segmento de
 * intersección placa↔placa en coords de mundo) en `/api/nesting-preview`. Cuando
 * una junta es de APOYO PEGADO (no una ranura física), en vez de dibujarla como
 * encastre la mostramos como footprint ROJO sobre la placa receptora — el mismo
 * rectángulo que `buildSlots`, en rojo. El backend la graba en la capa MARK_VECTOR
 * (ver CONTRATO_marcas_apoyo_backend.md); acá es preview no autoritativo.
 */

import type { PlateJoint } from "@/core/pipeline";
import type { Vec3 } from "@/core/types";
import { buildSlots } from "@/core/assembly-lift";

/**
 * Footprint (triángulos, coords de mundo) de las juntas de apoyo de un grupo,
 * para pintar en rojo sobre la cara. Reusa `buildSlots` (rectángulo desde a→b
 * engrosado por `width`).
 *
 * - `surfaceOnly` (default true): si el backend ya marcó `kind`, sólo toma las
 *   `surface` (apoyo pegado), no las `slot` (ranura física, que ya se dibuja como
 *   encastre). Si ninguna junta trae `kind`, cae a mostrarlas todas (preview).
 */
export function computeSupportMarks3D(
  joints: PlateJoint[],
  normal: Vec3,
  opts?: { surfaceOnly?: boolean },
): number[] {
  if (joints.length === 0) return [];
  const surfaceOnly = opts?.surfaceOnly ?? true;
  const anyFlagged = joints.some((j) => j.kind === "slot" || j.kind === "surface");
  const chosen =
    surfaceOnly && anyFlagged ? joints.filter((j) => j.kind === "surface") : joints;
  if (chosen.length === 0) return [];
  return buildSlots(chosen, normal);
}
