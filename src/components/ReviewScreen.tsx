"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from "react-resizable-panels";
import GroupList from "./GroupList";
import MeasureList from "./MeasureList";
import InspectorSection from "./InspectorSection";
import ReviewTour from "./tour/ReviewTour";
import MeasureScaleSelect from "./MeasureScaleSelect";
import CameraNavigationSelect from "./CameraNavigationSelect";
import VisibilityFilters from "./VisibilityFilters";
import StepIndicator from "./StepIndicator";
import type { FaceCategory, GeometryGroup } from "@/core/group-classifier";
import {
  collectSimilarGroups,
  findGroupsWithSameArea,
  getEffectiveCategory,
} from "@/core/discard-by-area";
import type { Phase1Result, ClassificationOverride } from "@/core/pipeline";
import type { WallWallJoint } from "@/core/assembly-adjuster";
import type { LeaderMarker, GroupNoteMarker } from "./ModelViewer";
import {
  RefreshCw,
  Box,
  Maximize,
  Crosshair,
  EyeOff,
  Eye,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Link2,
  SlidersHorizontal,
  ScanSearch,
  ArrowRight,
  X,
  Copy,
  SquareSplitHorizontal,
  ArrowLeft as ArrowBackIcon,
  MousePointer2,
  Lasso,
  Trash2,
  PenLine,
  Spline,
  Lightbulb,
  Wrench,
  Scissors,
  Footprints,
  Circle,
  Minus,
  RectangleHorizontal,
  Magnet,
  Ruler,
  BookOpen,
  StickyNote,
} from "lucide-react";
import { useReviewHistory } from "@/hooks/useReviewHistory";
import type { ModelViewerHandle, CameraCommand, SectionState } from "@/components/ModelViewer";
import CutToolOverlay from "@/components/CutToolOverlay";
import MeasureToolOverlay from "@/components/MeasureToolOverlay";
import AngleMeasureOverlay from "@/components/AngleMeasureOverlay";
import MarkLineToolOverlay, { type MarkLineMode } from "@/components/MarkLineToolOverlay";
import type { AngleDraftState, UserAngleMeasure } from "@/core/angle-measure";
import type { MarkLine } from "@/core/mark-lines";
import {
  createRibId,
  createColumnId,
  removeRib,
  removeColumn,
  resolveRibSizeM,
  DEFAULT_RIB_T,
  DEFAULT_COLUMN_SIZE_M,
  type Rib,
} from "@/core/reinforcements";
import { jointsToPlateJoints } from "@/core/reinforcements-preview";
import RibSnapperOverlay from "@/components/RibSnapperOverlay";
import ToolMenu from "@/components/toolbar/ToolMenu";
import BottomToolbar, { ActiveToolBadge } from "@/components/toolbar/BottomToolbar";
import { useUIStore } from "@/stores/uiStore";
import { useRegisterFlowNav } from "@/hooks/useRegisterFlowNav";
import FlexControls from "@/components/FlexControls";
import { maxNormalSpreadDeg } from "@/core/flex-bending";
import type {
  CutDragState,
  UserCut,
  ActiveCutShapeKind,
} from "@/core/user-cuts";
import { cutDimensionsLabel } from "@/core/user-cuts";
import type { GroupNote } from "@/core/group-notes";
import {
  noteCountByCutId,
  noteCountByGroupId,
  removeNotesForCut,
  removeNotesForCuts,
} from "@/core/group-notes";
import GroupNotesPanel from "@/components/GroupNotesPanel";
import {
  buildDisplayGroupsFromCuts,
  cutGroupOwnerId,
  userCutForDerivedExtract,
} from "@/core/cut-derived-groups";
import type {
  MeasureDragState,
  MeasureShapeKind,
  UserMeasure,
} from "@/core/measure-tool";
import {
  MEASURE_SCALE_ORIGINAL,
  isOriginalMeasureScale,
} from "@/core/print-scale";
import { useProjectContext } from "@/context/ProjectContext";

export type WallWallDecisions = Map<number, number>;

const ModelViewer = dynamic(() => import("./ModelViewer"), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-base-content/60">
      <span className="loading loading-spinner loading-lg text-primary" />
      <p className="text-sm font-medium">Cargando vista 3D…</p>
    </div>
  ),
});

const AssemblyWindow = dynamic(() => import("./AssemblyWindow"), {
  ssr: false,
});

const ALL_CATEGORIES: FaceCategory[] = ["floor", "wall", "discard"];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ReviewScreenProps {
  /** Topología provista por el backend; ya refleja eje/área/merges/splits. */
  phase1: Phase1Result;
  /** Fusiones activas (clusters de ids originales), controladas por el padre. */
  merges: number[][];
  onConfirm: (
    overrides: ClassificationOverride[],
    wallWallDecisions: WallWallDecisions,
    marks: number[],
    userCuts: UserCut[],
    notes: GroupNote[],
  ) => void;
  /** Vuelve al home; recibe el snapshot actual para guardar cambios pendientes. */
  onCancel: (snapshot: {
    overrides: ClassificationOverride[];
    wallWallDecisions: WallWallDecisions;
    marks: number[];
    userCuts: UserCut[];
    notes: GroupNote[];
    markLines: import("@/core/mark-lines").MarkLine[];
  }) => void | Promise<void>;
  /** Alterna el eje vertical (Y/Z) vía recompute en el backend. */
  onRotateAxis: () => void;
  /** Agrega una fusión y dispara recompute. */
  onAddMerge: (cluster: number[]) => void;
  /** Quita la fusión en el índice dado y dispara recompute. */
  onRemoveMerge: (index: number) => void;
  /** Reemplaza la lista completa de fusiones (p. ej. desfusionar un miembro). */
  onReplaceMerges: (merges: number[][]) => void;
  /** Registra una división de grupo y dispara recompute. */
  onAddSplit: (groupId: number, mode: "components" | "panels") => void;
  minAreaM2: number;
  onMinAreaChange: (area: number) => void;
  pinTools: boolean;
  onPinToolsChange: (pin: boolean) => void;
  initialOverrides?: ClassificationOverride[];
  initialWallWallDecisions?: WallWallDecisions;
  initialMarks?: number[];
  initialUserCuts?: UserCut[];
  initialNotes?: GroupNote[];
  /** El backend está recalculando la topología (deshabilita controles). */
  isRecomputing?: boolean;
  isGenerating?: boolean;
  /** Guardando cambios pendientes al pulsar Volver. */
  isSavingOnExit?: boolean;
  /** Escala de impresión del proyecto (1:N), compartida con nesting/PDF. */
  onPrintScaleChange: (scale: number) => void;
  /** Cambios de clasificación, uniones, marcas, cortes y líneas rojas para autosave. */
  onEditingStateChange?: (snapshot: {
    overrides: ClassificationOverride[];
    wallWallDecisions: WallWallDecisions;
    marks: number[];
    userCuts: UserCut[];
    notes: GroupNote[];
    markLines: import("@/core/mark-lines").MarkLine[];
  }) => void;
  /** Fetches assembly guide using the current in-memory review state (not saved session). */
  onRequestAssemblyPreview?: (
    request: import("@/services/api").AssemblyPreviewRequest,
  ) => Promise<import("@/services/api").AssemblyPreviewData>;
  /** Abre la ventana del instructivo al montar (p. ej. desde la pantalla de descarga). */
  openAssemblyInstructivo?: boolean;
}

const MIN_AREA_OPTIONS = [0, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1.0];

function formatMinAreaOption(areaM2: number): string {
  if (areaM2 === 0) return "Ninguno";
  const n =
    areaM2 >= 1
      ? String(areaM2)
      : areaM2.toLocaleString("es-AR", {
          maximumSignificantDigits: 3,
        });
  return `${n} m²`;
}

const CUT_SHAPE_ORDER: ActiveCutShapeKind[] = ["rect", "circle", "line"];

const CUT_SHAPE_LABELS: Record<ActiveCutShapeKind, string> = {
  rect: "Rectángulo",
  circle: "Óvalo / círculo",
  line: "Línea",
};

function nextCutShape(current: ActiveCutShapeKind): ActiveCutShapeKind {
  const i = CUT_SHAPE_ORDER.indexOf(current);
  return CUT_SHAPE_ORDER[(i + 1) % CUT_SHAPE_ORDER.length];
}

const MEASURE_SHAPE_ORDER: MeasureShapeKind[] = ["line", "rect"];
function nextMeasureShape(current: MeasureShapeKind): MeasureShapeKind {
  const i = MEASURE_SHAPE_ORDER.indexOf(current);
  return MEASURE_SHAPE_ORDER[(i + 1) % MEASURE_SHAPE_ORDER.length];
}

const MARK_LINE_MODE_ORDER: MarkLineMode[] = ["straight", "freehand", "rect", "circle"];
function nextMarkLineMode(current: MarkLineMode): MarkLineMode {
  const i = MARK_LINE_MODE_ORDER.indexOf(current);
  return MARK_LINE_MODE_ORDER[(i + 1) % MARK_LINE_MODE_ORDER.length];
}

const MEASURE_SHAPE_LABELS: Record<MeasureShapeKind, string> = {
  line: "Distancia",
  rect: "Área",
};

/** Cluster de fusión que contiene un id (incl. cuando solo queda el superviviente en groups). */
function findMergeClusterForGroupId(
  groupId: number,
  merges: number[][],
  groups: GeometryGroup[],
): number[] | null {
  const direct = merges.find((cluster) => cluster.includes(groupId));
  if (direct) return direct;
  for (const cluster of merges) {
    if (cluster.length < 2) continue;
    const present = cluster.filter((id) => groups.some((g) => g.id === id));
    if (present.length === 1 && present[0] === groupId) return cluster;
  }
  return null;
}

function findMergeSurvivorId(
  cluster: number[],
  groups: GeometryGroup[],
): number | null {
  const present = groups.filter((g) => cluster.includes(g.id));
  if (present.length === 0) return null;
  return present.reduce((best, g) => (g.totalArea > best.totalArea ? g : best))
    .id;
}

function findMergeClusterIndex(
  cluster: number[] | null,
  merges: number[][],
): number {
  if (!cluster) return -1;
  return merges.findIndex(
    (c) => c.length === cluster.length && c.every((id) => cluster.includes(id)),
  );
}

function areGroupsCoplanar(a: GeometryGroup, b: GeometryGroup): boolean {
  const na = a.representativeNormal;
  const nb = b.representativeNormal;
  const dot = na.x * nb.x + na.y * nb.y + na.z * nb.z;
  if (Math.abs(Math.abs(dot) - 1) > 0.02) return false;
  const ca = a.centroid;
  const cb = b.centroid;
  const planeDist =
    (cb.x - ca.x) * na.x + (cb.y - ca.y) * na.y + (cb.z - ca.z) * na.z;
  return Math.abs(planeDist) < 0.02;
}

/**
 * Paredes que realmente forman la fusión coplanar. Excluye paredes aledañas que
 * solo cruzan la fusión (encuentros pared-pared) y quedaron en el cluster por
 * selección múltiple o ids residuales.
 */
function filterTrueMergeMembers(
  cluster: number[],
  groups: GeometryGroup[],
  wallWallJoints: WallWallJoint[],
): number[] {
  const survivorId = findMergeSurvivorId(cluster, groups);
  if (survivorId == null) return cluster;

  const survivor = groups.find((g) => g.id === survivorId);
  if (!survivor) return cluster;

  const groupById = new Map(groups.map((g) => [g.id, g]));
  const encounterPartnerIds = new Set<number>();
  for (const ww of wallWallJoints) {
    if (ww.groupA === survivorId) encounterPartnerIds.add(ww.groupB);
    if (ww.groupB === survivorId) encounterPartnerIds.add(ww.groupA);
  }

  return cluster.filter((id) => {
    if (id === survivorId) return true;
    // Absorbida en el panel fusionado — ya no existe como grupo aparte.
    if (!groupById.has(id)) return true;
    const g = groupById.get(id)!;
    // Sigue como grupo separado: solo si es coplanar con el superviviente.
    if (!areGroupsCoplanar(survivor, g)) return false;
    // Coplanar pero cruce pared-pared → es aledaña, no miembro de la fusión.
    if (encounterPartnerIds.has(id)) return false;
    return true;
  });
}

/** Expande ids con miembros de fusiones existentes y todas las coplanares. */
function listCoplanarFacadeIds(
  reference: GeometryGroup,
  groups: GeometryGroup[],
  overrides: Map<number, FaceCategory>,
): number[] {
  if (getEffectiveCategory(reference, overrides) !== "wall") return [];
  return groups
    .filter(
      (g) =>
        getEffectiveCategory(g, overrides) === "wall" &&
        areGroupsCoplanar(reference, g),
    )
    .map((g) => g.id);
}

/** Mapea ids de miembros fusionados → superviviente en groups. */
function buildWallIdAliasMap(
  merges: number[][],
  groups: GeometryGroup[],
): Map<number, number> {
  const map = new Map<number, number>();
  for (const g of groups) map.set(g.id, g.id);
  for (const cluster of merges) {
    const survivor = findMergeSurvivorId(cluster, groups) ?? cluster[0];
    for (const id of cluster) map.set(id, survivor);
  }
  return map;
}

function resolveWallId(id: number, aliasMap: Map<number, number>): number {
  return aliasMap.get(id) ?? id;
}

function wallInPriority(
  wallId: number,
  priority: Set<number>,
  aliasMap: Map<number, number>,
): boolean {
  const resolved = resolveWallId(wallId, aliasMap);
  for (const pid of priority) {
    if (resolveWallId(pid, aliasMap) === resolved) return true;
  }
  return false;
}

function yielderMatchesWall(
  yieldId: number | undefined,
  wallId: number,
  aliasMap: Map<number, number>,
): boolean {
  if (yieldId == null) return false;
  return resolveWallId(yieldId, aliasMap) === resolveWallId(wallId, aliasMap);
}

/** Id del lado fachada vs perpendicular en un cruce (para UI y bulk). */
function facadeJointSides(
  ww: WallWallJoint,
  refGroup: GeometryGroup,
  groups: GeometryGroup[],
  aliasMap: Map<number, number>,
  referenceResolved: number,
): { facadeId: number; otherId: number } | null {
  const groupFor = (id: number) =>
    groups.find((g) => g.id === resolveWallId(id, aliasMap));
  const ga = groupFor(ww.groupA);
  const gb = groupFor(ww.groupB);
  if (!ga || !gb) return null;

  const aCoplanar = areGroupsCoplanar(refGroup, ga);
  const bCoplanar = areGroupsCoplanar(refGroup, gb);

  if (aCoplanar && !bCoplanar)
    return { facadeId: ww.groupA, otherId: ww.groupB };
  if (bCoplanar && !aCoplanar)
    return { facadeId: ww.groupB, otherId: ww.groupA };

  if (aCoplanar && bCoplanar) {
    const ra = resolveWallId(ww.groupA, aliasMap);
    const rb = resolveWallId(ww.groupB, aliasMap);
    if (ra === referenceResolved && rb !== referenceResolved) {
      return { facadeId: ww.groupA, otherId: ww.groupB };
    }
    if (rb === referenceResolved && ra !== referenceResolved) {
      return { facadeId: ww.groupB, otherId: ww.groupA };
    }
  }
  return null;
}

function resolveBulkYieldTarget(
  ww: WallWallJoint,
  refGroup: GeometryGroup,
  groups: GeometryGroup[],
  aliasMap: Map<number, number>,
  referenceResolved: number,
  onlyReferenceWall: boolean,
): number | null {
  const sides = facadeJointSides(
    ww,
    refGroup,
    groups,
    aliasMap,
    referenceResolved,
  );
  if (!sides) return null;
  if (
    onlyReferenceWall &&
    resolveWallId(sides.facadeId, aliasMap) !== referenceResolved
  ) {
    return null;
  }
  return sides.otherId;
}

type WallWallListItem = {
  ww: WallWallJoint;
  hasThickness: boolean;
};

/** Cruces donde las paredes prioritarias ganan (las otras se acortan). */
function countBulkYieldOthersJoints(
  refGroup: GeometryGroup,
  groups: GeometryGroup[],
  wallWallList: WallWallListItem[],
  aliasMap: Map<number, number>,
  referenceResolved: number,
  onlyReferenceWall: boolean,
): number {
  let n = 0;
  for (const { ww, hasThickness } of wallWallList) {
    if (!hasThickness) continue;
    if (
      resolveBulkYieldTarget(
        ww,
        refGroup,
        groups,
        aliasMap,
        referenceResolved,
        onlyReferenceWall,
      ) != null
    ) {
      n++;
    }
  }
  return n;
}

function applyBulkYieldOthersDecisions(
  prev: WallWallDecisions,
  refGroup: GeometryGroup,
  groups: GeometryGroup[],
  wallWallList: WallWallListItem[],
  aliasMap: Map<number, number>,
  referenceResolved: number,
  onlyReferenceWall: boolean,
): { next: WallWallDecisions; updated: number } {
  const next = new Map(prev);
  let updated = 0;
  for (const { ww, hasThickness } of wallWallList) {
    if (!hasThickness) continue;
    const yieldId = resolveBulkYieldTarget(
      ww,
      refGroup,
      groups,
      aliasMap,
      referenceResolved,
      onlyReferenceWall,
    );
    if (yieldId == null) continue;
    const prevYield = prev.get(ww.jointIndex) ?? ww.suggestedYieldGroupId;
    if (!yielderMatchesWall(prevYield, yieldId, aliasMap)) updated++;
    next.set(ww.jointIndex, yieldId);
  }
  return { next, updated };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Secciones del acordeón del inspector (una abierta a la vez). */
type InspectorSectionId =
  | "notas"
  | "curvado"
  | "refuerzos"
  | "uniones"
  | "cortes"
  | "similares";

/** Color/etiqueta del header del inspector según la categoría del componente. */
const SELECTION_DOT: Record<string, string> = {
  wall: "var(--viewer-wall, #9c9c9c)",
  floor: "var(--viewer-floor, #cf9567)",
  discard: "var(--viewer-discard, #8b95a3)",
};
const CATEGORY_LABEL_ES: Record<string, string> = {
  wall: "Pared",
  floor: "Piso",
  discard: "Descartado",
};

export default function ReviewScreen({
  phase1,
  merges,
  onConfirm,
  onCancel,
  onRotateAxis,
  onAddMerge,
  onRemoveMerge,
  onReplaceMerges,
  onAddSplit,
  minAreaM2,
  onMinAreaChange,
  pinTools,
  onPinToolsChange,
  initialOverrides,
  initialWallWallDecisions,
  initialMarks,
  initialUserCuts,
  initialNotes,
  isRecomputing = false,
  isGenerating = false,
  isSavingOnExit = false,
  onPrintScaleChange,
  onEditingStateChange,
  onRequestAssemblyPreview,
  openAssemblyInstructivo = false,
}: ReviewScreenProps) {
  const {
    assemblyGuideData,
    setAssemblyGuideData,
    savedFlex,
    savedMarkLines,
    setSavedMarkLines,
    savedRibs,
    setSavedRibs,
    savedColumns,
    setSavedColumns,
    nestingData,
    scale,
  } = useProjectContext();
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [overrides, setOverrides] = useState<Map<number, FaceCategory>>(() => {
    if (!initialOverrides || initialOverrides.length === 0) return new Map();
    const m = new Map<number, FaceCategory>();
    for (const o of initialOverrides) m.set(o.groupId, o.newCategory);
    return m;
  });
  const [visibleCategories, setVisibleCategories] = useState<Set<FaceCategory>>(
    () => new Set(ALL_CATEGORIES),
  );
  const [showCenterAxes, setShowCenterAxes] = useState(true);
  const [isSolid, setIsSolid] = useState(false);
  const [hideSidebar, setHideSidebar] = useState(false);
  const [hideToolbar, setHideToolbar] = useState(false);
  /** Señal para enfocar el borrador de notas (atajo N / Command Palette). */
  const [noteFocusKey, setNoteFocusKey] = useState(0);
  // Which wall-wall joint (by jointIndex) is highlighted with leader labels in
  // the 3D viewer. Null = none selected.
  const [selectedJointIndex, setSelectedJointIndex] = useState<number | null>(
    null,
  );
  // Wall-wall joint decisions: jointIndex → groupId that yields. Seeded from
  // each joint's safe default suggestion (thinner wall yields), overridable.
  const [wallWallDecisions, setWallWallDecisions] = useState<WallWallDecisions>(
    () => {
      if (initialWallWallDecisions && initialWallWallDecisions.size > 0) {
        return new Map(initialWallWallDecisions);
      }
      const m = new Map<number, number>();
      for (const ww of phase1.wallWallJoints) {
        if (ww.suggestedYieldGroupId != null)
          m.set(ww.jointIndex, ww.suggestedYieldGroupId);
      }
      return m;
    },
  );
  // Mark state: component IDs whose openings (door/window holes) are engraved
  // in red instead of being cut.
  const [markGroupIds, setMarkGroupIds] = useState<Set<number>>(
    () => new Set(initialMarks ?? []),
  );
  // Cortes manuales del usuario (panel-local, metros). El front captura el gesto
  // y muestra el preview; el backend aplica los cortes al generar.
  const [userCuts, setUserCuts] = useState<UserCut[]>(
    () => initialUserCuts ?? [],
  );
  const [groupNotes, setGroupNotes] = useState<GroupNote[]>(
    () => initialNotes ?? [],
  );
  const [cutToolMode, setCutToolMode] = useState(false);
  const [cutShapeKind, setCutShapeKind] = useState<ActiveCutShapeKind>("rect");
  /** Snap cortes a los bordes del panel (corte completo de pared). Alt desactiva temporalmente. */
  const [cutEdgeSnap, setCutEdgeSnap] = useState(true);
  const [cutDraft, setCutDraft] = useState<CutDragState | null>(null);
  const [movingCutId, setMovingCutId] = useState<string | null>(null);
  const [selectedCutId, setSelectedCutId] = useState<string | null>(null);
  const [measureToolMode, setMeasureToolMode] = useState(false);
  const [measureShapeKind, setMeasureShapeKind] =
    useState<MeasureShapeKind>("line");
  const [measureDraft, setMeasureDraft] = useState<MeasureDragState | null>(
    null,
  );
  const [measures, setMeasures] = useState<UserMeasure[]>([]);
  const [selectedMeasureId, setSelectedMeasureId] = useState<string | null>(
    null,
  );
  // Herramienta de medición de ángulos (transportador).
  const [angleMeasureMode, setAngleMeasureMode] = useState<"off" | "line" | "panels">("off");
  const [angleDraft, setAngleDraft] = useState<AngleDraftState | null>(null);
  const [angleMeasures, setAngleMeasures] = useState<UserAngleMeasure[]>([]);
  // Herramienta de líneas rojas (marcar para grabar).
  const [markLineToolMode, setMarkLineToolMode] = useState(false);
  // Herramienta "Colocar nervio" (imán a la junta pared↔piso) + fantasma.
  const [ribToolMode, setRibToolMode] = useState(false);
  const [ribGhost, setRibGhost] = useState<Rib | null>(null);
  const [markLineMode, setMarkLineMode] = useState<MarkLineMode>("straight");
  const [markLineDraft, setMarkLineDraft] = useState<MarkLine | null>(null);
  const [measureLabelScale, setMeasureLabelScale] = useState(
    MEASURE_SCALE_ORIGINAL,
  );
  // Foco de ayuda de la ventana de encuentros pared-pared: apagado por defecto
  // para ganar espacio; el usuario lo enciende para ver la explicación.
  const [showWallWallHelp, setShowWallWallHelp] = useState(false);
  /** Pared cuyo panel de encuentros está abierto (independiente de la selección 3D). */
  const [encountersWallId, setEncountersWallId] = useState<number | null>(null);
  /** Within a merged cluster, which original wall is currently focused. */
  const [mergeMemberFocusId, setMergeMemberFocusId] = useState<number | null>(
    null,
  );
  const groupFaceIndexByIdRef = useRef<Map<number, number[]>>(new Map());
  const [mergeCardOpen, setMergeCardOpen] = useState(true);
  const [hiddenGroupIds, setHiddenGroupIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [bulkActionNotice, setBulkActionNotice] = useState<string | null>(null);
  // Comando de cámara (encuadrar / reset) hacia el visor.
  const [cameraCommand, setCameraCommand] = useState<CameraCommand | null>(null);
  const triggerCamera = useCallback((kind: CameraCommand["kind"]) => {
    setCameraCommand({ nonce: Date.now(), kind });
  }, []);
  // Rayos X: paredes translúcidas para ver piezas internas.
  const [xrayMode, setXrayMode] = useState(false);
  // Plano de sección (corte) para ver el interior.
  const [section, setSection] = useState<SectionState>({ enabled: false, axis: "y", pos: 0.5 });
  // Modo caminar/volar (primera persona).
  const [walkMode, setWalkMode] = useState(false);
  const toggleWalk = useCallback(() => {
    setWalkMode((w) => {
      if (!w) {
        setCutToolMode(false);
        setCutDraft(null);
        setMeasureToolMode(false);
        setMeasureDraft(null);
        setBoxSelectMode(false);
      }
      return !w;
    });
  }, []);
  // Pestaña activa del panel derecho: lista de capas vs acciones de la selección.
  const [sidebarTab, setSidebarTab] = useState<"capas" | "seleccion">("capas");

  // Assembly guide — solo en ventana flotante (botón de la barra superior).
  const [assemblyData, setAssemblyData] = useState<import("@/services/api").AssemblyPreviewData | null>(null);
  const [assemblyLoading, setAssemblyLoading] = useState(false);
  const [assemblyError, setAssemblyError] = useState<string | null>(null);
  const [assemblyWindowOpen, setAssemblyWindowOpen] = useState(false);
  const [bulkSimilarModal, setBulkSimilarModal] = useState<{
    reference: GeometryGroup;
    matches: GeometryGroup[];
    mode: "discard" | "promote";
    promoteTarget?: "wall" | "floor";
  } | null>(null);
  const [bulkSimilarChecked, setBulkSimilarChecked] = useState<Set<number>>(
    () => new Set(),
  );
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const viewerAreaRef = useRef<HTMLDivElement>(null);
  const skipWallWallReseedRef = useRef(false);

  // Box selection
  const [boxSelectMode, setBoxSelectMode] = useState(false);
  const [dragRect, setDragRect] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const viewerRef = useRef<ModelViewerHandle | null>(null);

  // Exclusión mutua del imán de nervios: cualquier otra herramienta lo apaga.
  useEffect(() => {
    if (cutToolMode || measureToolMode || markLineToolMode || boxSelectMode || walkMode) {
      setRibToolMode(false);
      setRibGhost(null);
    }
  }, [cutToolMode, measureToolMode, markLineToolMode, boxSelectMode, walkMode]);

  const boxDragRef = useRef<{
    startX: number;
    startY: number;
    active: boolean;
  }>({
    startX: 0,
    startY: 0,
    active: false,
  });

  const historyState = useMemo(
    () => ({
      overrides,
      hiddenGroupIds,
      wallWallDecisions,
      userCuts,
    }),
    [overrides, hiddenGroupIds, wallWallDecisions, userCuts],
  );

  const { canUndo, canRedo, pushHistory, undo, redo } =
    useReviewHistory(historyState);

  const restoreHistorySnapshot = useCallback(
    (snap: ReturnType<typeof undo>) => {
      if (!snap) return;
      skipWallWallReseedRef.current = true;
      setOverrides(snap.overrides);
      setHiddenGroupIds(snap.hiddenGroupIds);
      setWallWallDecisions(snap.wallWallDecisions);
      setUserCuts(snap.userCuts);
      setSelectedGroupIds(new Set());
      setSelectedJointIndex(null);
      setContextMenu(null);
    },
    [],
  );

  const handleUndo = useCallback(() => {
    restoreHistorySnapshot(undo());
  }, [undo, restoreHistorySnapshot]);

  const handleRedo = useCallback(() => {
    restoreHistorySnapshot(redo());
  }, [redo, restoreHistorySnapshot]);

  useEffect(() => {
    if (!onEditingStateChange) return;
    onEditingStateChange({
      overrides: Array.from(overrides.entries()).map(([groupId, newCategory]) => ({
        groupId,
        newCategory,
      })),
      wallWallDecisions,
      marks: [...markGroupIds],
      userCuts,
      notes: groupNotes,
      markLines: savedMarkLines,
    });
  }, [overrides, wallWallDecisions, markGroupIds, userCuts, groupNotes, savedMarkLines, onEditingStateChange]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    return () => {
      window.removeEventListener("click", close);
    };
  }, [contextMenu]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);

      if (e.key === "Escape") {
        if (typing) return;
        setCutToolMode(false);
        setCutDraft(null);
        setMeasureToolMode(false);
        setMeasureDraft(null);
        setMarkLineToolMode(false);
        setMarkLineDraft(null);
        setAngleMeasureMode('off');
        setAngleDraft(null);
        setBoxSelectMode(false);
        setDragRect(null);
        setSelectedGroupIds(new Set());
        setSelectedJointIndex(null);
        setContextMenu(null);
        return;
      }

      if (typing) return;

      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;

      if (e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if (e.key === "y" || (e.key === "z" && e.shiftKey)) {
        e.preventDefault();
        handleRedo();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleUndo, handleRedo]);

  // El backend ya aplicó eje/área/merges/splits: `phase1` ES la topología
  // efectiva. El front no recalcula geometría.

  /** Grupos visibles tras aplicar cortes manuales (piezas separadas seleccionables). */
  const cutGroupsResult = useMemo(
    () =>
      buildDisplayGroupsFromCuts(
        phase1.groups,
        phase1.faces,
        userCuts,
        phase1.appliedAxis,
      ),
    [phase1.groups, phase1.faces, userCuts, phase1.appliedAxis],
  );
  const displayGroups = cutGroupsResult.displayGroups;
  const derivedCutTriangles = cutGroupsResult.derivedTriangles;
  const derivedPanelPolys = cutGroupsResult.derivedPanelPolys;

  // Rango vertical del modelo (para la altura por defecto de una columna).
  const modelYRange = useMemo(() => {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const g of phase1.groups) {
      minY = Math.min(minY, g.centroid.y);
      maxY = Math.max(maxY, g.centroid.y);
    }
    return Number.isFinite(minY) && maxY > minY ? { minY, maxY } : { minY: 0, maxY: 1 };
  }, [phase1.groups]);

  const canAddRib = selectedGroupIds.size === 2;
  const canAddColumn = selectedGroupIds.size >= 1;
  // Cartela modesta: 20×20 mm físicos de maqueta, escalados al mundo del visor.
  const ribSizeM = useMemo(() => resolveRibSizeM(scale), [scale]);

  // Fuente de juntas unificada: preferir plateJoints del nesting (aristas exactas)
  // y caer a los joints de phase1 cuando nestingData aún no está disponible.
  const effectivePlateJoints = useMemo(
    () =>
      nestingData?.plateJoints?.length
        ? nestingData.plateJoints
        : jointsToPlateJoints(phase1.joints ?? []),
    [nestingData, phase1.joints],
  );

  const handleAddRib = useCallback(() => {
    if (selectedGroupIds.size !== 2) return;
    const [rawA, rawB] = Array.from(selectedGroupIds);
    // Resolver ids derivados (negativos) a sus dueños para que el preview y el
    // payload al backend usen los ids reales de los grupos padre.
    const groupA = cutGroupOwnerId(rawA);
    const groupB = cutGroupOwnerId(rawB);
    setSavedRibs([
      ...savedRibs,
      { id: createRibId(), groupA, groupB, sizeM: ribSizeM, t: DEFAULT_RIB_T },
    ]);
  }, [selectedGroupIds, savedRibs, setSavedRibs, ribSizeM]);

  const handleCommitSnappedRib = useCallback(
    (rib: Rib) => {
      setSavedRibs([...savedRibs, rib]);
    },
    [savedRibs, setSavedRibs],
  );

  const handleSetRibT = useCallback(
    (id: string, t: number) => {
      setSavedRibs(savedRibs.map((r) => (r.id === id ? { ...r, t } : r)));
    },
    [savedRibs, setSavedRibs],
  );

  const handleSetRibSize = useCallback(
    (id: string, physicalMm: number) => {
      const mm = Math.max(10, Math.min(80, physicalMm));
      const sizeM = (mm / 1000) * Math.max(scale, 1);
      setSavedRibs(savedRibs.map((r) => (r.id === id ? { ...r, sizeM } : r)));
    },
    [savedRibs, setSavedRibs, scale],
  );

  const handleAddColumn = useCallback(() => {
    if (selectedGroupIds.size < 1) return;
    const firstId = Array.from(selectedGroupIds)[0];
    const g = phase1.groups.find((gr) => gr.id === firstId);
    if (!g) return;

    // Base = donde está el componente seleccionado; la columna se para ahí.
    const baseY = g.minY ?? g.centroid.y;
    // Altura: si el componente es una pared alta, su propia altura; si es un piso,
    // el hueco hasta el próximo piso de arriba (o un default sensato).
    let height = g.maxY != null && g.minY != null ? g.maxY - g.minY : 0;
    if (height < 0.1) {
      const nextFloorY = phase1.groups
        .filter((gr) => gr.category === "floor" && gr.centroid.y > baseY + 0.05)
        .map((gr) => gr.centroid.y)
        .sort((a, b) => a - b)[0];
      height =
        nextFloorY != null
          ? nextFloorY - baseY
          : Math.max((modelYRange.maxY - modelYRange.minY) * 0.3, 0.5);
    }

    setSavedColumns([
      ...savedColumns,
      {
        id: createColumnId(),
        position: { x: g.centroid.x, y: baseY, z: g.centroid.z },
        heightM: height,
        sizeM: DEFAULT_COLUMN_SIZE_M,
      },
    ]);
  }, [selectedGroupIds, phase1.groups, modelYRange, savedColumns, setSavedColumns]);

  // ── Puente con el Command Palette (⌘K) ──────────────────────────────────────
  // Publicamos la selección para gatear comandos, y reaccionamos a la herramienta
  // / intención que dispara la palette, mapeándola a los modos existentes.
  const uiToolNonce = useUIStore((s) => s.toolNonce);
  const uiIntent = useUIStore((s) => s.intent);
  // Tour guiado: nonce que lo relanza desde el Command Palette.
  const [tourNonce, setTourNonce] = useState(0);

  useEffect(() => {
    useUIStore.getState().setSelectionCount(selectedGroupIds.size);
  }, [selectedGroupIds]);

  useEffect(() => {
    if (uiToolNonce === 0) return; // valor inicial, no forzar cursor al montar
    const tool = useUIStore.getState().activeTool;
    // Apagar todos y encender el pedido (misma exclusión mutua que la barra).
    setCutToolMode(false);
    setCutDraft(null);
    setMeasureToolMode(false);
    setMeasureDraft(null);
    setMarkLineToolMode(false);
    setMarkLineDraft(null);
    setAngleMeasureMode('off');
    setAngleDraft(null);
    setBoxSelectMode(false);
    if (tool === "cut") setCutToolMode(true);
    else if (tool === "measure") setMeasureToolMode(true);
    else if (tool === "markLine") setMarkLineToolMode(true);
    else if (tool === "box") setBoxSelectMode(true);
    // "cursor" ⇒ todos apagados (ya hecho).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiToolNonce]);
  // El adaptador de intents (que usa handlers definidos más abajo) vive tras ellos.

  const displayGroupIds = useMemo(
    () => new Set(displayGroups.map((g) => g.id)),
    [displayGroups],
  );

  useEffect(() => {
    setSelectedGroupIds((prev) => {
      const next = new Set([...prev].filter((id) => displayGroupIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [displayGroupIds]);

  // Etiquetas de panel (A1/B2…) provistas por el backend.
  const panelIdByGroup = useMemo(() => {
    const m = new Map<number, string>();
    const rec = phase1.panelIdByGroup;
    if (rec) for (const [k, v] of Object.entries(rec)) m.set(Number(k), v);
    return m;
  }, [phase1.panelIdByGroup]);

  // When a single merged group is selected, find which original groups were fused into it.
  const selectedMergeCluster = useMemo(() => {
    if (selectedGroupIds.size !== 1 || merges.length === 0) return null;
    const selId = Array.from(selectedGroupIds)[0];
    return findMergeClusterForGroupId(selId, merges, phase1.groups);
  }, [selectedGroupIds, merges, phase1.groups]);

  /** Miembros reales de la fusión (sin paredes de encuentro que interceptan). */
  const displayMergeMembers = useMemo(() => {
    if (!selectedMergeCluster) return [];
    return filterTrueMergeMembers(
      selectedMergeCluster,
      phase1.groups,
      phase1.wallWallJoints,
    );
  }, [selectedMergeCluster, phase1.groups, phase1.wallWallJoints]);

  // Cache face indices per group id before merges collapse them (for member highlight).
  const groupFaceIndexById = useMemo(() => {
    const next = new Map(groupFaceIndexByIdRef.current);
    for (const g of phase1.groups) {
      if (!next.has(g.id)) next.set(g.id, [...g.faceIndices]);
    }
    groupFaceIndexByIdRef.current = next;
    return next;
  }, [phase1.groups]);

  const mergeMemberHighlightFaceIndices = useMemo(() => {
    if (mergeMemberFocusId == null) return null;
    const faces = groupFaceIndexById.get(mergeMemberFocusId);
    return faces && faces.length > 0 ? faces : null;
  }, [mergeMemberFocusId, groupFaceIndexById]);

  const handleHideGroup = useCallback(
    (id: number) => {
      pushHistory();
      setHiddenGroupIds((prev) => new Set(prev).add(id));
      setSelectedGroupIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setSelectedJointIndex(null);
    },
    [pushHistory],
  );

  const handleSelectGroup = useCallback((id: number) => {
    if (id === -1) {
      setSelectedCutId(null);
    } else {
      const extractCut = userCutForDerivedExtract(id, userCuts);
      setSelectedCutId(extractCut?.id ?? null);
    }
    setSelectedGroupIds((prev) => {
      if (id === -1) return new Set();
      if (prev.size === 1 && prev.has(id)) return new Set();
      return new Set([id]);
    });
    setSelectedJointIndex(null);
  }, [userCuts]);

  const handleToggleGroup = useCallback((id: number) => {
    setSelectedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    setSelectedJointIndex(null);
  }, []);

  const handleShowGroup = useCallback(
    (id: number) => {
      pushHistory();
      setHiddenGroupIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
    [pushHistory],
  );

  const handleShowAllHidden = useCallback(() => {
    if (hiddenGroupIds.size === 0) return;
    pushHistory();
    setHiddenGroupIds(new Set());
  }, [hiddenGroupIds.size, pushHistory]);

  const applyCategoryOverride = useCallback(
    (next: Map<number, FaceCategory>, gid: number, category: FaceCategory) => {
      const original = phase1.groups.find((g) => g.id === gid)?.category;
      if (original === category) next.delete(gid);
      else next.set(gid, category);
    },
    [phase1.groups],
  );

  const handleChangeCategory = useCallback(
    (id: number, category: FaceCategory) => {
      const idsToUpdate = selectedGroupIds.has(id)
        ? Array.from(selectedGroupIds)
        : [id];

      pushHistory();
      setOverrides((prev) => {
        const next = new Map(prev);
        for (const gid of idsToUpdate) {
          applyCategoryOverride(next, gid, category);
        }
        return next;
      });
    },
    [selectedGroupIds, applyCategoryOverride, pushHistory],
  );

  const selectedGroup = useMemo(() => {
    if (selectedGroupIds.size !== 1) return null;
    const selId = Array.from(selectedGroupIds)[0];
    return displayGroups.find((g) => g.id === selId) ?? null;
  }, [selectedGroupIds, displayGroups]);

  /**
   * Grupo de pared "dueño" de la selección. Si la selección es una pieza
   * derivada de un corte (id negativo, "· resto"/"· recorte"), su pared original
   * está oculta y sólo se pueden seleccionar las piezas derivadas; para los
   * encuentros pared-pared (que viven en ids originales) hay que remontar al
   * padre. Para paredes sin cortar, el dueño es la propia selección.
   */
  const selectedWallOwnerGroup = useMemo(() => {
    if (!selectedGroup) return null;
    const ownerId = cutGroupOwnerId(selectedGroup.id);
    if (ownerId === selectedGroup.id) return selectedGroup;
    return phase1.groups.find((g) => g.id === ownerId) ?? selectedGroup;
  }, [selectedGroup, phase1.groups]);

  const cutsForSelectedGroup = useMemo(() => {
    if (!selectedGroup) return [];
    const ownerId = cutGroupOwnerId(selectedGroup.id);
    return userCuts.filter((c) => c.groupId === ownerId);
  }, [selectedGroup, userCuts]);

  /** Componente de display seleccionado (no el padre de topología). */
  const selectedNoteComponentId = useMemo(
    () => (selectedGroup ? selectedGroup.id : null),
    [selectedGroup],
  );

  /**
   * Corte activo: selección explícita en la lista de cortes, o pieza
   * extraída seleccionada en el visor/lista de componentes.
   */
  const activeNoteCutId = useMemo(() => {
    if (selectedGroup) {
      const fromPiece = userCutForDerivedExtract(selectedGroup.id, userCuts);
      if (fromPiece) return fromPiece.id;
    }
    if (!selectedCutId || !selectedGroup) return null;
    const ownerId = cutGroupOwnerId(selectedGroup.id);
    const cut = userCuts.find((c) => c.id === selectedCutId);
    if (!cut || cut.groupId !== ownerId) return null;
    return selectedCutId;
  }, [selectedCutId, selectedGroup, userCuts]);

  const noteCounts = useMemo(() => noteCountByGroupId(groupNotes), [groupNotes]);
  const cutNoteCounts = useMemo(() => noteCountByCutId(groupNotes), [groupNotes]);

  const noteMarkers = useMemo<GroupNoteMarker[]>(() => {
    if (noteCounts.size === 0) return [];
    const byId = new Map(displayGroups.map((g) => [g.id, g]));
    const out: GroupNoteMarker[] = [];
    for (const [cid, count] of noteCounts) {
      if (count <= 0) continue;
      const g = byId.get(cid);
      if (!g) continue;
      if (hiddenGroupIds.has(cid) || hiddenGroupIds.has(cutGroupOwnerId(cid))) continue;
      const cat = overrides.get(cutGroupOwnerId(cid)) ?? g.category;
      if (!visibleCategories.has(cat)) continue;
      out.push({ groupId: cid, anchor: g.centroid, noteCount: count });
    }
    return out;
  }, [noteCounts, displayGroups, hiddenGroupIds, overrides, visibleCategories]);

  const componentLabelsForNotes = useMemo(() => {
    const map = new Map<number, string>();
    for (const g of displayGroups) {
      const ownerId = cutGroupOwnerId(g.id);
      const pid = phase1.panelIdByGroup?.[ownerId];
      map.set(g.id, pid ? `${pid} · ${g.label}` : g.label);
    }
    // Padres de topología (por si hay notas legacy / de corte).
    for (const g of phase1.groups) {
      if (map.has(g.id)) continue;
      const pid = phase1.panelIdByGroup?.[g.id];
      map.set(g.id, pid ? `${pid} · ${g.label}` : g.label);
    }
    return map;
  }, [displayGroups, phase1.groups, phase1.panelIdByGroup]);

  const cutLabelsForNotes = useMemo(() => {
    const map = new Map<string, string>();
    for (const cut of userCuts) {
      map.set(cut.id, `${cut.kind} · ${cutDimensionsLabel(cut)}`);
    }
    return map;
  }, [userCuts]);

  const sameAreaMatches = useMemo(() => {
    if (!selectedGroup) return [];
    if (getEffectiveCategory(selectedGroup, overrides) === "discard") return [];
    return findGroupsWithSameArea(phase1.groups, selectedGroup, overrides);
  }, [selectedGroup, phase1.groups, overrides]);

  const sameAreaDiscardMatches = useMemo(() => {
    if (!selectedGroup) return [];
    if (getEffectiveCategory(selectedGroup, overrides) !== "discard") return [];
    return findGroupsWithSameArea(phase1.groups, selectedGroup, overrides);
  }, [selectedGroup, phase1.groups, overrides]);

  const openBulkSimilarModal = useCallback(
    (mode: "discard" | "promote", promoteTarget?: "wall" | "floor") => {
      if (!selectedGroup) return;
      const similar = collectSimilarGroups(
        phase1.groups,
        selectedGroup,
        overrides,
      );
      setBulkSimilarChecked(new Set(similar.map((g) => g.id)));
      setBulkSimilarModal({
        reference: selectedGroup,
        matches: similar.slice(1),
        mode,
        promoteTarget,
      });
    },
    [selectedGroup, phase1.groups, overrides],
  );

  const confirmBulkSimilar = useCallback(() => {
    if (!bulkSimilarModal) return;
    const ids = Array.from(bulkSimilarChecked);
    const target: FaceCategory =
      bulkSimilarModal.mode === "discard"
        ? "discard"
        : (bulkSimilarModal.promoteTarget ?? "wall");

    pushHistory();
    setOverrides((prev) => {
      const next = new Map(prev);
      for (const gid of ids) {
        applyCategoryOverride(next, gid, target);
      }
      return next;
    });

    if (ids.length > 1) {
      const label =
        bulkSimilarModal.mode === "discard"
          ? `Se descartaron ${ids.length} capas del mismo tamaño`
          : `Se marcaron ${ids.length} capas como ${
              target === "wall" ? "pared" : "piso"
            }`;
      setBulkActionNotice(label);
      window.setTimeout(() => setBulkActionNotice(null), 4000);
    }
    setBulkSimilarModal(null);
  }, [
    bulkSimilarModal,
    bulkSimilarChecked,
    applyCategoryOverride,
    pushHistory,
  ]);

  // Re-seed wall-wall decisions whenever the effective topology changes (axis
  // rotation, min-area, or merge changes recompute joints and their indices).
  // The ref guard skips the initial mount so restored / initial decisions survive.
  const effectiveRef = useRef(phase1);
  useEffect(() => {
    if (skipWallWallReseedRef.current) {
      skipWallWallReseedRef.current = false;
      effectiveRef.current = phase1;
      return;
    }
    if (effectiveRef.current === phase1) return;
    effectiveRef.current = phase1;
    const m = new Map<number, number>();
    for (const ww of phase1.wallWallJoints) {
      if (ww.suggestedYieldGroupId != null)
        m.set(ww.jointIndex, ww.suggestedYieldGroupId);
    }
    setWallWallDecisions(m);
  }, [phase1]);

  // Clear the highlighted joint when the encounters panel closes.
  useEffect(() => {
    if (encountersWallId == null) setSelectedJointIndex(null);
  }, [encountersWallId]);

  const handleRotateAxis = useCallback(() => {
    if (isRecomputing || isGenerating) return;
    setOverrides(new Map());
    setSelectedGroupIds(new Set());
    setHiddenGroupIds(new Set());
    onRotateAxis();
  }, [onRotateAxis, isRecomputing, isGenerating]);

  const handleMinAreaChangeWithReset = useCallback(
    (newArea: number) => {
      setOverrides(new Map());
      setSelectedGroupIds(new Set());
      setHiddenGroupIds(new Set());
      onMinAreaChange(newArea);
    },
    [onMinAreaChange],
  );

  // Merge selected coplanar groups into one panel.
  const selectedGroups = useMemo(() => {
    return Array.from(selectedGroupIds)
      .map((id) => phase1.groups.find((g) => g.id === id))
      .filter((g): g is GeometryGroup => g != null);
  }, [selectedGroupIds, phase1.groups]);

  const selectedWallGroups = useMemo(
    () =>
      selectedGroups.filter(
        (g) => getEffectiveCategory(g, overrides) === "wall",
      ),
    [selectedGroups, overrides],
  );

  // El cluster a fusionar = las paredes seleccionadas (≥2). El backend valida y
  // las agrupa por coplanaridad al recalcular; el front sólo recolecta la
  // decisión.
  const mergeClusters = useMemo<number[][]>(
    () =>
      selectedWallGroups.length >= 2
        ? [selectedWallGroups.map((g) => g.id)]
        : [],
    [selectedWallGroups],
  );

  const canMergeSelected = mergeClusters.length >= 1;

  // Etiqueta del botón según el resultado de la fusión.
  const mergeLabel = useMemo(() => {
    if (mergeClusters.length === 0) return "Fusionar";
    const n = mergeClusters[0].length;
    return `Fusionar ${n} pared${n !== 1 ? "es" : ""}`;
  }, [mergeClusters]);

  const mergeBlockedReason = useMemo(() => {
    if (selectedGroups.length < 2) return null;
    if (canMergeSelected) return null;
    if (selectedWallGroups.length < 2)
      return "Solo se pueden fusionar paredes.";
    return "No hay paredes coplanares en la selección.";
  }, [selectedGroups.length, selectedWallGroups.length, canMergeSelected]);

  const handleMergeSelected = useCallback(() => {
    if (mergeClusters.length < 1) return;
    onAddMerge(mergeClusters[0]);
    setSelectedGroupIds(new Set());
    setContextMenu(null);
  }, [mergeClusters, onAddMerge]);

  const handleHideSelected = useCallback(() => {
    if (selectedGroupIds.size === 0) return;
    pushHistory();
    setHiddenGroupIds((prev) => {
      const next = new Set(prev);
      for (const id of selectedGroupIds) next.add(id);
      return next;
    });
    setSelectedGroupIds(new Set());
    setContextMenu(null);
  }, [selectedGroupIds, pushHistory]);

  const openViewerContextMenu = useCallback(
    (detail: { clientX: number; clientY: number; groupId: number | null }) => {
      // Sidebar list may pass groupId; 3D viewer passes null to avoid right-click select.
      if (detail.groupId != null && selectedGroupIds.size === 0) {
        setSelectedGroupIds(new Set([detail.groupId]));
      }
      const hasSelection = selectedGroupIds.size > 0 || detail.groupId != null;
      if (!hasSelection) return;
      setContextMenu({ x: detail.clientX, y: detail.clientY });
    },
    [selectedGroupIds.size],
  );

  const selectedMergeIndex = useMemo(
    () => findMergeClusterIndex(selectedMergeCluster, merges),
    [selectedMergeCluster, merges],
  );

  // Sin geometría client-side no podemos contar componentes/piezas: ofrecemos
  // la acción de división solo cuando la capa seleccionada pertenece a una fusión.
  const canSplitMerged = useMemo(
    () =>
      selectedGroupIds.size === 1 &&
      displayMergeMembers.length >= 2 &&
      selectedMergeIndex >= 0,
    [selectedGroupIds.size, displayMergeMembers.length, selectedMergeIndex],
  );

  const divideAllLabel = useMemo(() => {
    const n = displayMergeMembers.length;
    return `Desfusionar todas · ${n} pared${n !== 1 ? "es" : ""}`;
  }, [displayMergeMembers.length]);

  // Keep a focused merge member for actions like "desfusionar solo esta pared".
  useEffect(() => {
    if (displayMergeMembers.length === 0) {
      setMergeMemberFocusId(null);
      return;
    }
    setMergeMemberFocusId((cur) =>
      cur != null && displayMergeMembers.includes(cur) ? cur : null,
    );
  }, [displayMergeMembers]);

  const handleUnmerge = useCallback(
    (mergeIndex: number) => {
      onRemoveMerge(mergeIndex);
    },
    [onRemoveMerge],
  );

  const handleDivideMerged = useCallback(() => {
    if (selectedMergeIndex < 0) return;
    const formerMembers = [...displayMergeMembers];
    onRemoveMerge(selectedMergeIndex);
    setSelectedGroupIds(new Set(formerMembers));
    setMergeMemberFocusId(null);
    setEncountersWallId(null);
    setSelectedJointIndex(null);
  }, [selectedMergeIndex, onRemoveMerge, displayMergeMembers]);

  /** Atajo N / Command Palette: abrir panel de notas y enfocar el borrador. */
  const handleStartNote = useCallback(() => {
    if (selectedGroupIds.size !== 1) return;
    setHideSidebar(false);
    setSidebarTab("seleccion");
    setNoteFocusKey((k) => k + 1);
  }, [selectedGroupIds.size]);

  // Remove ONLY the currently selected wall from its merge cluster.
  // If the remaining cluster is still 2+ walls, re-add it; otherwise drop it.
  const handleRemoveSelectedFromMerge = useCallback(() => {
    if (
      selectedMergeIndex < 0 ||
      !selectedMergeCluster ||
      displayMergeMembers.length === 0
    )
      return;
    const selId = mergeMemberFocusId ?? displayMergeMembers[0];
    if (selId == null) return;
    const cluster = merges[selectedMergeIndex];
    if (!cluster || cluster.length < 2) return;

    const remaining = cluster.filter((id) => id !== selId);
    const nextMerges = merges.filter((_, i) => i !== selectedMergeIndex);
    if (remaining.length >= 2) nextMerges.push(remaining);
    onReplaceMerges(nextMerges);

    const nextSelection =
      remaining.length >= 2
        ? (findMergeSurvivorId(remaining, phase1.groups) ?? remaining[0])
        : (remaining[0] ?? null);
    setSelectedGroupIds(new Set(nextSelection != null ? [nextSelection] : []));
    setSelectedJointIndex(null);
    setMergeMemberFocusId(remaining.length >= 2 ? remaining[0] : null);
  }, [
    selectedMergeIndex,
    selectedMergeCluster,
    displayMergeMembers,
    mergeMemberFocusId,
    merges,
    onReplaceMerges,
    phase1.groups,
  ]);

  const handleWallWallDecision = useCallback(
    (jointIndex: number, yieldGroupId: number) => {
      pushHistory();
      setWallWallDecisions((prev) => {
        const next = new Map(prev);
        next.set(jointIndex, yieldGroupId);
        return next;
      });
      setSelectedJointIndex(jointIndex);
    },
    [pushHistory],
  );

  const handleToggleVisibility = useCallback((cat: FaceCategory) => {
    setVisibleCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  const handleToggleMark = useCallback((id: number) => {
    setMarkGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Adaptador de intents del Command Palette → handlers existentes. (Se ubica tras
  // definirlos todos.) Todo lo que se puede hacer sobre el visor pasa por acá.
  useEffect(() => {
    if (!uiIntent) return;
    const ids = Array.from(selectedGroupIds);
    const first = ids[0];
    switch (uiIntent.id) {
      case "frame":
        triggerCamera(selectedGroupIds.size > 0 ? "frameSelection" : "frameAll");
        break;
      case "reset":
        triggerCamera("reset");
        break;
      case "xray":
        setXrayMode((v) => !v);
        break;
      case "section":
        setSection((s) => ({ ...s, enabled: !s.enabled }));
        break;
      case "walk":
        toggleWalk();
        break;
      case "showHidden":
        handleShowAllHidden();
        break;
      case "assembly":
        setAssemblyWindowOpen(true);
        break;
      case "undo":
        handleUndo();
        break;
      case "redo":
        handleRedo();
        break;
      case "cat.floor":
        if (first != null) handleChangeCategory(first, "floor");
        break;
      case "cat.wall":
        if (first != null) handleChangeCategory(first, "wall");
        break;
      case "cat.discard":
        if (first != null) handleChangeCategory(first, "discard");
        break;
      case "merge":
        handleMergeSelected();
        break;
      case "split":
        handleDivideMerged();
        break;
      case "note":
        handleStartNote();
        break;
      case "markOpenings":
        setSidebarTab("seleccion");
        for (const id of ids) handleToggleMark(id);
        break;
      case "kerf":
        // El panel de curvado (FlexControls) vive en la pestaña de acciones.
        setSidebarTab("seleccion");
        break;
      case "rib":
        setSidebarTab("seleccion");
        handleAddRib();
        break;
      case "ribSnap":
        setCutToolMode(false);
        setCutDraft(null);
        setMeasureToolMode(false);
        setMeasureDraft(null);
        setMarkLineToolMode(false);
        setMarkLineDraft(null);
        setBoxSelectMode(false);
        setRibToolMode(true);
        break;
      case "column":
        setSidebarTab("seleccion");
        handleAddColumn();
        break;
      case "tour":
        setTourNonce((n) => n + 1);
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiIntent]);

  const handleCommitCut = useCallback(
    (cut: UserCut) => {
      pushHistory();
      setUserCuts((prev) => [...prev, cut]);
    },
    [pushHistory],
  );

  const handleCommitMove = useCallback(
    (cut: UserCut) => {
      pushHistory();
      setUserCuts((prev) => prev.map((c) => (c.id === cut.id ? cut : c)));
    },
    [pushHistory],
  );

  const handleRemoveCut = useCallback(
    (cutId: string) => {
      pushHistory();
      setUserCuts((prev) => prev.filter((c) => c.id !== cutId));
      setGroupNotes((prev) => removeNotesForCut(prev, cutId));
      setSelectedCutId((prev) => (prev === cutId ? null : prev));
    },
    [pushHistory],
  );

  const handleCommitMeasure = useCallback((measure: UserMeasure) => {
    setMeasures((prev) => [...prev, measure]);
  }, []);

  const handleUpsertMarkLine = useCallback(
    (line: MarkLine) => {
      setSavedMarkLines((prev) => {
        const idx = prev.findIndex((l) => l.id === line.id);
        if (idx >= 0) {
          const next = prev.slice();
          next[idx] = line;
          return next;
        }
        return [...prev, line];
      });
    },
    [setSavedMarkLines],
  );

  const handleClearMeasures = useCallback(() => {
    setMeasures([]);
    setMeasureDraft(null);
    setSelectedMeasureId(null);
  }, []);

  const handleRemoveMeasure = useCallback((id: string) => {
    setMeasures((prev) => prev.filter((m) => m.id !== id));
    setSelectedMeasureId((prev) => (prev === id ? null : prev));
  }, []);

  const handleSelectMeasure = useCallback(
    (id: string) => {
      setSelectedMeasureId(id);
      // Stay on "Componentes" tab — don't change the group selection, which
      // would trigger the useEffect that auto-switches to "Selección".
      setSidebarTab("capas");
    },
    [],
  );

  const handleMeasureScaleChange = useCallback(
    (scaleDenom: number) => {
      setMeasureLabelScale(scaleDenom);
      if (!isOriginalMeasureScale(scaleDenom)) {
        onPrintScaleChange(scaleDenom);
      }
    },
    [onPrintScaleChange],
  );

  const measureLabelOptions = useMemo(
    () => ({
      scaleDenom: measureLabelScale,
    }),
    [measureLabelScale],
  );

  const handleConfirm = useCallback(() => {
    const result: ClassificationOverride[] = [];
    for (const [groupId, newCategory] of overrides.entries()) {
      result.push({ groupId, newCategory });
    }
    onConfirm(result, wallWallDecisions, [...markGroupIds], userCuts, groupNotes);
  }, [overrides, wallWallDecisions, markGroupIds, userCuts, groupNotes, onConfirm]);

  const handleBack = useCallback(() => {
    if (isSavingOnExit) return;
    void onCancel({
      overrides: Array.from(overrides.entries()).map(([groupId, newCategory]) => ({
        groupId,
        newCategory,
      })),
      wallWallDecisions,
      marks: [...markGroupIds],
      userCuts,
      notes: groupNotes,
      markLines: savedMarkLines,
    });
  }, [
    isSavingOnExit,
    onCancel,
    overrides,
    wallWallDecisions,
    markGroupIds,
    userCuts,
    groupNotes,
    savedMarkLines,
  ]);

  // Navegación de flujo constante (barra del shell). Reemplaza el footer propio.
  useRegisterFlowNav({
    backLabel: "Volver",
    onBack: handleBack,
    backBusy: isSavingOnExit,
    nextLabel: "Continuar",
    onNext: handleConfirm,
    canNext: !isGenerating && !isSavingOnExit,
    nextBusy: isGenerating,
    hint:
      overrides.size > 0
        ? `${overrides.size} clasificación${overrides.size !== 1 ? "es" : ""} modificada${overrides.size !== 1 ? "s" : ""}`
        : undefined,
    onInstructivo: onRequestAssemblyPreview ? () => setAssemblyWindowOpen(true) : undefined,
  });

  // Stats (per effective category).
  const stats = useMemo(() => {
    let floors = 0,
      walls = 0,
      discarded = 0;
    for (const group of phase1.groups) {
      const cat = overrides.get(group.id) ?? group.category;
      if (cat === "floor") floors++;
      else if (cat === "wall") walls++;
      else discarded++;
    }
    return { floors, walls, discarded };
  }, [phase1.groups, overrides]);

  // Wall-wall joints to resolve: skip any whose wall was reclassified to
  // discard (that joint no longer affects the cut).
  const wallWallList = useMemo(() => {
    const groupById = new Map(phase1.groups.map((g) => [g.id, g]));
    const effCat = (id: number) =>
      overrides.get(id) ?? groupById.get(id)?.category ?? "discard";
    return phase1.wallWallJoints
      .filter(
        (ww) =>
          effCat(ww.groupA) !== "discard" && effCat(ww.groupB) !== "discard",
      )
      .map((ww) => ({
        ww,
        labelA: groupById.get(ww.groupA)?.label ?? `Grupo ${ww.groupA}`,
        labelB: groupById.get(ww.groupB)?.label ?? `Grupo ${ww.groupB}`,
        pidA: panelIdByGroup.get(ww.groupA),
        pidB: panelIdByGroup.get(ww.groupB),
        hasThickness:
          (groupById.get(ww.groupA)?.thickness ?? 0) > 0.001 ||
          (groupById.get(ww.groupB)?.thickness ?? 0) > 0.001,
      }));
  }, [phase1.wallWallJoints, phase1.groups, overrides, panelIdByGroup]);

  const wallIdAliasMap = useMemo(
    () => buildWallIdAliasMap(merges, phase1.groups),
    [merges, phase1.groups],
  );

  /** Todas las paredes coplanares visibles (misma fachada / mismo plano). */
  const coplanarFacadeIds = useMemo(() => {
    if (
      !selectedWallOwnerGroup ||
      getEffectiveCategory(selectedWallOwnerGroup, overrides) !== "wall"
    )
      return [];
    return listCoplanarFacadeIds(selectedWallOwnerGroup, phase1.groups, overrides);
  }, [selectedWallOwnerGroup, phase1.groups, overrides]);

  const facadeReferenceResolved = useMemo(() => {
    if (!selectedWallOwnerGroup) return -1;
    return resolveWallId(selectedWallOwnerGroup.id, wallIdAliasMap);
  }, [selectedWallOwnerGroup, wallIdAliasMap]);

  const facadeRefGroup = useMemo(() => {
    if (facadeReferenceResolved < 0) return null;
    return (
      phase1.groups.find((g) => g.id === facadeReferenceResolved) ??
      selectedWallOwnerGroup
    );
  }, [facadeReferenceResolved, phase1.groups, selectedWallOwnerGroup]);

  const bulkYieldCountForWall = useMemo(() => {
    if (!facadeRefGroup || facadeReferenceResolved < 0) return 0;
    return countBulkYieldOthersJoints(
      facadeRefGroup,
      phase1.groups,
      wallWallList,
      wallIdAliasMap,
      facadeReferenceResolved,
      true,
    );
  }, [
    facadeRefGroup,
    phase1.groups,
    wallWallList,
    wallIdAliasMap,
    facadeReferenceResolved,
  ]);

  const bulkYieldCountForFacade = useMemo(() => {
    if (!facadeRefGroup || facadeReferenceResolved < 0) return 0;
    return countBulkYieldOthersJoints(
      facadeRefGroup,
      phase1.groups,
      wallWallList,
      wallIdAliasMap,
      facadeReferenceResolved,
      false,
    );
  }, [
    facadeRefGroup,
    phase1.groups,
    wallWallList,
    wallIdAliasMap,
    facadeReferenceResolved,
  ]);

  const canMergeCoplanarFacade = useMemo(() => {
    if (coplanarFacadeIds.length < 2) return false;
    const existing = findMergeClusterForGroupId(
      coplanarFacadeIds[0],
      merges,
      phase1.groups,
    );
    if (!existing) return true;
    const resolvedExisting = new Set(
      existing.map((id) => resolveWallId(id, wallIdAliasMap)),
    );
    return !coplanarFacadeIds.every((id) => resolvedExisting.has(id));
  }, [coplanarFacadeIds, merges, phase1.groups, wallIdAliasMap]);

  const showFacadeActions =
    selectedGroupIds.size === 1 &&
    selectedGroup != null &&
    getEffectiveCategory(selectedGroup, overrides) === "wall" &&
    (canMergeCoplanarFacade ||
      bulkYieldCountForWall > 0 ||
      bulkYieldCountForFacade > 0);

  /** True when the "Selección" tab has panels/actions worth showing. */
  const hasSelectionTabContent = useMemo(() => {
    if (selectedGroupIds.size === 0) return false;
    if (selectedGroupIds.size >= 2) return true;
    if (encountersWallId != null) return true;
    if (selectedMergeCluster && displayMergeMembers.length >= 2) return true;
    if (cutsForSelectedGroup.length > 0) return true;
    if (sameAreaMatches.length > 0) return true;
    if (sameAreaDiscardMatches.length > 0) return true;
    if (showFacadeActions) return true;
    return false;
  }, [
    selectedGroupIds.size,
    encountersWallId,
    selectedMergeCluster,
    displayMergeMembers.length,
    cutsForSelectedGroup.length,
    sameAreaMatches.length,
    sameAreaDiscardMatches.length,
    showFacadeActions,
  ]);

  // Ir a "Selección" solo si hay contenido; si no, quedarse en "Componentes".
  useEffect(() => {
    setSidebarTab((prev) => {
      if (selectedGroupIds.size === 0) return "capas";
      if (hasSelectionTabContent) return "seleccion";
      return "capas";
    });
  }, [selectedGroupIds.size, hasSelectionTabContent]);

  // --- Inspector (acordeón): una sección abierta a la vez ---
  const [inspectorSection, setInspectorSection] =
    useState<InspectorSectionId | null>(null);
  const toggleInspector = useCallback(
    (id: InspectorSectionId) =>
      setInspectorSection((cur) => (cur === id ? null : id)),
    [],
  );

  const showCurvadoSection =
    selectedGroupIds.size === 1 && selectedGroup?.category === "wall";
  const showUnionesSection =
    (selectedGroupIds.size === 1 && displayMergeMembers.length >= 2) ||
    encountersWallId != null ||
    selectedGroupIds.size >= 2;
  const showCortesSection =
    selectedGroupIds.size === 1 && cutsForSelectedGroup.length > 0;
  const showSimilaresSection =
    selectedGroupIds.size === 1 &&
    (sameAreaMatches.length > 0 || sameAreaDiscardMatches.length > 0);

  // Badges del acordeón.
  const notasBadge =
    selectedNoteComponentId != null
      ? noteCounts.get(selectedNoteComponentId)
      : undefined;
  const unionesBadge =
    selectedGroupIds.size >= 2
      ? selectedGroupIds.size
      : displayMergeMembers.length >= 2
        ? displayMergeMembers.length
        : undefined;
  const similaresBadge =
    sameAreaMatches.length + sameAreaDiscardMatches.length || undefined;

  // Auto-abrir la sección más relevante al cambiar la selección (calma por defecto).
  useEffect(() => {
    if (selectedGroupIds.size === 0) setInspectorSection(null);
    else if (showUnionesSection) setInspectorSection("uniones");
    else setInspectorSection(null);
    // Sólo al cambiar la selección o sus uniones, no al alternar secciones.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGroupIds, showUnionesSection]);

  const handleBulkYieldOthers = useCallback(
    (useFullFacade: boolean) => {
      if (!facadeRefGroup || facadeReferenceResolved < 0) return;
      if (
        countBulkYieldOthersJoints(
          facadeRefGroup,
          phase1.groups,
          wallWallList,
          wallIdAliasMap,
          facadeReferenceResolved,
          !useFullFacade,
        ) === 0
      )
        return;
      pushHistory();
      const result = applyBulkYieldOthersDecisions(
        wallWallDecisions,
        facadeRefGroup,
        phase1.groups,
        wallWallList,
        wallIdAliasMap,
        facadeReferenceResolved,
        !useFullFacade,
      );
      setWallWallDecisions(result.next);
      if (result.updated > 0) {
        setBulkActionNotice(
          `Se actualizaron ${result.updated} cruce${result.updated !== 1 ? "s" : ""}: las otras paredes se acortan`,
        );
        window.setTimeout(() => setBulkActionNotice(null), 4000);
      }
    },
    [
      facadeRefGroup,
      facadeReferenceResolved,
      phase1.groups,
      wallWallList,
      wallWallDecisions,
      wallIdAliasMap,
      pushHistory,
    ],
  );

  const handleMergeCoplanarFacade = useCallback(() => {
    if (
      !selectedGroup ||
      coplanarFacadeIds.length < 2 ||
      !canMergeCoplanarFacade
    )
      return;
    const cluster = coplanarFacadeIds.filter((id) =>
      phase1.groups.some((g) => g.id === id),
    );
    if (cluster.length < 2) return;
    const resolvedCluster = new Set(
      cluster.map((id) => resolveWallId(id, wallIdAliasMap)),
    );
    const nextMerges = merges.filter(
      (c) =>
        !c.some((id) => resolvedCluster.has(resolveWallId(id, wallIdAliasMap))),
    );
    nextMerges.push(cluster);
    onReplaceMerges(nextMerges);
    const survivorId =
      findMergeSurvivorId(cluster, phase1.groups) ?? cluster[0];
    setSelectedGroupIds(new Set([survivorId]));
    setMergeMemberFocusId(null);
    setEncountersWallId(survivorId);
    setContextMenu(null);
    setBulkActionNotice(`Fusionando ${cluster.length} paredes de la fachada…`);
    window.setTimeout(() => setBulkActionNotice(null), 4000);
  }, [
    selectedGroup,
    coplanarFacadeIds,
    canMergeCoplanarFacade,
    merges,
    onReplaceMerges,
    phase1.groups,
    wallIdAliasMap,
  ]);

  // Abrir panel de encuentros al seleccionar una pared con cruces (solo si aún no está abierto).
  // Si la selección es una pieza derivada de un corte (id negativo), se remonta a
  // la pared original (los encuentros pared-pared viven en ids originales).
  useEffect(() => {
    if (selectedGroupIds.size !== 1) return;
    const rawId = Array.from(selectedGroupIds)[0];
    const id = cutGroupOwnerId(rawId);
    const hasJoints = wallWallList.some(
      ({ ww }) => ww.groupA === id || ww.groupB === id,
    );
    if (hasJoints) {
      setEncountersWallId((cur) => cur ?? id);
    }
  }, [selectedGroupIds, wallWallList]);

  useEffect(() => {
    if (selectedGroupIds.size === 0) setEncountersWallId(null);
  }, [selectedGroupIds.size]);

  // Floating reference labels for the selected joint: one per wall of the joint,
  // anchored at each wall's centroid and tagged with its panel id (A#/B#).
  const leaderMarkers = useMemo<LeaderMarker[]>(() => {
    if (selectedJointIndex == null) return [];
    const ww = phase1.wallWallJoints.find(
      (w) => w.jointIndex === selectedJointIndex,
    );
    if (!ww) return [];
    const effYielder =
      wallWallDecisions.get(ww.jointIndex) ?? ww.suggestedYieldGroupId;
    const byId = new Map(phase1.groups.map((g) => [g.id, g]));
    const out: LeaderMarker[] = [];
    for (const gid of [ww.groupA, ww.groupB]) {
      const resolved = resolveWallId(gid, wallIdAliasMap);
      const g = byId.get(resolved) ?? byId.get(gid);
      if (!g) continue;
      const yields = yielderMatchesWall(effYielder, gid, wallIdAliasMap);
      out.push({
        groupId: g.id,
        anchor: g.centroid,
        label: panelIdByGroup.get(gid) ?? panelIdByGroup.get(g.id) ?? "",
        primary: !yields,
      });
    }
    return out;
  }, [
    selectedJointIndex,
    phase1,
    panelIdByGroup,
    wallWallDecisions,
    wallIdAliasMap,
  ]);

  // ---------------------------------------------------------------------------
  // Assembly guide
  // ---------------------------------------------------------------------------

  const loadAssemblyPreview = useCallback(async (forceApi = false) => {
    setAssemblyLoading(true);
    setAssemblyError(null);
    try {
      if (!forceApi && assemblyGuideData) {
        setAssemblyData(assemblyGuideData);
        return;
      }
      if (!onRequestAssemblyPreview) return;
      const overrideList: ClassificationOverride[] = [];
      for (const [groupId, newCategory] of overrides.entries()) {
        overrideList.push({ groupId, newCategory });
      }
      const data = await onRequestAssemblyPreview({
        overrides: overrideList,
        wallWallDecisions,
        marks: [...markGroupIds],
        userCuts,
      });
      setAssemblyData(data);
      setAssemblyGuideData(data);
    } catch (err: unknown) {
      setAssemblyError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setAssemblyLoading(false);
    }
  }, [
    assemblyGuideData,
    onRequestAssemblyPreview,
    overrides,
    wallWallDecisions,
    markGroupIds,
    userCuts,
    setAssemblyGuideData,
  ]);

  const assemblyAutoOpenRef = useRef(false);
  useEffect(() => {
    if (!openAssemblyInstructivo || assemblyAutoOpenRef.current) return;
    assemblyAutoOpenRef.current = true;
    setAssemblyWindowOpen(true);
  }, [openAssemblyInstructivo]);

  // Recargar siempre al abrir la ventana — refleja overrides, cortes y fusiones actuales.
  useEffect(() => {
    if (!assemblyWindowOpen) return;
    if (!onRequestAssemblyPreview && !assemblyGuideData) return;
    void loadAssemblyPreview();
  }, [assemblyWindowOpen, onRequestAssemblyPreview, assemblyGuideData, loadAssemblyPreview]);

  const viewToolBtn =
    "btn btn-sm btn-ghost h-9 min-h-9 w-9 px-0 rounded-lg hover:bg-base-200/80";

  // Unified tool selector for BottomToolbar
  const handleSelectTool = useCallback(
    (tool: "cursor" | "box" | "cut" | "measure" | "markLine" | "rib" | "angle") => {
      // Always clear all drafts first
      setCutDraft(null);
      setMeasureDraft(null);
      setMarkLineDraft(null);
      setRibGhost(null);
      setAngleDraft(null);
      switch (tool) {
        case "cursor":
          setCutToolMode(false);
          setMeasureToolMode(false);
          setMarkLineToolMode(false);
          setBoxSelectMode(false);
          setRibToolMode(false);
          setAngleMeasureMode('off');
          break;
        case "box":
          setCutToolMode(false);
          setMeasureToolMode(false);
          setMarkLineToolMode(false);
          setBoxSelectMode((s) => !s);
          setRibToolMode(false);
          setAngleMeasureMode('off');
          break;
        case "cut":
          setMeasureToolMode(false);
          setMarkLineToolMode(false);
          setBoxSelectMode(false);
          setRibToolMode(false);
          setAngleMeasureMode('off');
          setCutToolMode((active) => {
            if (!active) return true;
            setCutShapeKind((shape) => nextCutShape(shape));
            return true;
          });
          break;
        case "measure":
          setCutToolMode(false);
          setMarkLineToolMode(false);
          setBoxSelectMode(false);
          setRibToolMode(false);
          setAngleMeasureMode('off');
          setMeasureToolMode((active) => {
            if (!active) return true;
            // Already active → cycle shape: line → rect → line…
            setMeasureDraft(null);
            setMeasureShapeKind((shape) => nextMeasureShape(shape));
            return true;
          });
          break;
        case "markLine":
          setCutToolMode(false);
          setMeasureToolMode(false);
          setBoxSelectMode(false);
          setRibToolMode(false);
          setAngleMeasureMode('off');
          setMarkLineToolMode((active) => {
            if (!active) return true;
            // Already active → cycle mode: straight → freehand → rect → circle…
            setMarkLineDraft(null);
            setMarkLineMode((mm) => nextMarkLineMode(mm));
            return true;
          });
          break;
        case "rib":
          setCutToolMode(false);
          setMeasureToolMode(false);
          setMarkLineToolMode(false);
          setBoxSelectMode(false);
          setAngleMeasureMode('off');
          setRibToolMode((v) => !v);
          break;
        case "angle":
          setCutToolMode(false);
          setMeasureToolMode(false);
          setMarkLineToolMode(false);
          setBoxSelectMode(false);
          setRibToolMode(false);
          setAngleMeasureMode((m) => m === "off" ? "line" : m === "line" ? "panels" : "off");
          break;
      }
    },
    [setCutDraft, setMeasureDraft, setMarkLineDraft, setRibGhost],
  );

  const handleCycleCutShape = useCallback(() => {
    setCutShapeKind((shape) => nextCutShape(shape));
    setCutDraft(null);
  }, []);

  // Derive current active tool name for BottomToolbar
  const currentActiveTool: "cursor" | "box" | "cut" | "measure" | "markLine" | "rib" | "angle" =
    cutToolMode
      ? "cut"
      : measureToolMode
        ? "measure"
        : markLineToolMode
          ? "markLine"
          : ribToolMode
            ? "rib"
            : angleMeasureMode !== "off"
              ? "angle"
              : boxSelectMode
                ? "box"
                : "cursor";

  // Box selection pointer handlers — placed after phase1 & hiddenGroupIds
  const handleBoxPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      boxDragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        active: true,
      };
      setDragRect(null);
    },
    [],
  );

  const handleBoxPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!boxDragRef.current.active) return;
      const { startX, startY } = boxDragRef.current;
      setDragRect({
        x: Math.min(startX, e.clientX),
        y: Math.min(startY, e.clientY),
        w: Math.abs(e.clientX - startX),
        h: Math.abs(e.clientY - startY),
      });
    },
    [],
  );

  const handleBoxPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!boxDragRef.current.active) return;
      boxDragRef.current.active = false;
      const rect = dragRect;
      setDragRect(null);

      if (!rect || rect.w < 6 || rect.h < 6) return;

      const selected = viewerRef.current?.selectGroupsInRect(
        rect.x,
        rect.y,
        rect.w,
        rect.h,
        hiddenGroupIds,
      );

      if (selected && selected.size > 0) {
        setSelectedGroupIds(selected);
        setSelectedJointIndex(null);
      }
    },
    [dragRect, hiddenGroupIds],
  );

  // Keyboard shortcut: F to merge selected groups
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      )
        return;

      // En modo caminar, WASD/flechas son navegación (los maneja el visor): no
      // dispares atajos de herramientas. Esc sale del modo.
      if (walkMode) {
        if (e.key === "Escape") {
          e.preventDefault();
          setWalkMode(false);
        }
        return;
      }

      if (e.key === "c" || e.key === "C") {
        e.preventDefault();
        setMeasureToolMode(false);
        setMeasureDraft(null);
        setBoxSelectMode(false);
        setMarkLineToolMode(false);
        setMarkLineDraft(null);
        setCutToolMode((prev) => {
          if (!prev) return true;
          setCutDraft(null);
          setCutShapeKind((shape) => nextCutShape(shape));
          return true;
        });
        return;
      }

      if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        setCutToolMode(false);
        setCutDraft(null);
        setBoxSelectMode(false);
        setMarkLineToolMode(false);
        setMarkLineDraft(null);
        setMeasureToolMode((prev) => {
          if (!prev) return true;
          // Already active → cycle through shapes: line → rect → line…
          setMeasureDraft(null);
          setMeasureShapeKind((shape) => nextMeasureShape(shape));
          return true;
        });
        return;
      }

      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        setCutToolMode(false);
        setCutDraft(null);
        setMeasureToolMode(false);
        setMeasureDraft(null);
        setBoxSelectMode(false);
        setMarkLineDraft(null);
        setMarkLineToolMode((prev) => {
          if (!prev) return true;
          // Already active → cycle: straight → freehand → rect → circle → straight…
          setMarkLineMode((mm) => nextMarkLineMode(mm));
          return true;
        });
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedMeasureId) {
          e.preventDefault();
          handleRemoveMeasure(selectedMeasureId);
          return;
        }
        if (measureToolMode && measures.length > 0) {
          e.preventDefault();
          setMeasures((prev) => prev.slice(0, -1));
          return;
        }
        if (markLineToolMode && savedMarkLines.length > 0) {
          e.preventDefault();
          setSavedMarkLines(savedMarkLines.slice(0, -1));
          return;
        }
      }

      if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        setCutToolMode(false);
        setCutDraft(null);
        setMeasureToolMode(false);
        setMeasureDraft(null);
        setMarkLineToolMode(false);
        setMarkLineDraft(null);
        setBoxSelectMode((prev) => !prev);
        return;
      }

      if (e.key === "v" || e.key === "V") {
        e.preventDefault();
        setCutToolMode(false);
        setCutDraft(null);
        setMeasureToolMode(false);
        setMeasureDraft(null);
        setMarkLineToolMode(false);
        setMarkLineDraft(null);
        setBoxSelectMode(false);
        return;
      }

      if (e.key === "d" || e.key === "D") {
        if (canSplitMerged) {
          e.preventDefault();
          handleDivideMerged();
        }
        return;
      }

      if ((e.key === "f" || e.key === "F") && canMergeSelected) {
        e.preventDefault();
        handleMergeSelected();
        return;
      }

      if ((e.key === "n" || e.key === "N") && selectedGroupIds.size === 1) {
        e.preventDefault();
        handleStartNote();
        return;
      }

      if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        setCutToolMode(false);
        setCutDraft(null);
        setMeasureToolMode(false);
        setMeasureDraft(null);
        setMarkLineToolMode(false);
        setMarkLineDraft(null);
        setBoxSelectMode(false);
        setRibToolMode(false);
        setAngleMeasureMode((m) => m === "off" ? "line" : m === "line" ? "panels" : "off");
        return;
      }

      if (e.key === "z" || e.key === "Z") {
        // Encuadrar (sin Ctrl/Cmd, que es deshacer). Selección o todo.
        if (e.ctrlKey || e.metaKey) return;
        e.preventDefault();
        triggerCamera(selectedGroupIds.size > 0 ? "frameSelection" : "frameAll");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    canMergeSelected,
    handleMergeSelected,
    canSplitMerged,
    handleDivideMerged,
    handleStartNote,
    measureToolMode,
    selectedMeasureId,
    handleRemoveMeasure,
    measures.length,
    triggerCamera,
    selectedGroupIds,
    walkMode,
    markLineToolMode,
    savedMarkLines,
    setSavedMarkLines,
  ]);

  const [showWallWallHelp2, setShowWallWallHelp2] = useState(false);

  const wallWallHelp2Title = useMemo(() => {
    return showWallWallHelp2 ? "Ocultar ayuda" : "¿Qué es esto?";
  }, [showWallWallHelp2]);

  return (
    <div className="fixed top-0 left-0 right-0 bottom-[var(--flow-bar-h,3.5rem)] z-50 bg-base-200/40 flex overflow-hidden">
      <PanelGroup orientation="horizontal" id="review-screen-layout">
        {!hideSidebar && (
          <>
            <Panel defaultSize={350} minSize={250} maxSize={500} className="flex flex-col shrink-0 h-[42vh] md:h-full z-20 shadow-2xl shadow-base-content/5 bg-base-100">
              <aside data-tour="inspector" className="w-full h-full flex flex-col border-t md:border-t-0 md:border-r border-base-300/40">
          <div className="px-4 pt-4 pb-3 border-b border-base-300/30 shrink-0 bg-base-100/80 text-primary font-semibold tracking-widest">
            <StepIndicator current="review" variant="compact" />
          </div>

          {bulkActionNotice && (
            <div className="px-4 py-2 border-b border-base-300/30 bg-success/5">
              <p className="text-[11px] text-success font-medium px-2 py-1.5 rounded-lg bg-success/10 border border-success/20">
                {bulkActionNotice}
              </p>
            </div>
          )}

          {/* Inspector: contexto de la selección (una sección a la vez) */}
          <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar flex flex-col">
            {selectedGroupIds.size === 0 && (
              <div className="flex flex-col items-center justify-center flex-1 text-center px-6 gap-2 text-base-content/50 py-12">
                <ScanSearch size={26} className="text-base-content/25" />
                <p className="text-sm">Seleccioná un componente en el modelo 3D</p>
                <p className="text-xs text-base-content/35">
                  Sus propiedades y herramientas aparecen acá.
                </p>
              </div>
            )}

            {selectedGroupIds.size >= 1 && (
              <div className="px-4 py-3 border-b border-base-300/30 bg-base-100/70 shrink-0">
                {selectedGroupIds.size === 1 && selectedGroup ? (
                  <div className="flex items-center gap-2.5">
                    <span
                      className="h-3.5 w-3.5 shrink-0 rounded-full ring-1 ring-base-content/15"
                      style={{
                        background:
                          SELECTION_DOT[getEffectiveCategory(selectedGroup, overrides)],
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-semibold text-base-content leading-tight">
                        {selectedGroup.label}
                      </h3>
                      <p className="text-[11px] text-base-content/45 mt-0.5">
                        {CATEGORY_LABEL_ES[getEffectiveCategory(selectedGroup, overrides)]}
                        {" · "}
                        {selectedGroup.totalArea.toFixed(1)} m²
                      </p>
                    </div>
                    {panelIdByGroup.get(selectedGroup.id) && (
                      <span className="font-mono text-[10px] text-base-content/45 bg-base-100 border border-base-300/40 px-1 rounded shrink-0">
                        {panelIdByGroup.get(selectedGroup.id)}
                      </span>
                    )}
                  </div>
                ) : (
                  <p className="text-sm font-semibold text-base-content">
                    {selectedGroupIds.size} componentes seleccionados
                  </p>
                )}
              </div>
            )}
            {selectedGroupIds.size >= 1 && (
              <InspectorSection
                icon={<StickyNote size={14} />}
                title="Notas"
                badge={notasBadge}
                open={inspectorSection === "notas"}
                onToggle={() => toggleInspector("notas")}
              >
                <div className="px-4 py-3 bg-base-100/60">
                  <GroupNotesPanel
                notes={groupNotes}
                selectedComponentId={selectedNoteComponentId}
                selectedComponentLabel={
                  selectedNoteComponentId != null
                    ? componentLabelsForNotes.get(selectedNoteComponentId) ??
                      selectedGroup?.label
                    : undefined
                }
                selectedCutId={activeNoteCutId}
                selectedCutLabel={
                  activeNoteCutId != null
                    ? cutLabelsForNotes.get(activeNoteCutId)
                    : undefined
                }
                componentLabels={componentLabelsForNotes}
                cutLabels={cutLabelsForNotes}
                onChange={setGroupNotes}
                onSelectComponent={(cid) => {
                  handleSelectGroup(cid);
                  setSidebarTab("seleccion");
                }}
                onSelectCut={(gid, cutId) => {
                  setSelectedGroupIds(new Set([gid]));
                  setSelectedCutId(cutId);
                  setSidebarTab("seleccion");
                }}
                focusDraftKey={noteFocusKey}
              />
                </div>
              </InspectorSection>
            )}

            {/* Curvado: kerf/auxético — sólo en paredes */}
            {showCurvadoSection && (
              <InspectorSection
                icon={<Spline size={14} />}
                title="Curvado"
                open={inspectorSection === "curvado"}
                onToggle={() => toggleInspector("curvado")}
              >
            {selectedGroupIds.size === 1 && (() => {
              const gid = Array.from(selectedGroupIds)[0];
              const dg = displayGroups.find((gr) => gr.id === gid);
              // Flex es para paredes/superficies a plegar, no pisos/horizontales.
              if (!dg || dg.category !== "wall") return null;
              const pid = panelIdByGroup.get(gid);
              const lbl = dg.label ?? (pid ? `Panel ${pid}` : `Pieza ${gid}`);
              // Aviso si la selección es una fusión de paredes no coplanares.
              let coplanarWarning = false;
              if (displayMergeMembers.length >= 2) {
                const normals = displayMergeMembers
                  .map((id) => phase1.groups.find((gr) => gr.id === id)?.representativeNormal)
                  .filter((n): n is NonNullable<typeof n> => n != null);
                coplanarWarning = maxNormalSpreadDeg(normals) > 15;
              }
              return (
                <FlexControls
                  groupId={gid}
                  label={lbl}
                  coplanarWarning={coplanarWarning}
                  curvature={phase1.curvature?.[gid]}
                />
              );
            })()}
              </InspectorSection>
            )}

            {/* Refuerzos estructurales: nervios (cartelas) y columnas */}
            {selectedGroupIds.size >= 1 && (
              <InspectorSection
                icon={<Wrench size={14} />}
                title="Refuerzos"
                open={inspectorSection === "refuerzos"}
                onToggle={() => toggleInspector("refuerzos")}
              >
            <div className="px-4 py-3 space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-base-content/50">
                Refuerzos estructurales
              </p>
              <button
                type="button"
                onClick={() => {
                  setRibGhost(null);
                  setRibToolMode((v) => {
                    const next = !v;
                    if (next) {
                      // Apagar las demás herramientas (una sola activa).
                      setCutToolMode(false);
                      setCutDraft(null);
                      setMeasureToolMode(false);
                      setMeasureDraft(null);
                      setMarkLineToolMode(false);
                      setMarkLineDraft(null);
                      setBoxSelectMode(false);
                    }
                    return next;
                  });
                }}
                className={`btn btn-xs rounded-lg w-full ${
                  ribToolMode ? "btn-warning" : ""
                }`}
                title="Pasá el mouse cerca de una esquina pared-piso: aparece el nervio fantasma y el click lo fija"
              >
                🧲 Colocar nervio {ribToolMode ? "(activo — click en una esquina)" : ""}
              </button>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  disabled={!canAddRib}
                  onClick={handleAddRib}
                  className="btn btn-xs rounded-lg flex-1 disabled:opacity-40"
                  title="Alternativa: cartela en la unión de 2 paredes ⊥ seleccionadas"
                >
                  + Nervio
                </button>
                <button
                  type="button"
                  disabled={!canAddColumn}
                  onClick={handleAddColumn}
                  className="btn btn-xs rounded-lg flex-1 disabled:opacity-40"
                  title="Columna estructural en el componente seleccionado"
                >
                  + Columna
                </button>
              </div>
              <p className="text-[10px] text-base-content/40 leading-snug">
                🧲 acercate a una junta pared-piso y aparece el nervio (cartela de 20×20 mm de
                maqueta). Alternativa: 2 paredes ⊥ + &quot;+ Nervio&quot;. El preview (ámbar) es
                esquemático; el backend genera la pieza real.
              </p>
              {(savedRibs.length > 0 || savedColumns.length > 0) && (
                <ul className="space-y-0.5 pt-0.5">
                  {savedRibs.map((r) => {
                    const physMm = Math.round((r.sizeM / Math.max(scale, 1)) * 1000);
                    return (
                    <li key={r.id} className="text-[11px] text-base-content/70">
                      <div className="flex items-center justify-between">
                        <span>
                          Nervio · {panelIdByGroup.get(r.groupA) ?? r.groupA}·
                          {panelIdByGroup.get(r.groupB) ?? r.groupB}
                        </span>
                        <button
                          type="button"
                          className="text-base-content/40 hover:text-error px-1"
                          onClick={() => setSavedRibs(removeRib(savedRibs, r.id))}
                          aria-label="Quitar nervio"
                        >
                          ✕
                        </button>
                      </div>
                      <label className="flex items-center gap-1.5 pl-1 pb-0.5">
                        <span className="text-[9px] text-base-content/40 shrink-0">posición</span>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.02}
                          value={r.t}
                          onChange={(e) => handleSetRibT(r.id, Number(e.target.value))}
                          className="range range-xs range-warning flex-1"
                        />
                      </label>
                      <label className="flex items-center gap-1.5 pl-1 pb-0.5">
                        <span className="text-[9px] text-base-content/40 shrink-0">tamaño mm</span>
                        <input
                          type="number"
                          min={10}
                          max={80}
                          step={1}
                          value={physMm}
                          onChange={(e) => handleSetRibSize(r.id, Number(e.target.value))}
                          className="input input-xs input-bordered w-16 font-mono text-[11px] rounded-lg"
                        />
                      </label>
                    </li>
                    );
                  })}
                  {savedColumns.map((c) => (
                    <li
                      key={c.id}
                      className="flex items-center justify-between text-[11px] text-base-content/70"
                    >
                      <span>Columna</span>
                      <button
                        type="button"
                        className="text-base-content/40 hover:text-error px-1"
                        onClick={() => setSavedColumns(removeColumn(savedColumns, c.id))}
                        aria-label="Quitar columna"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
              </InspectorSection>
            )}

            {/* Uniones: fusión, encuentros pared-pared y fachada */}
            {showUnionesSection && (
              <InspectorSection
                icon={<Link2 size={14} />}
                title="Uniones"
                badge={unionesBadge}
                open={inspectorSection === "uniones"}
                onToggle={() => toggleInspector("uniones")}
              >
            {selectedGroupIds.size === 1 && displayMergeMembers.length >= 2 && (
              <div className="px-4 py-3 border-b border-base-300/30 bg-primary/5 space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-primary/60">
                  Fusionada · {displayMergeMembers.length} pared
                  {displayMergeMembers.length !== 1 ? "es" : ""}
                </p>
                <div className="flex flex-col gap-1">
                  {displayMergeMembers.map((id) => {
                    const g = phase1.groups.find((gr) => gr.id === id);
                    const isFocused =
                      mergeMemberFocusId != null && id === mergeMemberFocusId;
                    const pid = panelIdByGroup.get(id);
                    const label =
                      g?.label ?? (pid ? `Panel ${pid}` : `Pared ${id}`);
                    return (
                      <div
                        key={id}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs cursor-pointer transition-colors border ${
                          isFocused
                            ? "bg-primary/10 border-primary/25 text-primary font-medium"
                            : "bg-base-200/50 border-base-300/20 text-base-content/70 hover:bg-base-200/70"
                        }`}
                        onClick={() => {
                          setMergeMemberFocusId(id);
                          setEncountersWallId(id);
                          setSelectedJointIndex(null);
                          const survivorId = findMergeSurvivorId(
                            selectedMergeCluster ?? displayMergeMembers,
                            phase1.groups,
                          );
                          if (survivorId != null) {
                            setSelectedGroupIds(new Set([survivorId]));
                          }
                        }}
                        title="Click para enfocar y ver encuentros"
                      >
                        <Link2 size={10} className="shrink-0 opacity-60" />
                        <span className="flex-1 truncate">{label}</span>
                        {pid && (
                          <span className="font-mono text-[10px] text-base-content/45 bg-base-100 border border-base-300/40 px-1 rounded">
                            {pid}
                          </span>
                        )}
                        {isFocused && (
                          <span className="text-[10px] opacity-70">
                            seleccionada
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {selectedMergeIndex >= 0 && (
                  <div className="flex flex-col gap-2 pt-0.5">
                    <button
                      type="button"
                      className="btn btn-outline btn-sm w-full rounded-xl gap-2 border-error/40 text-error hover:bg-error/10 hover:border-error"
                      onClick={handleDivideMerged}
                      title="Separa todas las paredes de esta fusión de una vez"
                    >
                      <SquareSplitHorizontal size={14} />
                      {divideAllLabel}
                      <span className="text-[10px] opacity-60 font-normal">
                        · D
                      </span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline btn-sm w-full rounded-xl gap-2 border-error/30 text-base-content/80 hover:border-error hover:text-error"
                      onClick={handleRemoveSelectedFromMerge}
                      title={
                        mergeMemberFocusId != null
                          ? "Saca la pared seleccionada (arriba) de la fusión y deja el resto fusionado"
                          : "Saca la primera pared de la lista; clic en una pared arriba para elegir cuál"
                      }
                    >
                      <X size={14} />
                      Desfusionar solo esta pared
                      {mergeMemberFocusId != null && (
                        <span className="font-mono text-[10px] opacity-50 truncate max-w-[5rem]">
                          {panelIdByGroup.get(mergeMemberFocusId) ??
                            `#${mergeMemberFocusId}`}
                        </span>
                      )}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Encuentros pared-pared */}
            {encountersWallId != null &&
              (() => {
                const memberCluster = findMergeClusterForGroupId(
                  encountersWallId,
                  merges,
                  phase1.groups,
                );
                const survivorId =
                  (memberCluster
                    ? findMergeSurvivorId(memberCluster, phase1.groups)
                    : null) ?? encountersWallId;
                const selGroup = phase1.groups.find((g) => g.id === survivorId);
                if (!selGroup) return null;

                const facadeIdSet = new Set(coplanarFacadeIds);
                const groupWWJoints = wallWallList.filter(({ ww }) => {
                  if (!facadeRefGroup) return false;
                  if (
                    facadeJointSides(
                      ww,
                      facadeRefGroup,
                      phase1.groups,
                      wallIdAliasMap,
                      facadeReferenceResolved,
                    )
                  ) {
                    return true;
                  }
                  return (
                    facadeIdSet.has(ww.groupA) ||
                    facadeIdSet.has(ww.groupB) ||
                    wallInPriority(ww.groupA, facadeIdSet, wallIdAliasMap) ||
                    wallInPriority(ww.groupB, facadeIdSet, wallIdAliasMap)
                  );
                });
                if (groupWWJoints.length === 0) return null;

                const groupById = new Map(phase1.groups.map((g) => [g.id, g]));
                const selPid =
                  panelIdByGroup.get(encountersWallId) ??
                  panelIdByGroup.get(survivorId);
                const cm = (m: number) =>
                  `${(m * 100).toFixed(1).replace(".", ",")} cm`;

                return (
                  <div className="px-4 py-3 border-b border-base-300/30 bg-base-100/60">
                    <div className="flex items-center gap-2.5">
                      <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 text-primary shrink-0">
                        <Link2 size={16} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-semibold leading-tight flex items-center  gap-1.5">
                          {coplanarFacadeIds.length > 1
                            ? "Encuentros de la fachada"
                            : "Encuentros de esta pared"}
                          {selPid && (
                            <span className="font-mono text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                              {selPid}
                            </span>
                          )}
                        </h3>
                        {showWallWallHelp && (
                          <p className="text-xs text-base-content/60 mt-1 leading-snug">
                            Donde dos paredes se cruzan, al armar la maqueta se
                            pisarían por el espesor del material. Una se acorta
                            para que encajen. Elegí cuál se acorta
                            <span className="text-base-content/45">
                              {" "}
                              (ya sugerimos una).
                            </span>
                          </p>
                        )}
                        <p className="text-[11px] text-base-content/45 mt-1.5 leading-snug border-l-2 border-base-300/40 pl-2">
                          La vista 3D muestra el modelo original. El acorte (p.
                          ej. −10,2 cm) se aplica al plano de corte, no recorta
                          la geometría acá. Naranja = manda · Azul = se acorta.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowWallWallHelp((v) => !v)}
                        className={`flex items-center justify-center w-7 h-7 rounded-lg shrink-0 transition-colors ${
                          showWallWallHelp
                            ? "text-warning bg-warning/15"
                            : "text-base-content/40 hover:bg-base-200/80 hover:text-base-content/70"
                        }`}
                        aria-label="Mostrar ayuda"
                        aria-pressed={showWallWallHelp}
                        title={
                          showWallWallHelp ? "Ocultar ayuda" : "¿Qué es esto?"
                        }
                      >
                        <Lightbulb size={15} />
                      </button>
                    </div>

                    {/* Fachada coplanar: fusionar y/o acortar perpendiculares en bloque */}
                    {showFacadeActions && selectedGroup && (
                      <div className="px-4 py-3 border-b border-base-300/30 mt-4 bg-info/5 space-y-2">
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-secondary/70 flex items-center justify-between">
                          Fachada coplanar
                          <span className="ml-1.5 font-normal normal-case text-base-content/45">
                            · {selectedGroup.orientation}
                          </span>
                          <button
                            type="button"
                            className="btn btn-outline btn-sm  rounded-xl gap-2 border-base-300/50 text-base-content/70"
                            onClick={() => setShowWallWallHelp2((v) => !v)}
                            title={
                              showWallWallHelp
                                ? "Ocultar ayuda"
                                : "¿Qué es esto?"
                            }
                          >
                            <Lightbulb size={15} />
                          </button>
                        </p>

                        {showWallWallHelp2 && (
                          <p className="text-[11px] text-base-content/50 leading-snug">
                            Unificá el frente en un solo panel o hacé que{" "}
                            {coplanarFacadeIds.length > 1
                              ? "estas paredes"
                              : "esta pared"}{" "}
                            mande en los cruces — las perpendiculares se
                            acortan.
                          </p>
                        )}

                        <div className="flex flex-col gap-2">
                          {canMergeCoplanarFacade && (
                            <button
                              type="button"
                              className="btn btn-primary btn-sm w-full rounded-xl gap-2"
                              onClick={handleMergeCoplanarFacade}
                              title="Fusiona todas las paredes del mismo plano en un solo panel de corte"
                            >
                              <Link2 size={14} />
                              Fusionar toda la fachada ·{" "}
                              {coplanarFacadeIds.length} paredes
                            </button>
                          )}
                          {coplanarFacadeIds.length > 1 &&
                            bulkYieldCountForFacade > 0 && (
                              <button
                                type="button"
                                className="btn btn-outline btn-sm w-full rounded-xl gap-2 border-info/40 text-base-content/90 hover:border-info hover:bg-info/10"
                                onClick={() => handleBulkYieldOthers(true)}
                                title="En cada cruce con una pared perpendicular, la otra se acorta"
                              >
                                <Scissors size={14} />
                                Acortar las otras en toda la fachada ·{" "}
                                {bulkYieldCountForFacade} cruces
                              </button>
                            )}
                          {bulkYieldCountForWall > 0 &&
                            coplanarFacadeIds.length === 1 && (
                              <button
                                type="button"
                                className="btn btn-outline btn-sm w-full rounded-xl gap-2 border-base-300/50 text-base-content/70 hover:border-info/40"
                                onClick={() => handleBulkYieldOthers(false)}
                                title="En cada cruce con una pared perpendicular, la otra se acorta"
                              >
                                <Scissors size={14} />
                                Acortar las otras en todos los cruces ·{" "}
                                {bulkYieldCountForWall}
                              </button>
                            )}
                        </div>
                      </div>
                    )}

                    <div className="mt-3 flex flex-col gap-2.5">
                      {groupWWJoints.map(
                        ({ ww, labelA, labelB, pidA, pidB, hasThickness }) => {
                          const sides =
                            facadeRefGroup &&
                            facadeJointSides(
                              ww,
                              facadeRefGroup,
                              phase1.groups,
                              wallIdAliasMap,
                              facadeReferenceResolved,
                            );
                          const fallbackSides = (() => {
                            const aOn = wallInPriority(
                              ww.groupA,
                              facadeIdSet,
                              wallIdAliasMap,
                            );
                            const bOn = wallInPriority(
                              ww.groupB,
                              facadeIdSet,
                              wallIdAliasMap,
                            );
                            if (aOn && !bOn) {
                              return {
                                facadeId: ww.groupA,
                                otherId: ww.groupB,
                              };
                            }
                            if (bOn && !aOn) {
                              return {
                                facadeId: ww.groupB,
                                otherId: ww.groupA,
                              };
                            }
                            return {
                              facadeId: survivorId,
                              otherId:
                                ww.groupA === survivorId
                                  ? ww.groupB
                                  : ww.groupA,
                            };
                          })();
                          const { facadeId: thisId, otherId } =
                            sides ?? fallbackSides;
                          const thisLabel =
                            ww.groupA === thisId ? labelA : labelB;
                          const otherLabel =
                            ww.groupA === thisId ? labelB : labelA;
                          const thisPid = ww.groupA === thisId ? pidA : pidB;
                          const otherPid = ww.groupA === thisId ? pidB : pidA;
                          const effYielder =
                            wallWallDecisions.get(ww.jointIndex) ??
                            ww.suggestedYieldGroupId;
                          const suggested = ww.suggestedYieldGroupId;
                          const isOpen = selectedJointIndex === ww.jointIndex;

                          const thisResolved = resolveWallId(
                            thisId,
                            wallIdAliasMap,
                          );
                          const otherResolved = resolveWallId(
                            otherId,
                            wallIdAliasMap,
                          );
                          const thisThick =
                            groupById.get(thisResolved)?.thickness ?? 0;
                          const otherThick =
                            groupById.get(otherResolved)?.thickness ?? 0;
                          const trimIfThis =
                            otherThick > 0.001
                              ? otherThick
                              : thisThick > 0.001
                                ? thisThick
                                : 0;
                          const trimIfOther =
                            thisThick > 0.001
                              ? thisThick
                              : otherThick > 0.001
                                ? otherThick
                                : 0;

                          return (
                            <div
                              key={ww.jointIndex}
                              onClick={() =>
                                setSelectedJointIndex((cur) =>
                                  cur === ww.jointIndex ? null : ww.jointIndex,
                                )
                              }
                              className={`rounded-xl border p-3 cursor-pointer transition-all ${
                                isOpen
                                  ? "border-primary/50 bg-primary/5 ring-1 ring-primary/20"
                                  : "border-base-300/50 bg-base-200/30 hover:bg-base-200/50 hover:border-base-300/70"
                              }`}
                            >
                              <div className="flex items-center gap-1.5 text-sm font-medium">
                                <span className="text-base-content/50">
                                  Cruce con
                                </span>
                                {otherPid && (
                                  <span className="font-mono text-xs bg-base-100 border border-base-300/50 px-1.5 py-0.5 rounded">
                                    {otherPid}
                                  </span>
                                )}
                                <span className="truncate text-base-content/80">
                                  {otherLabel}
                                </span>
                              </div>

                              {!hasThickness ? (
                                <p className="mt-2 text-xs text-base-content/55 px-2.5 py-2 rounded-lg bg-base-100/80 border border-base-300/40">
                                  Sin ajuste necesario — no se detectó espesor
                                  en ninguna de las dos.
                                </p>
                              ) : (
                                <div className="mt-2.5 flex flex-col gap-1.5">
                                  <p className="text-xs font-medium text-base-content/55">
                                    ¿Cuál se acorta?
                                  </p>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleWallWallDecision(
                                        ww.jointIndex,
                                        thisId,
                                      );
                                    }}
                                    className={`flex items-center gap-2 w-full text-left rounded-lg border px-3 py-2 transition-colors ${
                                      yielderMatchesWall(
                                        effYielder,
                                        thisId,
                                        wallIdAliasMap,
                                      )
                                        ? "border-primary bg-primary/10"
                                        : "border-base-300/50 bg-base-100 hover:bg-base-200/60"
                                    }`}
                                  >
                                    <span
                                      className="w-2.5 h-2.5 rounded-full shrink-0"
                                      style={{ backgroundColor: "#f59e0b" }}
                                    />
                                    <span className="flex-1 text-sm">
                                      Esta pared{" "}
                                      {thisPid && (
                                        <span className="font-mono text-xs text-base-content/60">
                                          ({thisPid})
                                        </span>
                                      )}
                                    </span>
                                    {yielderMatchesWall(
                                      effYielder,
                                      thisId,
                                      wallIdAliasMap,
                                    ) ? (
                                      <span className="text-xs font-semibold text-primary tabular-nums">
                                        −{cm(trimIfThis)}
                                      </span>
                                    ) : (
                                      yielderMatchesWall(
                                        suggested,
                                        thisId,
                                        wallIdAliasMap,
                                      ) && (
                                        <span className="text-[11px] font-medium text-base-content/45">
                                          Sugerida
                                        </span>
                                      )
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleWallWallDecision(
                                        ww.jointIndex,
                                        otherId,
                                      );
                                    }}
                                    className={`flex items-center gap-2 w-full text-left rounded-lg border px-3 py-2 transition-colors ${
                                      yielderMatchesWall(
                                        effYielder,
                                        otherId,
                                        wallIdAliasMap,
                                      )
                                        ? "border-primary bg-primary/10"
                                        : "border-base-300/50 bg-base-100 hover:bg-base-200/60"
                                    }`}
                                  >
                                    <span
                                      className="w-2.5 h-2.5 rounded-full shrink-0"
                                      style={{ backgroundColor: "#3b82f6" }}
                                    />
                                    <span className="flex-1 text-sm">
                                      La otra{" "}
                                      {otherPid && (
                                        <span className="font-mono text-xs text-base-content/60">
                                          ({otherPid})
                                        </span>
                                      )}
                                    </span>
                                    {yielderMatchesWall(
                                      effYielder,
                                      otherId,
                                      wallIdAliasMap,
                                    ) ? (
                                      <span className="text-xs font-semibold text-primary tabular-nums">
                                        −{cm(trimIfOther)}
                                      </span>
                                    ) : (
                                      yielderMatchesWall(
                                        suggested,
                                        otherId,
                                        wallIdAliasMap,
                                      ) && (
                                        <span className="text-[11px] font-medium text-base-content/45">
                                          Sugerida
                                        </span>
                                      )
                                    )}
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        },
                      )}
                    </div>
                  </div>
                );
              })()}

            {/* Lista de capas cuando hay 2 o más seleccionadas */}
            {selectedGroupIds.size >= 2 &&
              (() => {
                const selectedGroups = Array.from(selectedGroupIds).map(
                  (id) => ({
                    id,
                    group: phase1.groups.find((g) => g.id === id),
                    pid: panelIdByGroup.get(id),
                    cat:
                      overrides.get(id) ??
                      phase1.groups.find((g) => g.id === id)?.category ??
                      "discard",
                  }),
                );
                return (
                  <div className="px-4 py-3 border-b border-base-300/30">
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-base-content/40 mb-2">
                      {selectedGroupIds.size} capas seleccionadas
                    </p>
                    <div className="flex flex-col gap-1">
                      {selectedGroups.map(({ id, group, pid, cat }) => (
                        <div
                          key={id}
                          className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-base-200/40 text-sm"
                        >
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${
                              cat === "wall"
                                ? "bg-primary"
                                : cat === "floor"
                                  ? "bg-success"
                                  : "bg-base-content/25"
                            }`}
                          />
                          <span className="flex-1 truncate text-base-content/80 text-xs">
                            {group?.label ?? `Grupo ${id}`}
                          </span>
                          {pid && (
                            <span className="font-mono text-[10px] text-base-content/40 bg-base-100 border border-base-300/50 px-1 rounded">
                              {pid}
                            </span>
                          )}
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs btn-circle opacity-50 hover:opacity-100"
                            onClick={() => handleToggleGroup(id)}
                            aria-label="Quitar de selección"
                          >
                            <X size={10} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

            {/* Fusión: una sola sección cuando hay varias capas seleccionadas */}
            {selectedGroupIds.size >= 2 && (
              <div className="px-4 py-3 border-b border-base-300/30 bg-base-100/60 space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-base-content/40">
                  Fusión
                </p>
                {canMergeSelected ? (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm w-full rounded-xl gap-2"
                    onClick={handleMergeSelected}
                  >
                    <Link2 size={14} />
                    {mergeLabel} · F
                  </button>
                ) : mergeBlockedReason ? (
                  <p className="text-[11px] text-base-content/45 leading-relaxed px-1">
                    {mergeBlockedReason}
                  </p>
                ) : (
                  <p className="text-[11px] text-base-content/45 leading-relaxed px-1">
                    Seleccioná varios componentes con Ctrl+clic o los checkboxes
                    de la lista.
                  </p>
                )}
              </div>
            )}
              </InspectorSection>
            )}

            {/* Cortes */}
            {showCortesSection && (
              <InspectorSection
                icon={<Scissors size={14} />}
                title="Cortes"
                badge={cutsForSelectedGroup.length}
                open={inspectorSection === "cortes"}
                onToggle={() => toggleInspector("cortes")}
              >
            {selectedGroupIds.size === 1 && cutsForSelectedGroup.length > 0 && (
              <div className="px-4 py-3 bg-warning/5">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-warning/70">
                    Cortes · {cutsForSelectedGroup.length}
                  </p>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs gap-1 text-base-content/50 hover:text-warning"
                    onClick={() => {
                      const ownerId = cutGroupOwnerId(selectedGroup!.id);
                      const removedIds = userCuts
                        .filter((c) => c.groupId === ownerId)
                        .map((c) => c.id);
                      pushHistory();
                      setUserCuts((prev) =>
                        prev.filter((c) => c.groupId !== ownerId),
                      );
                      setGroupNotes((prev) => removeNotesForCuts(prev, removedIds));
                      setSelectedCutId(null);
                    }}
                  >
                    <Trash2 size={11} />
                    Quitar todos
                  </button>
                </div>
                <div className="flex flex-col gap-1">
                  {cutsForSelectedGroup.map((cut) => {
                    const cutNotes = cutNoteCounts.get(cut.id) ?? 0;
                    return (
                    <div
                      key={cut.id}
                      role="button"
                      tabIndex={0}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-lg border text-xs cursor-pointer transition-colors ${
                        selectedCutId === cut.id
                          ? "bg-warning/15 border-warning/50 ring-1 ring-warning/30"
                          : "bg-base-100/80 border-warning/20 hover:bg-warning/10"
                      }`}
                      onClick={() =>
                        setSelectedCutId((prev) =>
                          prev === cut.id ? null : cut.id,
                        )
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedCutId((prev) =>
                            prev === cut.id ? null : cut.id,
                          );
                        }
                      }}
                    >
                      <Scissors size={10} className="text-warning shrink-0" />
                      <span className="flex-1 font-mono text-[11px] text-base-content/70">
                        {cut.kind} · {cutDimensionsLabel(cut)}
                      </span>
                      {cutNotes > 0 && (
                        <span
                          className="badge badge-ghost badge-xs gap-0.5 shrink-0"
                          title={`${cutNotes} nota${cutNotes !== 1 ? "s" : ""} del corte`}
                        >
                          <StickyNote size={9} />
                          {cutNotes}
                        </span>
                      )}
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs btn-circle opacity-50 hover:opacity-100 hover:text-error"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveCut(cut.id);
                        }}
                        aria-label="Eliminar corte"
                      >
                        <X size={10} />
                      </button>
                    </div>
                    );
                  })}
                </div>
              </div>
            )}
              </InspectorSection>
            )}

            {/* Similares: piezas del mismo tamaño */}
            {showSimilaresSection && (
              <InspectorSection
                icon={<Copy size={14} />}
                title="Piezas iguales"
                badge={similaresBadge}
                open={inspectorSection === "similares"}
                onToggle={() => toggleInspector("similares")}
              >
            {selectedGroupIds.size === 1 && sameAreaMatches.length > 0 && (
              <div className="px-4 py-2 bg-base-100/60">
                <p className="text-[11px] text-base-content/45 mb-2">
                  {sameAreaMatches.length} capa
                  {sameAreaMatches.length !== 1 ? "s" : ""} más con{" "}
                  <span className="font-mono font-semibold text-base-content/70">
                    {selectedGroup?.totalArea.toFixed(2)} m²
                  </span>{" "}
                  · misma orientación y tipo
                </p>
                <button
                  type="button"
                  className="btn btn-outline btn-sm w-full rounded-xl gap-2 border-base-300 text-base-content/70"
                  onClick={() => openBulkSimilarModal("discard")}
                >
                  <Copy size={14} />
                  Descartar del mismo tamaño…
                </button>
              </div>
            )}

            {selectedGroupIds.size === 1 &&
              sameAreaDiscardMatches.length > 0 && (
                <div className="px-4 py-2 border-b border-base-300/30 bg-info/5">
                  <p className="text-[11px] text-base-content/45 mb-2 leading-relaxed">
                    {sameAreaDiscardMatches.length} descarte
                    {sameAreaDiscardMatches.length !== 1 ? "s" : ""} más iguales
                    ({selectedGroup?.totalArea.toFixed(2)} m² ·{" "}
                    {selectedGroup?.orientation}). Marcá todas como pared o piso
                    para incluirlas en los planos (p. ej. ventanas).
                  </p>
                  <div className="flex flex-col gap-1.5">
                    <button
                      type="button"
                      className="btn btn-outline btn-sm w-full rounded-xl gap-2 border-info/40 text-base-content/80"
                      onClick={() => openBulkSimilarModal("promote", "wall")}
                    >
                      <Copy size={14} />
                      Marcar iguales como Pared…
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline btn-sm w-full rounded-xl gap-2 border-info/40 text-base-content/80"
                      onClick={() => openBulkSimilarModal("promote", "floor")}
                    >
                      <Copy size={14} />
                      Marcar iguales como Piso…
                    </button>
                  </div>
                </div>
              )}
              </InspectorSection>
            )}
          </div>
          {/* /Inspector */}

          {/* Explorar componentes: la lista completa, colapsada por defecto */}
          <MeasureList
            measures={measures}
            groups={displayGroups}
            labelOptions={measureLabelOptions}
            measureScaleDenom={measureLabelScale}
            onMeasureScaleChange={handleMeasureScaleChange}
            selectedMeasureId={selectedMeasureId}
            onSelectMeasure={handleSelectMeasure}
            onRemoveMeasure={handleRemoveMeasure}
            onClearMeasures={handleClearMeasures}
          />
          <GroupList
            groups={displayGroups}
            selectedGroupIds={selectedGroupIds}
            hiddenGroupIds={hiddenGroupIds}
            categoryOverrides={overrides}
            visibleCategories={visibleCategories}
            noteCountByGroupId={noteCounts}
            listActive
            initialCollapsed
            onSelectGroup={handleSelectGroup}
            onToggleGroup={handleToggleGroup}
            onHideGroup={handleHideGroup}
            onShowGroup={handleShowGroup}
            onShowAllHidden={handleShowAllHidden}
            onChangeCategory={handleChangeCategory}
            onOpenContextMenu={openViewerContextMenu}
          />

              </aside>
            </Panel>
            <PanelResizeHandle className="w-2 mx-0 cursor-col-resize hover:bg-primary transition-colors divider divider-horizontal" />
          </>
        )}
        <Panel className="relative overflow-hidden flex-1">
          <div className="w-full h-full relative overflow-hidden" data-tour="viewer-3d" ref={viewerAreaRef}>
        <ModelViewer
          faces={phase1.faces}
          groups={displayGroups}
          projectionGroups={phase1.groups}
          derivedCutTriangles={derivedCutTriangles}
          derivedPanelPolys={derivedPanelPolys}
          selectedGroupIds={selectedGroupIds}
          mergeMemberFaceIndices={mergeMemberHighlightFaceIndices}
          categoryOverrides={overrides}
          visibleCategories={visibleCategories}
          hiddenGroupIds={hiddenGroupIds}
          onSelectGroup={handleSelectGroup}
          onToggleGroup={handleToggleGroup}
          onContextMenu={openViewerContextMenu}
          appliedAxis={phase1.appliedAxis}
          showCenterAxes={showCenterAxes}
          leaderMarkers={leaderMarkers}
          noteMarkers={noteMarkers}
          isSolid={isSolid}
          boxSelectActive={boxSelectMode}
          viewerRef={viewerRef}
          markGroupIds={markGroupIds}
          markLines={markLineDraft ? [...savedMarkLines, markLineDraft] : savedMarkLines}
          reinforcements={{
            ribs: ribGhost ? [...savedRibs, ribGhost] : savedRibs,
            columns: savedColumns,
            plateJoints: effectivePlateJoints,
          }}
          flexSpecs={savedFlex}
          cameraCommand={cameraCommand}
          xray={xrayMode}
          section={section}
          walkMode={walkMode}
          userCuts={userCuts}
          cutDraft={cutDraft}
          movingCutId={movingCutId}
          measureDraft={measureDraft}
          measures={measures}
          measureLabelOptions={measureLabelOptions}
          highlightMeasureId={selectedMeasureId}
          angleDraft={angleDraft}
          angleMeasures={angleMeasures}
        />

        <CutToolOverlay
          active={cutToolMode}
          shapeKind={cutShapeKind}
          edgeSnapEnabled={cutEdgeSnap}
          userCuts={userCuts}
          selectedCutId={selectedCutId}
          onSelectedCutIdChange={setSelectedCutId}
          targetGroupId={selectedGroup?.id ?? null}
          viewerRef={viewerRef}
          onDraftChange={setCutDraft}
          onMovingCutId={setMovingCutId}
          onCommitCut={handleCommitCut}
          onCommitMove={handleCommitMove}
        />

        <MeasureToolOverlay
          active={measureToolMode}
          shapeKind={measureShapeKind}
          edgeSnapEnabled={cutEdgeSnap}
          viewerRef={viewerRef}
          onDraftChange={setMeasureDraft}
          onCommitMeasure={handleCommitMeasure}
        />

        <MarkLineToolOverlay
          active={markLineToolMode}
          mode={markLineMode}
          edgeSnapEnabled={cutEdgeSnap}
          targetGroupId={selectedGroup?.id ?? null}
          viewerRef={viewerRef}
          onDraftChange={setMarkLineDraft}
          onUpsert={handleUpsertMarkLine}
        />

        <AngleMeasureOverlay
          active={angleMeasureMode !== "off"}
          mode={angleMeasureMode === "off" ? "line" : angleMeasureMode}
          viewerRef={viewerRef}
          onDraftChange={setAngleDraft}
          onCommit={(m) => setAngleMeasures((prev) => [...prev, m])}
        />

        <RibSnapperOverlay
          active={ribToolMode}
          viewerRef={viewerRef}
          plateJoints={effectivePlateJoints}
          ribSizeM={ribSizeM}
          onGhostChange={setRibGhost}
          onCommit={handleCommitSnappedRib}
        />

        {/* Overlay mientras el backend recalcula la topología */}
        {isRecomputing && (
          <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-base-200/50 backdrop-blur-sm">
            <span className="loading loading-spinner loading-lg text-primary" />
            <p className="text-sm font-medium text-base-content/80">
              Recalculando en el servidor…
            </p>
          </div>
        )}

        {/* Box-select overlay — captures pointer events when active */}
        {boxSelectMode && !cutToolMode && !measureToolMode && (
          <div
            className="absolute inset-0 z-20"
            style={{ cursor: "crosshair" }}
            onPointerDown={(e) => {
              const under = document.elementFromPoint(e.clientX, e.clientY);
              if (under?.closest("[data-viewer-chrome]")) return;
              handleBoxPointerDown(e);
            }}
            onPointerMove={handleBoxPointerMove}
            onPointerUp={handleBoxPointerUp}
          />
        )}

        {/* Drag rectangle */}
        {dragRect && (
          <div
            className="fixed z-30 pointer-events-none border-2 border-primary bg-primary/10 rounded-sm"
            style={{
              left: dragRect.x,
              top: dragRect.y,
              width: dragRect.w,
              height: dragRect.h,
            }}
          />
        )}

        {contextMenu && (
          <div
            className="fixed z-[60] min-w-[11rem] rounded-xl border border-base-300/60 bg-base-100/95 backdrop-blur-md shadow-xl shadow-base-content/10 py-1"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            {canMergeSelected && (
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-left hover:bg-primary/10 transition-colors"
                onClick={handleMergeSelected}
              >
                <Link2 size={15} className="text-primary shrink-0" />
                {mergeLabel}
              </button>
            )}
            {selectedGroupIds.size >= 2 &&
              !canMergeSelected &&
              mergeBlockedReason && (
                <p className="px-3 py-2 text-[11px] text-base-content/45 leading-relaxed border-b border-base-300/30">
                  {mergeBlockedReason}
                </p>
              )}
            {canSplitMerged && (
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-left hover:bg-base-200/80 transition-colors"
                onClick={() => {
                  handleDivideMerged();
                  setContextMenu(null);
                }}
              >
                <SquareSplitHorizontal
                  size={15}
                  className="text-base-content/70 shrink-0"
                />
                {divideAllLabel}
              </button>
            )}
            {selectedGroup &&
              getEffectiveCategory(selectedGroup, overrides) !== "discard" && (
                <button
                  type="button"
                  className={`flex w-full items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
                    markGroupIds.has(selectedGroup.id)
                      ? "hover:bg-error/10 text-error"
                      : "hover:bg-base-200/80"
                  }`}
                  onClick={() => {
                    handleToggleMark(selectedGroup.id);
                    setContextMenu(null);
                  }}
                >
                  <PenLine size={15} className="shrink-0" />
                  {markGroupIds.has(selectedGroup.id)
                    ? "Desmarcar aberturas"
                    : "Marcar aberturas (grabar en rojo)"}
                </button>
              )}
            {selectedGroupIds.size > 0 && (
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-left hover:bg-error/10 text-error transition-colors"
                onClick={() => {
                  const ids = Array.from(selectedGroupIds);
                  pushHistory();
                  setOverrides((prev) => {
                    const next = new Map(prev);
                    for (const gid of ids)
                      applyCategoryOverride(next, gid, "discard");
                    return next;
                  });
                  setSelectedGroupIds(new Set());
                  setContextMenu(null);
                }}
              >
                <Trash2 size={15} className="shrink-0" />
                Descartar{" "}
                {selectedGroupIds.size === 1
                  ? "capa"
                  : `${selectedGroupIds.size} capas`}
              </button>
            )}
            {selectedGroupIds.size > 0 && (
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-left hover:bg-base-200/80 transition-colors"
                onClick={handleHideSelected}
              >
                <EyeOff size={15} className="text-base-content/60 shrink-0" />
                Ocultar{" "}
                {selectedGroupIds.size === 1
                  ? "capa"
                  : `${selectedGroupIds.size} capas`}
              </button>
            )}
          </div>
        )}

        {/* HUD del modo caminar */}
        {walkMode && (
          <div
            data-viewer-chrome
            className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 pointer-events-none flex items-center gap-3 px-3 py-1.5 rounded-full bg-base-100/90 backdrop-blur-xl border border-base-300/40 shadow-lg text-xs text-base-content/75"
          >
            <Footprints size={13} className="text-primary" />
            <span>Click para mirar · <b>WASD</b> moverse · <b>Espacio/Shift</b> subir/bajar · <b>Esc</b> salir</span>
          </div>
        )}

        {/* Panel del plano de corte (sección) */}
        {section.enabled && (
          <div
            data-viewer-chrome
            className="absolute bottom-4 left-4 z-40 pointer-events-auto flex items-center gap-2 p-2 rounded-2xl bg-base-100/90 backdrop-blur-xl border border-base-300/40 shadow-lg"
          >
            <Scissors size={14} className="text-primary shrink-0" />
            <div className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-base-200/50">
              {(["x", "y", "z"] as const).map((ax) => (
                <button
                  key={ax}
                  type="button"
                  className={`px-2 py-1 rounded-md text-xs font-medium uppercase transition-colors ${
                    section.axis === ax
                      ? "bg-primary/15 text-primary"
                      : "text-base-content/60 hover:bg-base-200"
                  }`}
                  onClick={() => setSection((s) => ({ ...s, axis: ax }))}
                >
                  {ax}
                </button>
              ))}
            </div>
            <input
              type="range"
              className="range range-primary range-xs w-40"
              min={0}
              max={1}
              step={0.01}
              value={section.pos}
              onChange={(e) => setSection((s) => ({ ...s, pos: Number(e.target.value) }))}
              aria-label="Posición del corte"
            />
            <button
              type="button"
              className="btn btn-ghost btn-xs btn-circle"
              onClick={() => setSection((s) => ({ ...s, enabled: false }))}
              aria-label="Cerrar corte"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Active tool indicator — only when toolbar is fully hidden (BottomToolbar renders its own badge when visible) */}
        {hideToolbar && (
          <ActiveToolBadge
            activeTool={currentActiveTool}
            cutShapeKind={cutShapeKind}
            onCutShapeChange={(k) => { setCutDraft(null); setCutShapeKind(k); }}
            measureShapeKind={measureShapeKind}
            onMeasureShapeChange={(k) => { setMeasureDraft(null); setMeasureShapeKind(k); }}
            markLineMode={markLineMode}
            onMarkLineModeChange={(m) => { setMarkLineDraft(null); setMarkLineMode(m); }}
            cutCount={userCuts.length}
            measureCount={measures.length}
            hideToolbar={true}
          />
        )}

        {/* Toolbar — AutoCAD-style, top bar with downward flyouts */}
        {hideToolbar ? (
          <button
            type="button"
            data-viewer-chrome
            className="absolute top-0 left-1/2 -translate-x-1/2 z-50 pointer-events-auto flex items-center gap-1.5 px-4 py-1 bg-base-100/90 backdrop-blur border border-t-0 border-base-300/40 rounded-b-xl shadow-md text-base-content/70 hover:bg-primary hover:text-primary-content hover:border-primary text-xs font-medium transition-all"
            onClick={() => setHideToolbar(false)}
            title="Mostrar barra de herramientas"
          >
            <ChevronDown size={13} />
            <span>Herramientas</span>
          </button>
        ) : (
          <BottomToolbar
            stats={stats}
            visibleCategories={visibleCategories}
            onToggleVisibility={handleToggleVisibility}
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={handleUndo}
            onRedo={handleRedo}
            xrayMode={xrayMode}
            onToggleXray={() => setXrayMode((v) => !v)}
            section={section}
            onToggleSection={() => setSection((s) => ({ ...s, enabled: !s.enabled }))}
            walkMode={walkMode}
            onToggleWalk={toggleWalk}
            onFrameCamera={triggerCamera}
            selectedGroupIds={selectedGroupIds}
            activeTool={currentActiveTool}
            onSelectTool={handleSelectTool}
            onCycleCutShape={handleCycleCutShape}
            markLineMode={markLineMode}
            onMarkLineModeChange={(m) => { setMarkLineDraft(null); setMarkLineMode(m); }}
            measureShapeKind={measureShapeKind}
            onMeasureShapeChange={(k) => { setMeasureDraft(null); setMeasureShapeKind(k); }}
            measureLabelScale={measureLabelScale}
            onMeasureScaleChange={handleMeasureScaleChange}
            measureCount={measures.length}
            onClearMeasures={handleClearMeasures}
            cutShapeKind={cutShapeKind}
            onCutShapeChange={(k) => { setCutDraft(null); setCutShapeKind(k); }}
            cutCount={userCuts.length}
            edgeSnap={cutEdgeSnap}
            onToggleEdgeSnap={() => setCutEdgeSnap((on) => !on)}
            hiddenCount={hiddenGroupIds.size}
            onShowAllHidden={handleShowAllHidden}
            phase1={phase1}
            onRotateAxis={handleRotateAxis}
            isRecomputing={isRecomputing}
            isGenerating={isGenerating}
            showCenterAxes={showCenterAxes}
            onToggleCenterAxes={() => setShowCenterAxes((s) => !s)}
            isSolid={isSolid}
            onToggleSolid={() => setIsSolid((s) => !s)}
            hideSidebar={hideSidebar}
            onToggleSidebar={() => setHideSidebar((s) => !s)}
            hideToolbar={hideToolbar}
            onToggleToolbar={() => setHideToolbar((s) => !s)}
            minAreaM2={minAreaM2}
            onMinAreaChange={handleMinAreaChangeWithReset}
            pinTools={pinTools}
            onPinToolsChange={onPinToolsChange}
            minAreaOptions={MIN_AREA_OPTIONS}
            formatMinAreaOption={formatMinAreaOption}
            angleMeasureMode={angleMeasureMode}
            onSetAngleMeasureMode={(m) => {
              setCutToolMode(false);
              setMeasureToolMode(false);
              setMarkLineToolMode(false);
              setBoxSelectMode(false);
              setRibToolMode(false);
              setAngleMeasureMode(m);
            }}
            canMerge={canMergeSelected}
            onMerge={handleMergeSelected}
            mergeTitle={
              canMergeSelected
                ? `${mergeLabel} (F)`
                : (mergeBlockedReason ?? "Seleccioná 2 o más paredes para unir (F)")
            }
            canSplit={canSplitMerged}
            onSplit={handleDivideMerged}
            splitTitle={
              canSplitMerged
                ? `${divideAllLabel} (D)`
                : "Seleccioná un componente fusionado para dividir (D)"
            }
          />
        )}

        {/* ── Sidebar toggle tab — left edge of viewer, always on top ── */}
        <button
          type="button"
          data-viewer-chrome
          onClick={() => setHideSidebar((s) => !s)}
          title={hideSidebar ? "Mostrar panel lateral" : "Ocultar panel lateral"}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-[60] pointer-events-auto flex items-center justify-center w-4 h-14 bg-base-100/90 backdrop-blur border border-l-0 border-base-300/40 rounded-r-xl shadow-md hover:w-5 hover:bg-primary hover:text-primary-content hover:border-primary transition-all duration-150"
        >
          {hideSidebar ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
        </button>
          </div>
        </Panel>
      </PanelGroup>

      {/* Tour guiado: invitación en primera visita + relanzable desde la palette */}
      <ReviewTour launchNonce={tourNonce} />

      {/* Assembly window overlay */}
      {(assemblyWindowOpen && (onRequestAssemblyPreview || assemblyGuideData)) && (
        <AssemblyWindow
          data={assemblyData}
          loading={assemblyLoading}
          error={assemblyError}
          phase1={phase1}
          categoryOverrides={overrides}
          onClose={() => setAssemblyWindowOpen(false)}
          onReload={() => void loadAssemblyPreview(true)}
        />
      )}

      

      {bulkSimilarModal && (
        <dialog className="modal modal-open">
          <div className="modal-box max-w-md rounded-2xl">
            <h3 className="font-semibold text-base">
              {bulkSimilarModal.mode === "discard"
                ? "Descartar componentes del mismo tamaño"
                : "Reclasificar componentes del mismo tamaño"}
            </h3>
            <p className="text-xs text-base-content/55 mt-2 leading-relaxed">
              Estos componentes tienen{" "}
              <span className="font-mono font-semibold">
                {bulkSimilarModal.reference.totalArea.toFixed(2)} m²
              </span>
              , la misma orientación y tipo. Desmarcá las que no quieras
              incluir.
            </p>
            {bulkSimilarModal.mode === "promote" && (
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  className={`btn btn-sm flex-1 rounded-xl ${
                    bulkSimilarModal.promoteTarget === "wall"
                      ? "btn-primary"
                      : "btn-outline"
                  }`}
                  onClick={() =>
                    setBulkSimilarModal(
                      (m) => m && { ...m, promoteTarget: "wall" },
                    )
                  }
                >
                  Pared
                </button>
                <button
                  type="button"
                  className={`btn btn-sm flex-1 rounded-xl ${
                    bulkSimilarModal.promoteTarget === "floor"
                      ? "btn-primary"
                      : "btn-outline"
                  }`}
                  onClick={() =>
                    setBulkSimilarModal(
                      (m) => m && { ...m, promoteTarget: "floor" },
                    )
                  }
                >
                  Piso
                </button>
              </div>
            )}
            <div className="mt-4 max-h-56 overflow-y-auto space-y-1.5 custom-scrollbar">
              {[bulkSimilarModal.reference, ...bulkSimilarModal.matches].map(
                (g) => {
                  const eff = getEffectiveCategory(g, overrides);
                  return (
                    <label
                      key={g.id}
                      className="flex items-start gap-2.5 p-2.5 rounded-xl border border-base-300/40 bg-base-200/30 cursor-pointer hover:bg-base-200/60 transition-colors"
                    >
                      <input
                        type="checkbox"
                        className="checkbox checkbox-xs checkbox-primary rounded mt-0.5"
                        checked={bulkSimilarChecked.has(g.id)}
                        onChange={(e) => {
                          setBulkSimilarChecked((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(g.id);
                            else next.delete(g.id);
                            return next;
                          });
                        }}
                      />
                      <div className="min-w-0">
                        <span className="text-sm font-medium truncate block">
                          {g.label}
                        </span>
                        <span className="text-[11px] text-base-content/45">
                          {g.totalArea.toFixed(2)} m² ·{" "}
                          {eff === "wall"
                            ? "Pared"
                            : eff === "floor"
                              ? "Piso"
                              : "Descartar"}
                        </span>
                      </div>
                    </label>
                  );
                },
              )}
            </div>
            <div className="modal-action mt-4">
              <button
                type="button"
                className="btn btn-ghost rounded-xl"
                onClick={() => setBulkSimilarModal(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary rounded-xl"
                disabled={bulkSimilarChecked.size === 0}
                onClick={confirmBulkSimilar}
              >
                {bulkSimilarModal.mode === "discard"
                  ? `Descartar ${bulkSimilarChecked.size} capa${bulkSimilarChecked.size !== 1 ? "s" : ""}`
                  : `Marcar ${bulkSimilarChecked.size} como ${
                      bulkSimilarModal.promoteTarget === "floor"
                        ? "piso"
                        : "pared"
                    }`}
              </button>
            </div>
          </div>
          <form method="dialog" className="modal-backdrop">
            <button type="button" onClick={() => setBulkSimilarModal(null)}>
              cerrar
            </button>
          </form>
        </dialog>
      )}
    </div>
  );
}
