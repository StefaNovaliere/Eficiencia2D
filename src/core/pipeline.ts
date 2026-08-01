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
import type {
  AssemblyWarning,
  FinalPiece,
  NestingPlacement,
} from "./final-pieces";

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
  /** Etiqueta de la pieza (A1, B2…), cuando el backend la incluye. */
  panelId?: string;
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
   * `true` → `placements` son las piezas YA RECORTADAS, y coinciden pieza por
   * pieza con lo que sale en el DXF. `false` (o ausente) → es la proyección
   * cruda del modelo: sirve para mirar, NO para decidir si algo encaja.
   *
   * Depende de que `/recompute` reciba `scale_denom`: los recortes de encaje
   * valen 3 mm de MDF siempre, y eso son 6 cm de edificio a 1:20 y 60 cm a
   * 1:200. `/upload` no tiene escala, así que ahí siempre viene en `false`.
   */
  placementsFieles?: boolean;
  /**
   * Espesor de la placa en metros de EDIFICIO (ya multiplicado por la escala).
   * Sólo llega cuando `placementsFieles` es true. Dibujar las piezas sin espesor
   * esconde justamente los choques que el espesor provoca: dos placas de 3 mm
   * que se cruzan ocupan el mismo material aunque sus planos medios no se toquen.
   */
  plateThicknessM?: number;
  /**
   * Orden de armado del instructivo (piso base → paredes → siguiente nivel).
   * Opcional: si no viene, el front sintetiza un orden por orientación.
   */
  assemblySteps?: AssemblyStep[];
  /**
   * Curvatura detectada por el backend, por id de grupo curvo (los planos no
   * figuran). El front la usa para sugerir método/spacing de flexión. Opcional.
   */
  curvature?: Record<number, GroupCurvature>;
}

/** Metadata de curvatura de un grupo (para kerf/auxético). */
export interface GroupCurvature {
  curved: boolean;
  /** Curvatura simple (desarrollable → kerf) o doble (→ auxético). */
  kind: "single" | "double";
  bendRadiusM?: number;
  principalDir?: Vec3;
  normalSpreadDeg?: number;
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
 * Encastre (ranura) entre dos placas, en coordenadas de mundo (mismo espacio
 * que `faces`). Lo expone el backend en `/api/nesting-preview` para el overlay
 * de ranuras del instructivo. El backend cameliza `cut_id→cutId`, etc.
 */
export interface PlateJoint {
  /** Grupo que RECIBE la ranura (la pieza que se revela). */
  cutId: number;
  /** Grupo de la placa que corta. */
  cutterId: number;
  a: Vec3;
  b: Vec3;
  /** Ancho de la ranura (grosor de la placa cortante), en metros. */
  width: number;
  /** Tipo de junta: `slot` = encastre físico (ranura); `surface` = apoyo pegado
   *  (se graba como marca roja, no se corta). Opcional: si el backend no lo manda,
   *  el front trata todas como preview de apoyo. Ver CONTRATO_marcas_apoyo_backend.md. */
  kind?: "slot" | "surface";
}

/**
 * Vista previa de nesting que devuelve el backend (`/api/nesting-preview`).
 * Son datos 2D listos para dibujar; el front no corre el algoritmo de nesting.
 */
export interface NestingPreviewData {
  wallNesting: NestingResult;
  floorNesting: NestingResult;
  config: SheetConfig;
  /** Encastres en 3D (world coords) para el overlay del instructivo. */
  plateJoints?: PlateJoint[];
  /**
   * Piezas tal como se van a cortar, con su pose en el edificio. Es la fuente
   * del instructivo: `placements` es la proyección del modelo SIN recortar, así
   * que mostraba piezas pisándose donde el encastre ya las había resuelto.
   * Opcional: si el backend no las manda, el instructivo cae al camino viejo.
   */
  finalPieces?: FinalPiece[];
  /** Choques y huecos que detectó el backend al armar la maqueta virtualmente. */
  assemblyWarnings?: AssemblyWarning[];
  /**
   * Marcos YA RECORTADOS por el ensamble, por id de grupo. Misma forma que
   * `topology.placements`, que NO se toca: ése sigue siendo el modelo crudo, que
   * es lo correcto para el visor donde se clasifica y descarta.
   * Dependen de la escala (el recorte tiene un término físico de MDF), así que
   * llegan con cada respuesta del nesting y se actualizan solos.
   */
  nestingPlacements?: Map<number, NestingPlacement>;
}
