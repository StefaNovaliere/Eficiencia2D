// ============================================================================
// Piezas finales del instructivo — lo que realmente se va a cortar.
//
// El instructivo se dibujaba con la proyección del modelo 3D SIN recortar, así
// que mostraba piezas superponiéndose donde el encastre ya las había resuelto,
// y no reflejaba recortes ni descartes. No era la maqueta que se arma.
//
// `final_pieces` (de `/api/nesting-preview`) trae el contorno FINAL de cada
// pieza con su marco 3D, así que el front sólo tiene que dibujar:
//
//     world = origin + u·uDir + v·vDir
//
// Sin espejar ni compensar nada: `uDir` ya apunta en el sentido correcto y el
// origen ya tiene los recortes aplicados.
//
// Este módulo sólo PARSEA y valida. La respuesta pasa por un camelizado
// genérico antes de llegar acá, pero se aceptan las dos convenciones de nombre
// para no depender de ese paso. Todo lo que no valide se descarta: una pieza con
// coordenadas inválidas metería NaN en la escena y se lleva puesto todo el
// render de Three.
// ============================================================================

import type { Vec2, Vec3 } from "./types";

/** Arista del contorno final, en metros de edificio y coordenadas locales (u, v). */
export interface FinalPieceEdge {
  a: Vec2;
  b: Vec2;
  /** Abertura (ventana/puerta): se dibuja como hueco. */
  hole?: boolean;
  /** Ranura de encastre. */
  joint?: boolean;
}

/** Una pieza tal como se va a cortar, con su pose en el edificio. */
export interface FinalPiece {
  /** Misma etiqueta que en la plancha de corte (A1, B2…). */
  id: string;
  groupId: number;
  category: string;
  widthM: number;
  heightM: number;
  origin: Vec3;
  uDir: Vec3;
  vDir: Vec3;
  normal: Vec3;
  edges: FinalPieceEdge[];
}

/**
 * Marco de una pieza YA RECORTADA por el ensamble, tal como lo devuelve
 * `/nesting-preview`. Misma forma que `topology.placements` (que sigue siendo el
 * modelo crudo, correcto para el visor donde se clasifica), más el id de panel y
 * el área de material.
 *
 * `width_m`/`height_m` vienen recortados: sobre el modelo de prueba, 20 de 28
 * piezas miden menos acá que en la topología cruda. Dibujar la topología es lo
 * que hacía que los muros se pisaran y las losas parecieran apoyadas encima.
 */
export interface NestingPlacement {
  /** Mismo id que en la plancha de corte. */
  panelId: string;
  origin: Vec3;
  uAxis: Vec3;
  vAxis: Vec3;
  normal: Vec3;
  widthM: number;
  heightM: number;
  /**
   * Se lee y se conserva, pero el instructivo NO lo aplica: el espejado del
   * contorno de corte ya viene horneado en el marco (origen corrido al otro
   * extremo y `u_axis` invertido), y la fórmula del contrato no tiene término de
   * espejo. El contrato dice que llega en `false`, pero su ejemplo JSON muestra
   * `true`, así que no se depende del valor.
   */
  mirrored: boolean;
  /**
   * Área de MATERIAL: contorno menos aberturas. `group.totalArea` suma las caras
   * de la malla, así que en un sólido cuenta las dos pieles y una losa con
   * cielorraso aparecía con casi 10 m² de más.
   */
  areaM2: number;
}

/**
 * Parsea el mapa `placements` de `/nesting-preview` (clave = group_id como
 * string). Descarta entradas sin marco usable, igual que las piezas finales.
 */
export function parseNestingPlacements(raw: unknown): Map<number, NestingPlacement> {
  const out = new Map<number, NestingPlacement>();
  const root = rec(raw);
  if (!root) return out;

  for (const [key, value] of Object.entries(root)) {
    const groupId = finite(key);
    const o = rec(value);
    if (groupId === null || !o) continue;

    const origin = parseVec3(o.origin);
    const uAxis = parseVec3(pick(o, "uAxis", "u_axis"));
    const vAxis = parseVec3(pick(o, "vAxis", "v_axis"));
    if (!origin || !uAxis || !vAxis) continue;

    out.set(groupId, {
      panelId: String(pick(o, "panelId", "panel_id") ?? "").trim(),
      origin,
      uAxis,
      vAxis,
      normal: parseVec3(o.normal) ?? { x: 0, y: 1, z: 0 },
      widthM: finite(pick(o, "widthM", "width_m")) ?? 0,
      heightM: finite(pick(o, "heightM", "height_m")) ?? 0,
      mirrored: o.mirrored === true,
      areaM2: finite(pick(o, "areaM2", "area_m2")) ?? 0,
    });
  }
  return out;
}

/** Tipos de aviso que emite el chequeo de ensamble del backend. */
export type AssemblyWarningType =
  | "gap"
  | "overlap"
  | "unsupported"
  | "interpenetra"
  | "interference";

export interface AssemblyWarning {
  /** Piezas involucradas (mismos ids que `FinalPiece.id`). */
  pieces: string[];
  type: AssemblyWarningType | string;
  /** Magnitud del hueco/solape/material compartido. */
  measureMm: number;
  /** Punto 3D del problema, para enfocar la cámara y marcarlo. */
  at?: Vec3;
  /** Umbral que usó el backend (se muestra al usuario). */
  toleranceMm?: number;
  /** Por qué pasa (p. ej. "escala"), cuando el backend lo sabe. */
  cause?: string;
  /** Explicación en prosa del backend; se muestra tal cual. */
  message?: string;
}

function rec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** Primera clave presente, para aceptar `u_dir` y `uDir` por igual. */
function pick(o: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (o[k] !== undefined) return o[k];
  }
  return undefined;
}

/**
 * Número usable, o `null`. Chequea el tipo antes de convertir: `Number(null)`,
 * `Number("")` y `Number([])` dan 0, así que confiar en `Number()` a secas
 * convertiría una coordenada faltante en un 0 válido y ubicaría la pieza en el
 * lugar equivocado en vez de descartarla.
 */
function finite(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function parseVec3(v: unknown): Vec3 | null {
  // El contrato usa objeto para las poses (`origin`, `u_dir`) y array para el
  // punto de un aviso (`at`).
  if (Array.isArray(v) && v.length >= 3) {
    const [x, y, z] = [finite(v[0]), finite(v[1]), finite(v[2])];
    return x !== null && y !== null && z !== null ? { x, y, z } : null;
  }
  const o = rec(v);
  if (!o) return null;
  const x = finite(o.x);
  const y = finite(o.y);
  const z = finite(o.z);
  return x !== null && y !== null && z !== null ? { x, y, z } : null;
}

function parseVec2(v: unknown): Vec2 | null {
  const o = rec(v);
  if (!o) return null;
  const x = finite(o.x);
  const y = finite(o.y);
  return x !== null && y !== null ? { x, y } : null;
}

function parseEdges(v: unknown): FinalPieceEdge[] {
  if (!Array.isArray(v)) return [];
  const out: FinalPieceEdge[] = [];
  for (const raw of v) {
    const o = rec(raw);
    if (!o) continue;
    const a = parseVec2(o.a);
    const b = parseVec2(o.b);
    if (!a || !b) continue;
    out.push({ a, b, hole: o.hole === true, joint: o.joint === true });
  }
  return out;
}

/**
 * Parsea `final_pieces`. Descarta las piezas que no tengan marco e id usables:
 * sin marco no hay dónde dibujarlas, y una pieza a medias es peor que ninguna.
 */
export function parseFinalPieces(raw: unknown): FinalPiece[] {
  if (!Array.isArray(raw)) return [];

  const out: FinalPiece[] = [];
  for (const item of raw) {
    const o = rec(item);
    if (!o) continue;

    const id = String(pick(o, "id") ?? "").trim();
    const origin = parseVec3(o.origin);
    const uDir = parseVec3(pick(o, "uDir", "u_dir"));
    const vDir = parseVec3(pick(o, "vDir", "v_dir"));
    if (!id || !origin || !uDir || !vDir) continue;

    const edges = parseEdges(o.edges);
    if (edges.length === 0) continue; // sin contorno no hay pieza que dibujar

    out.push({
      id,
      groupId: finite(pick(o, "groupId", "group_id")) ?? -1,
      category: String(pick(o, "category") ?? "wall"),
      widthM: finite(pick(o, "widthM", "width_m")) ?? 0,
      heightM: finite(pick(o, "heightM", "height_m")) ?? 0,
      origin,
      uDir,
      vDir,
      normal: parseVec3(o.normal) ?? { x: 0, y: 1, z: 0 },
      edges,
    });
  }
  return out;
}

/**
 * Parsea `assembly_warnings`. NO filtra por tipo conocido: un tipo nuevo del
 * backend (como `interpenetra`) tiene que llegar a la UI igual, aunque este
 * front no lo sepa nombrar todavía. Filtrar por lista blanca es justamente lo
 * que haría desaparecer avisos en silencio.
 */
export function parseAssemblyWarnings(raw: unknown): AssemblyWarning[] {
  if (!Array.isArray(raw)) return [];

  const out: AssemblyWarning[] = [];
  for (const item of raw) {
    const o = rec(item);
    if (!o) continue;

    const type = String(pick(o, "type") ?? "").trim();
    if (!type) continue;

    const pieces = Array.isArray(o.pieces)
      ? o.pieces.map((p) => String(p).trim()).filter(Boolean)
      : [];

    const at = parseVec3(o.at);
    const tolerance = finite(pick(o, "toleranceMm", "tolerance_mm"));
    const cause = String(pick(o, "cause") ?? "").trim();
    const message = String(pick(o, "message") ?? "").trim();

    out.push({
      pieces,
      type,
      measureMm: finite(pick(o, "measureMm", "measure_mm")) ?? 0,
      ...(at ? { at } : {}),
      ...(tolerance !== null ? { toleranceMm: tolerance } : {}),
      ...(cause ? { cause } : {}),
      ...(message ? { message } : {}),
    });
  }
  return out;
}

/** Texto para el usuario. Un tipo desconocido se muestra crudo, no se oculta. */
export function warningTypeLabel(type: string): string {
  switch (type) {
    case "gap":
      return "Hueco";
    case "overlap":
      return "Se solapan";
    case "unsupported":
      return "Sin apoyo";
    case "interpenetra":
    case "interference":
      return "Se atraviesan";
    default:
      return type;
  }
}

/**
 * Magnitud en la unidad que se lee mejor. El backend manda todo en mm, y un
 * `interpenetra` a lo largo de una pared entera da 6700 mm: "670 cm" es
 * correcto pero ilegible para quien piensa en metros.
 */
export function formatWarningMeasure(mm: number): string {
  if (!Number.isFinite(mm) || mm <= 0) return "—";
  // Las interferencias vienen como cota inferior de la penetración: mostrar
  // "0,3 mm" a secas invitaría a leerlo como "es apenas 0,3", y puede ser más.
  if (mm >= 1000) return `${(mm / 1000).toFixed(2).replace(".", ",")} m`;
  if (mm >= 10) return `${(mm / 10).toFixed(1).replace(".", ",")} cm`;
  return `${mm.toFixed(1).replace(".", ",")} mm`;
}

/** Más material compartido / hueco más grande = más urgente. */
export function sortWarningsBySeverity(warnings: AssemblyWarning[]): AssemblyWarning[] {
  return [...warnings].sort((a, b) => b.measureMm - a.measureMm);
}
