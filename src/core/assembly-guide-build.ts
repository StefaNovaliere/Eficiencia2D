// ============================================================================
// Assembly guide — construcción en el FRONT desde la topología.
//
// El backend genera la guía sólo dentro del ZIP de /api/generate; no hay
// endpoint de preview (da 404). Acá armamos la misma estructura
// (`AssemblyPreviewData`) a partir de la topología que el front ya tiene
// (grupos + placements + faces), para previsualizar el instructivo sin depender
// del backend. La geometría 3D la resuelve el lift (placements → #2, o caras
// originales → #1) en `assembly-sequence.ts`.
// ============================================================================

import type { Phase1Result } from "./pipeline";
import type { GeometryGroup, FaceCategory } from "./group-classifier";
import type { Face3D, Vec3 } from "./types";
import { getEffectiveCategory } from "./discard-by-area";
import type {
  AssemblyPanel,
  AssemblyPreviewData,
  AssemblySequenceStep,
} from "@/services/api";

/**
 * Etiqueta estable de una pieza (grupo). La usan tanto este builder como el
 * `AssemblyLiftContext` para que el join etiqueta→grupo sea consistente.
 */
export function groupLabel(
  group: GeometryGroup,
  panelIdByGroup?: Record<number, string>,
): string {
  const fromBackend = panelIdByGroup?.[group.id];
  if (fromBackend && String(fromBackend).trim()) return String(fromBackend).trim();
  if (group.label && group.label.trim()) return group.label.trim();
  return `P${group.id}`;
}

export interface BuildAssemblyOptions {
  overrides?: Map<number, FaceCategory>;
  /**
   * Área de MATERIAL por id de grupo (`area_m2` del nesting). `group.totalArea`
   * suma las caras de la malla: en un sólido cuenta las dos pieles, y una losa
   * con cielorraso 21 cm más abajo sumaba las dos superficies. Eso hacía que dos
   * losas parecidas se mostraran con casi 10 m² de diferencia.
   */
  areaByGroupId?: Map<number, number>;
}

/** Bounding del grupo en el plano de la pieza (ancho horizontal × alto vertical). */
function groupSize(group: GeometryGroup, faces: Face3D[]): { width: number; height: number } {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const fi of group.faceIndices) {
    const f = faces[fi];
    if (!f) continue;
    for (const v of f.vertices) {
      minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
      minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
    }
  }
  if (!Number.isFinite(minX)) return { width: 0, height: 0 };
  const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
  // Alto = extensión vertical (Y); ancho = la mayor extensión horizontal.
  return { width: Math.max(dx, dz), height: dy };
}

/** Bucket de orientación de un muro según su normal horizontal dominante. */
function wallOrientation(normal: Vec3): { key: string; label: string } {
  if (Math.abs(normal.x) >= Math.abs(normal.z)) {
    return normal.x >= 0
      ? { key: "east", label: "Muros (Este)" }
      : { key: "west", label: "Muros (Oeste)" };
  }
  return normal.z >= 0
    ? { key: "north", label: "Muros (Norte)" }
    : { key: "south", label: "Muros (Sur)" };
}

/**
 * Construye la guía de armado desde la topología (sin llamar al backend).
 * `placement.widthM/heightM` se prefiere para las dimensiones; si no hay
 * placement, se calcula del bounding de las caras del grupo.
 */
export function buildAssemblyGuideFromTopology(
  phase1: Phase1Result,
  opts: BuildAssemblyOptions = {},
): AssemblyPreviewData {
  const { overrides, areaByGroupId } = opts;
  const placements = phase1.placements;

  const panels: AssemblyPanel[] = [];
  const floorIds: string[] = [];
  const wallBuckets = new Map<string, { label: string; ids: string[] }>();

  for (const group of phase1.groups) {
    const category = getEffectiveCategory(group, overrides);
    if (category === "discard") continue;

    const label = groupLabel(group, phase1.panelIdByGroup);
    const placement = placements?.[group.id];
    const size = placement
      ? { width: placement.widthM, height: placement.heightM }
      : groupSize(group, phase1.faces);

    panels.push({
      id: label,
      category,
      source_group_id: group.id,
      width_m: size.width,
      height_m: size.height,
      area_m2: areaByGroupId?.get(group.id) ?? group.totalArea,
      centroid: group.centroid,
      normal: group.representativeNormal,
      label,
    });

    if (category === "floor") {
      floorIds.push(label);
    } else {
      const bucket = wallOrientation(group.representativeNormal);
      const entry = wallBuckets.get(bucket.key) ?? { label: bucket.label, ids: [] };
      entry.ids.push(label);
      wallBuckets.set(bucket.key, entry);
    }
  }

  // Elevations (vista "Por cara" del panel lateral): pisos + muros por orientación.
  const elevations: AssemblyPreviewData["elevations"] = {};
  if (floorIds.length > 0) elevations["floor"] = { label: "Pisos", panel_ids: floorIds };
  for (const [key, bucket] of wallBuckets) {
    if (bucket.ids.length > 0) elevations[key] = { label: bucket.label, panel_ids: bucket.ids };
  }

  // Pasos: orden del backend (`assembly_steps`) si viene; si no, fallback front
  // (pisos primero, luego muros por orientación).
  const validLabels = new Set(panels.map((p) => p.id));
  const steps =
    stepsFromAssemblySteps(phase1, overrides, validLabels) ??
    stepsFromBuckets(floorIds, wallBuckets);

  const wallCount = panels.filter((p) => p.category === "wall").length;
  const floorCount = panels.filter((p) => p.category === "floor").length;

  return {
    panels,
    elevations,
    steps: steps.length > 0 ? steps : undefined,
    sequencePieces: undefined,
    viewerSchema: undefined,
    totals: {
      wall_count: wallCount,
      floor_count: floorCount,
      total_panels: panels.length,
    },
  };
}

function pieceStepTitle(category: FaceCategory, label: string, multiLevel: boolean, level: number): string {
  const kind = category === "floor" ? "Piso" : "Muro";
  return multiLevel ? `Nivel ${level} · ${kind} ${label}` : `${kind} ${label}`;
}

/**
 * Pasos a partir del orden del backend (`assembly_steps`): un paso por pieza,
 * en el orden dado (piso base → paredes → siguiente nivel). Devuelve null si no
 * hay `assembly_steps`.
 */
export function stepsFromAssemblySteps(
  phase1: Phase1Result,
  overrides: Map<number, FaceCategory> | undefined,
  validLabels: Set<string>,
  /** Área de material del nesting; sin ella se ordena por el área de la malla. */
  areaByGroupId?: Map<number, number>,
): AssemblySequenceStep[] | null {
  const entries = phase1.assemblySteps;
  if (!entries || entries.length === 0) return null;

  const groupById = new Map(phase1.groups.map((g) => [g.id, g]));
  const sorted = [...entries].sort((a, b) => a.step - b.step);
  const multiLevel = new Set(entries.map((e) => e.level)).size > 1;

  // Piezas elegibles en el orden de `assembly_steps` (piso base → paredes →
  // siguiente nivel). Se conserva ese orden como desempate del reordenamiento.
  const placed = new Set<string>();
  type Eligible = {
    groupId: number;
    level: number;
    category: FaceCategory;
    label: string;
    area: number;
  };
  const eligible: Eligible[] = [];
  for (const e of sorted) {
    const group = groupById.get(e.groupId);
    if (!group) continue;
    const category = getEffectiveCategory(group, overrides);
    if (category === "discard") continue;
    const label = groupLabel(group, phase1.panelIdByGroup);
    if (!validLabels.has(label) || placed.has(label)) continue;
    placed.add(label);
    eligible.push({
      groupId: group.id,
      level: e.level,
      category,
      label,
      area: areaByGroupId?.get(group.id) ?? group.totalArea,
    });
  }

  // Dentro del flujo abajo→arriba (por nivel, pisos primero), armar del
  // componente más grande al más chico: así cada pared aparece antes que sus
  // aberturas (piezas chicas). El sort es estable → ante empate se mantiene el
  // orden original de `assembly_steps`.
  const catRank = (c: FaceCategory) => (c === "floor" ? 0 : 1);
  eligible.sort(
    (a, b) =>
      a.level - b.level || catRank(a.category) - catRank(b.category) || b.area - a.area,
  );

  // Armado ENCADENADO: cada pared debe quedar en contacto con otra pared ya
  // colocada (no sólo compartir piso). Grafo de adyacencia SÓLO pared-pared, a
  // partir de los contactos que ya trae el backend (joints / wallWallJoints). Si
  // no hay datos de contacto, el grafo queda vacío ⇒ orden = area-desc (actual).
  const ordered = chainWallsByContact(eligible, phase1);

  const steps: AssemblySequenceStep[] = ordered.map((p) => ({
    title: pieceStepTitle(p.category, p.label, multiLevel, p.level),
    description: `Colocá la pieza ${p.label}.`,
    panel_ids: [p.label],
  }));

  // Si ningún paso del backend matcheó con las piezas visibles, no aplica
  // (evita reordenar por orden de panel). El caller cae a su fallback.
  if (placed.size === 0) return null;

  // Piezas no referenciadas por assembly_steps → un paso cada una al final.
  for (const label of validLabels) {
    if (placed.has(label)) continue;
    placed.add(label);
    steps.push({ title: `Pieza ${label}`, description: `Colocá la pieza ${label}.`, panel_ids: [label] });
  }

  return steps.length > 0 ? steps : null;
}

type ChainItem = {
  groupId: number;
  level: number;
  category: FaceCategory;
  area: number;
  label: string;
};

/**
 * Reordena las PAREDES para que el armado quede ENCADENADO: cada pared debe
 * quedar en contacto con otra pared ya colocada (no sólo compartir piso).
 * Conserva el flujo abajo→arriba (por nivel), los pisos primero, y el área como
 * prioridad (semilla y desempate). El grafo de adyacencia usa SÓLO contactos
 * pared-pared (`joints`/`wallWallJoints` del backend, excluyendo pisos). Si no
 * hay datos de contacto, devuelve `eligible` tal cual (= orden area-desc actual).
 */
function chainWallsByContact<T extends ChainItem>(eligible: T[], phase1: Phase1Result): T[] {
  const wallIds = new Set(
    eligible.filter((e) => e.category !== "floor").map((e) => e.groupId),
  );
  if (wallIds.size === 0) return eligible;

  const adj = new Map<number, Set<number>>();
  const ensure = (k: number): Set<number> => {
    let s = adj.get(k);
    if (!s) {
      s = new Set();
      adj.set(k, s);
    }
    return s;
  };
  const addEdge = (a: number, b: number) => {
    if (a === b || !wallIds.has(a) || !wallIds.has(b)) return;
    ensure(a).add(b);
    ensure(b).add(a);
  };
  for (const j of phase1.joints ?? []) addEdge(j.groupA, j.groupB);
  for (const j of phase1.wallWallJoints ?? []) addEdge(j.groupA, j.groupB);
  if (adj.size === 0) return eligible; // sin contactos pared-pared → orden actual

  // Niveles en orden ascendente (eligible ya viene ordenado por nivel).
  const levels: number[] = [];
  for (const e of eligible) if (!levels.includes(e.level)) levels.push(e.level);

  // `placedGroups` es GLOBAL: una pared de un nivel puede encadenarse con una
  // pared de un nivel inferior ya colocada.
  const placedGroups = new Set<number>();
  const out: T[] = [];
  for (const lvl of levels) {
    const inLvl = eligible.filter((e) => e.level === lvl);
    // Pisos primero (en su orden area-desc), como base del nivel.
    for (const f of inLvl.filter((e) => e.category === "floor")) {
      out.push(f);
      placedGroups.add(f.groupId);
    }
    // Paredes: greedy encadenado — la mayor de las que tocan lo ya colocado; si
    // ninguna toca, se siembra con la mayor restante (`remaining` es area-desc).
    const remaining = inLvl.filter((e) => e.category !== "floor");
    while (remaining.length > 0) {
      let idx = remaining.findIndex((w) => {
        const nb = adj.get(w.groupId);
        if (!nb) return false;
        for (const other of nb) if (placedGroups.has(other)) return true;
        return false;
      });
      if (idx === -1) idx = 0;
      const [w] = remaining.splice(idx, 1);
      out.push(w);
      placedGroups.add(w.groupId);
    }
  }
  return out;
}

/** Fallback front: pisos primero, luego muros agrupados por orientación. */
function stepsFromBuckets(
  floorIds: string[],
  wallBuckets: Map<string, { label: string; ids: string[] }>,
): AssemblySequenceStep[] {
  const steps: AssemblySequenceStep[] = [];
  if (floorIds.length > 0) {
    steps.push({
      title: "Base / Pisos",
      description: "Colocá las piezas de piso como base del armado.",
      panel_ids: floorIds,
    });
  }
  for (const bucket of wallBuckets.values()) {
    if (bucket.ids.length === 0) continue;
    steps.push({
      title: bucket.label,
      description: `Levantá ${bucket.ids.length} ${bucket.ids.length === 1 ? "muro" : "muros"} de esta cara.`,
      panel_ids: bucket.ids,
    });
  }
  return steps;
}
