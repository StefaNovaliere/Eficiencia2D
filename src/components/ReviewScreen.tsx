"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import GroupList from "./GroupList";
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
import type { LeaderMarker } from "./ModelViewer";
import {
  RefreshCw,
  Box,
  Maximize,
  Crosshair,
  EyeOff,
  Eye,
  ChevronDown,
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
  Lightbulb,
  Scissors,
  Circle,
  Minus,
  RectangleHorizontal,
} from "lucide-react";
import { useReviewHistory } from "@/hooks/useReviewHistory";
import type { ModelViewerHandle } from "@/components/ModelViewer";
import CutToolOverlay from "@/components/CutToolOverlay";
import type { CutDragState, UserCut, ActiveCutShapeKind } from "@/core/user-cuts";
import { cutDimensionsLabel } from "@/core/user-cuts";

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

const ALL_CATEGORIES: FaceCategory[] = [
  "floor",
  "wall",
  "discard",
];

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
  ) => void;
  onCancel: () => void;
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
  initialOverrides?: ClassificationOverride[];
  initialWallWallDecisions?: WallWallDecisions;
  initialMarks?: number[];
  initialUserCuts?: UserCut[];
  /** El backend está recalculando la topología (deshabilita controles). */
  isRecomputing?: boolean;
  isGenerating?: boolean;
}

const MIN_AREA_OPTIONS = [0, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1.0];

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

function findMergeSurvivorId(cluster: number[], groups: GeometryGroup[]): number | null {
  const present = groups.filter((g) => cluster.includes(g.id));
  if (present.length === 0) return null;
  return present.reduce((best, g) => (g.totalArea > best.totalArea ? g : best)).id;
}

function findMergeClusterIndex(cluster: number[] | null, merges: number[][]): number {
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

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
  initialOverrides,
  initialWallWallDecisions,
  initialMarks,
  initialUserCuts,
  isRecomputing = false,
  isGenerating = false,
}: ReviewScreenProps) {
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [overrides, setOverrides] = useState<Map<number, FaceCategory>>(
    () => {
      if (!initialOverrides || initialOverrides.length === 0) return new Map();
      const m = new Map<number, FaceCategory>();
      for (const o of initialOverrides) m.set(o.groupId, o.newCategory);
      return m;
    },
  );
  const [visibleCategories, setVisibleCategories] = useState<Set<FaceCategory>>(
    () => new Set(ALL_CATEGORIES),
  );
  const [showCenterAxes, setShowCenterAxes] = useState(true);
  const [isSolid, setIsSolid] = useState(false);
  const [hideSidebar, setHideSidebar] = useState(false);
  // Which wall-wall joint (by jointIndex) is highlighted with leader labels in
  // the 3D viewer. Null = none selected.
  const [selectedJointIndex, setSelectedJointIndex] = useState<number | null>(null);
  // Wall-wall joint decisions: jointIndex → groupId that yields. Seeded from
  // each joint's safe default suggestion (thinner wall yields), overridable.
  const [wallWallDecisions, setWallWallDecisions] = useState<WallWallDecisions>(
    () => {
      if (initialWallWallDecisions && initialWallWallDecisions.size > 0) {
        return new Map(initialWallWallDecisions);
      }
      const m = new Map<number, number>();
      for (const ww of phase1.wallWallJoints) {
        if (ww.suggestedYieldGroupId != null) m.set(ww.jointIndex, ww.suggestedYieldGroupId);
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
  const [userCuts, setUserCuts] = useState<UserCut[]>(() => initialUserCuts ?? []);
  const [cutToolMode, setCutToolMode] = useState(false);
  const [cutShapeKind, setCutShapeKind] = useState<ActiveCutShapeKind>("rect");
  const [cutDraft, setCutDraft] = useState<CutDragState | null>(null);
  const [movingCutId, setMovingCutId] = useState<string | null>(null);
  // Foco de ayuda de la ventana de encuentros pared-pared: apagado por defecto
  // para ganar espacio; el usuario lo enciende para ver la explicación.
  const [showWallWallHelp, setShowWallWallHelp] = useState(false);
  /** Pared cuyo panel de encuentros está abierto (independiente de la selección 3D). */
  const [encountersWallId, setEncountersWallId] = useState<number | null>(null);
  /** Within a merged cluster, which original wall is currently focused. */
  const [mergeMemberFocusId, setMergeMemberFocusId] = useState<number | null>(null);
  const groupFaceIndexByIdRef = useRef<Map<number, number[]>>(new Map());
  const [mergeCardOpen, setMergeCardOpen] = useState(true);
  const [hiddenGroupIds, setHiddenGroupIds] = useState<Set<number>>(() => new Set());
  const [bulkActionNotice, setBulkActionNotice] = useState<string | null>(null);
  // Pestaña activa del panel derecho: lista de capas vs acciones de la selección.
  const [sidebarTab, setSidebarTab] = useState<"capas" | "seleccion">("capas");
  const [bulkSimilarModal, setBulkSimilarModal] = useState<{
    reference: GeometryGroup;
    matches: GeometryGroup[];
    mode: "discard" | "promote";
    promoteTarget?: "wall" | "floor";
  } | null>(null);
  const [bulkSimilarChecked, setBulkSimilarChecked] = useState<Set<number>>(() => new Set());
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const viewerAreaRef = useRef<HTMLDivElement>(null);
  const skipWallWallReseedRef = useRef(false);

  // Box selection
  const [boxSelectMode, setBoxSelectMode] = useState(false);
  const [dragRect, setDragRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const viewerRef = useRef<ModelViewerHandle | null>(null);
  const boxDragRef = useRef<{ startX: number; startY: number; active: boolean }>({
    startX: 0, startY: 0, active: false,
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

  const { canUndo, canRedo, pushHistory, undo, redo } = useReviewHistory(historyState);

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

  const handleHideGroup = useCallback((id: number) => {
    pushHistory();
    setHiddenGroupIds((prev) => new Set(prev).add(id));
    setSelectedGroupIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setSelectedJointIndex(null);
  }, [pushHistory]);

  const handleSelectGroup = useCallback((id: number) => {
    setSelectedGroupIds((prev) => {
      if (id === -1) return new Set();
      if (prev.size === 1 && prev.has(id)) return new Set();
      return new Set([id]);
    });
    setSelectedJointIndex(null);
  }, []);

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

  const handleShowGroup = useCallback((id: number) => {
    pushHistory();
    setHiddenGroupIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, [pushHistory]);

  const handleShowAllHidden = useCallback(() => {
    if (hiddenGroupIds.size === 0) return;
    pushHistory();
    setHiddenGroupIds(new Set());
  }, [hiddenGroupIds.size, pushHistory]);

  const applyCategoryOverride = useCallback(
    (
      next: Map<number, FaceCategory>,
      gid: number,
      category: FaceCategory,
    ) => {
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
    return phase1.groups.find((g) => g.id === selId) ?? null;
  }, [selectedGroupIds, phase1.groups]);

  const cutsForSelectedGroup = useMemo(() => {
    if (!selectedGroup) return [];
    return userCuts.filter((c) => c.groupId === selectedGroup.id);
  }, [selectedGroup, userCuts]);

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

  /** True when the "Selección" tab has panels/actions worth showing. */
  const hasSelectionTabContent = useMemo(() => {
    if (selectedGroupIds.size === 0) return false;
    if (selectedGroupIds.size >= 2) return true;
    if (encountersWallId != null) return true;
    if (selectedMergeCluster && displayMergeMembers.length >= 2) return true;
    if (cutsForSelectedGroup.length > 0) return true;
    if (sameAreaMatches.length > 0) return true;
    if (sameAreaDiscardMatches.length > 0) return true;
    return false;
  }, [
    selectedGroupIds.size,
    encountersWallId,
    selectedMergeCluster,
    displayMergeMembers.length,
    cutsForSelectedGroup.length,
    sameAreaMatches.length,
    sameAreaDiscardMatches.length,
  ]);

  // Ir a "Selección" solo si hay contenido; si no, quedarse en "Componentes".
  useEffect(() => {
    setSidebarTab((prev) => {
      if (selectedGroupIds.size === 0) return "capas";
      if (hasSelectionTabContent) return "seleccion";
      return "capas";
    });
  }, [selectedGroupIds.size, hasSelectionTabContent]);

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
        : bulkSimilarModal.promoteTarget ?? "wall";

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
  }, [bulkSimilarModal, bulkSimilarChecked, applyCategoryOverride, pushHistory]);

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
      if (ww.suggestedYieldGroupId != null) m.set(ww.jointIndex, ww.suggestedYieldGroupId);
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

  const handleMinAreaChangeWithReset = useCallback((newArea: number) => {
    setOverrides(new Map());
    setSelectedGroupIds(new Set());
    setHiddenGroupIds(new Set());
    onMinAreaChange(newArea);
  }, [onMinAreaChange]);

  // Merge selected coplanar groups into one panel.
  const selectedGroups = useMemo(() => {
    return Array.from(selectedGroupIds)
      .map((id) => phase1.groups.find((g) => g.id === id))
      .filter((g): g is GeometryGroup => g != null);
  }, [selectedGroupIds, phase1.groups]);

  const selectedWallGroups = useMemo(
    () => selectedGroups.filter((g) => getEffectiveCategory(g, overrides) === "wall"),
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
    if (selectedWallGroups.length < 2) return "Solo se pueden fusionar paredes.";
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

  const handleUnmerge = useCallback((mergeIndex: number) => {
    onRemoveMerge(mergeIndex);
  }, [onRemoveMerge]);

  const handleDivideMerged = useCallback(() => {
    if (selectedMergeIndex < 0) return;
    const formerMembers = [...displayMergeMembers];
    onRemoveMerge(selectedMergeIndex);
    setSelectedGroupIds(new Set(formerMembers));
    setMergeMemberFocusId(null);
    setEncountersWallId(null);
    setSelectedJointIndex(null);
  }, [selectedMergeIndex, onRemoveMerge, displayMergeMembers]);

  // Remove ONLY the currently selected wall from its merge cluster.
  // If the remaining cluster is still 2+ walls, re-add it; otherwise drop it.
  const handleRemoveSelectedFromMerge = useCallback(() => {
    if (selectedMergeIndex < 0 || !selectedMergeCluster || displayMergeMembers.length === 0) return;
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
        ? findMergeSurvivorId(remaining, phase1.groups) ?? remaining[0]
        : remaining[0] ?? null;
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
    },
    [pushHistory],
  );

  const handleConfirm = useCallback(() => {
    const result: ClassificationOverride[] = [];
    for (const [groupId, newCategory] of overrides.entries()) {
      result.push({ groupId, newCategory });
    }
    onConfirm(result, wallWallDecisions, [...markGroupIds], userCuts);
  }, [overrides, wallWallDecisions, markGroupIds, userCuts, onConfirm]);

  // Stats (per effective category).
  const stats = useMemo(() => {
    let floors = 0, walls = 0, discarded = 0;
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
      .filter((ww) => effCat(ww.groupA) !== "discard" && effCat(ww.groupB) !== "discard")
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

  // Abrir panel de encuentros al seleccionar una pared con cruces (solo si aún no está abierto).
  useEffect(() => {
    if (selectedGroupIds.size !== 1) return;
    const id = Array.from(selectedGroupIds)[0];
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
    const ww = phase1.wallWallJoints.find((w) => w.jointIndex === selectedJointIndex);
    if (!ww) return [];
    const focusId = encountersWallId ?? (selectedGroupIds.size === 1 ? Array.from(selectedGroupIds)[0] : ww.groupA);
    const cluster = findMergeClusterForGroupId(focusId, merges, phase1.groups);
    const primaryId =
      (cluster ? findMergeSurvivorId(cluster, phase1.groups) : null) ?? focusId;
    const byId = new Map(phase1.groups.map((g) => [g.id, g]));
    const out: LeaderMarker[] = [];
    for (const gid of [ww.groupA, ww.groupB]) {
      const g = byId.get(gid);
      if (!g) continue;
      out.push({
        groupId: gid,
        anchor: g.centroid,
        label: panelIdByGroup.get(gid) ?? "",
        primary: gid === primaryId,
      });
    }
    return out;
  }, [selectedJointIndex, phase1, selectedGroupIds, panelIdByGroup, encountersWallId, merges]);

  const viewToolBtn =
    "btn btn-sm btn-ghost h-9 min-h-9 w-9 px-0 rounded-lg hover:bg-base-200/80";

  // Box selection pointer handlers — placed after phase1 & hiddenGroupIds
  const handleBoxPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    boxDragRef.current = { startX: e.clientX, startY: e.clientY, active: true };
    setDragRect(null);
  }, []);

  const handleBoxPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!boxDragRef.current.active) return;
    const { startX, startY } = boxDragRef.current;
    setDragRect({
      x: Math.min(startX, e.clientX),
      y: Math.min(startY, e.clientY),
      w: Math.abs(e.clientX - startX),
      h: Math.abs(e.clientY - startY),
    });
  }, []);

  const handleBoxPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!boxDragRef.current.active) return;
    boxDragRef.current.active = false;
    const rect = dragRect;
    setDragRect(null);

    if (!rect || rect.w < 6 || rect.h < 6) return;

    const selected = viewerRef.current?.selectGroupsInRect(
      rect.x, rect.y, rect.w, rect.h,
      hiddenGroupIds,
    );

    if (selected && selected.size > 0) {
      setSelectedGroupIds(selected);
      setSelectedJointIndex(null);
    }
  }, [dragRect, hiddenGroupIds]);

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
      ) return;

      if (e.key === "c" || e.key === "C") {
        e.preventDefault();
        setBoxSelectMode(false);
        setCutToolMode((prev) => {
          if (!prev) return true;
          setCutDraft(null);
          setCutShapeKind((shape) => nextCutShape(shape));
          return true;
        });
        return;
      }

      if ((e.key === "s" || e.key === "S")) {
        e.preventDefault();
        setCutToolMode(false);
        setCutDraft(null);
        setBoxSelectMode((prev) => !prev);
        return;
      }

      if ((e.key === "v" || e.key === "V")) {
        e.preventDefault();
        setCutToolMode(false);
        setCutDraft(null);
        setBoxSelectMode(false);
        return;
      }

      if ((e.key === "d" || e.key === "D")) {
        if (canSplitMerged) {
          e.preventDefault();
          handleDivideMerged();
        }
        return;
      }

      if ((e.key === "f" || e.key === "F") && canMergeSelected) {
        e.preventDefault();
        handleMergeSelected();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canMergeSelected, handleMergeSelected, canSplitMerged, handleDivideMerged]);

  return (
    <div className="fixed inset-0 z-50 bg-base-200/40 flex flex-col md:flex-row overflow-hidden">
      <div className="flex-1 relative overflow-hidden" ref={viewerAreaRef}>
        <ModelViewer
          faces={phase1.faces}
          groups={phase1.groups}
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
          isSolid={isSolid}
          boxSelectActive={boxSelectMode}
          viewerRef={viewerRef}
          markGroupIds={markGroupIds}
          userCuts={userCuts}
          cutDraft={cutDraft}
          movingCutId={movingCutId}
        />

        <CutToolOverlay
          active={cutToolMode}
          shapeKind={cutShapeKind}
          userCuts={userCuts}
          viewerRef={viewerRef}
          onDraftChange={setCutDraft}
          onMovingCutId={setMovingCutId}
          onCommitCut={handleCommitCut}
          onCommitMove={handleCommitMove}
        />

        {/* Overlay mientras el backend recalcula la topología */}
        {isRecomputing && (
          <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-base-200/50 backdrop-blur-sm">
            <span className="loading loading-spinner loading-lg text-primary" />
            <p className="text-sm font-medium text-base-content/80">Recalculando en el servidor…</p>
          </div>
        )}

        {/* Box-select overlay — captures pointer events when active */}
        {boxSelectMode && !cutToolMode && (
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
            style={{ left: dragRect.x, top: dragRect.y, width: dragRect.w, height: dragRect.h }}
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
            {selectedGroupIds.size >= 2 && !canMergeSelected && mergeBlockedReason && (
              <p className="px-3 py-2 text-[11px] text-base-content/45 leading-relaxed border-b border-base-300/30">
                {mergeBlockedReason}
              </p>
            )}
            {canSplitMerged && (
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-left hover:bg-base-200/80 transition-colors"
                onClick={() => { handleDivideMerged(); setContextMenu(null); }}
              >
                <SquareSplitHorizontal size={15} className="text-base-content/70 shrink-0" />
                {divideAllLabel}
              </button>
            )}
            {selectedGroup && getEffectiveCategory(selectedGroup, overrides) !== "discard" && (
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
                    for (const gid of ids) applyCategoryOverride(next, gid, "discard");
                    return next;
                  });
                  setSelectedGroupIds(new Set());
                  setContextMenu(null);
                }}
              >
                <Trash2 size={15} className="shrink-0" />
                Descartar {selectedGroupIds.size === 1 ? "capa" : `${selectedGroupIds.size} capas`}
              </button>
            )}
            {selectedGroupIds.size > 0 && (
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-left hover:bg-base-200/80 transition-colors"
                onClick={handleHideSelected}
              >
                <EyeOff size={15} className="text-base-content/60 shrink-0" />
                Ocultar {selectedGroupIds.size === 1 ? "capa" : `${selectedGroupIds.size} capas`}
              </button>
            )}
          </div>
        )}

        {/* Toolbar — por encima del overlay de cortes/selección (z-20) */}
        <div
          data-viewer-chrome
          className="absolute top-4 left-4 right-4 z-40 flex flex-col gap-2 pointer-events-none"
        >
          <div className="pointer-events-auto flex flex-wrap items-center gap-2 p-2 rounded-2xl bg-base-100/85 backdrop-blur-xl border border-base-300/40 shadow-lg shadow-base-content/5">
            <VisibilityFilters
              stats={stats}
              visibleCategories={visibleCategories}
              onToggle={handleToggleVisibility}
            />

            <div className="hidden sm:block w-px h-7 bg-base-300/50" />

            <div className="inline-flex items-center gap-0.5 p-0.5 rounded-xl bg-base-200/50">
              <div className="tooltip tooltip-bottom" data-tip="Deshacer (Ctrl+Z)">
                <button
                  type="button"
                  className={viewToolBtn}
                  onClick={handleUndo}
                  disabled={!canUndo}
                  aria-label="Deshacer"
                >
                  <ArrowBackIcon size={15} />
                </button>
              </div>
              <div className="tooltip tooltip-bottom" data-tip="Rehacer (Ctrl+Y)">
                <button
                  type="button"
                  className={viewToolBtn}
                  onClick={handleRedo}
                  disabled={!canRedo}
                  aria-label="Rehacer"
                >
                  <ArrowRight size={15} />
                </button>
              </div>
            </div>

            <div className="hidden sm:block w-px h-7 bg-base-300/50" />

            <div className="inline-flex items-center gap-0.5 p-0.5 rounded-xl bg-base-200/50">
              <div className="tooltip tooltip-bottom" data-tip="Cursor (V)">
                <button
                  type="button"
                  className={`${viewToolBtn} ${!boxSelectMode && !cutToolMode ? "bg-primary/15 text-primary hover:bg-primary/20" : ""}`}
                  onClick={() => {
                    setCutToolMode(false);
                    setCutDraft(null);
                    setBoxSelectMode(false);
                  }}
                  aria-label="Cursor"
                  aria-pressed={!boxSelectMode && !cutToolMode}
                >
                  <MousePointer2 size={15} />
                </button>
              </div>
              <div className="tooltip tooltip-bottom" data-tip="Selección por área (S)">
                <button
                  type="button"
                  className={`${viewToolBtn} ${boxSelectMode ? "bg-primary/15 text-primary hover:bg-primary/20" : ""}`}
                  onClick={() => {
                    setCutToolMode(false);
                    setCutDraft(null);
                    setBoxSelectMode((s) => !s);
                  }}
                  aria-label="Selección por área"
                  aria-pressed={boxSelectMode}
                >
                  <Lasso size={15} />
                </button>
              </div>
              <div
                className="tooltip tooltip-bottom"
                data-tip={
                  cutToolMode
                    ? `${CUT_SHAPE_LABELS[cutShapeKind]} · C cambia forma · V sale`
                    : "Cortes (C) — activar y cambiar forma"
                }
              >
                <button
                  type="button"
                  className={`${viewToolBtn} ${cutToolMode ? "bg-warning/20 text-warning hover:bg-warning/25" : ""}`}
                  onClick={() => {
                    setBoxSelectMode(false);
                    setCutDraft(null);
                    setCutToolMode((active) => {
                      if (!active) return true;
                      setCutShapeKind((shape) => nextCutShape(shape));
                      return true;
                    });
                  }}
                  aria-label="Herramienta de cortes"
                  aria-pressed={cutToolMode}
                >
                  <Scissors size={15} />
                </button>
              </div>
            </div>

            {cutToolMode && (
              <div className="inline-flex items-center gap-1 p-0.5 pl-1.5 rounded-xl bg-warning/10 border border-warning/20">
                <span className="text-[11px] font-semibold text-warning whitespace-nowrap hidden sm:inline">
                  {CUT_SHAPE_LABELS[cutShapeKind]}
                </span>
                {(
                  [
                    { kind: "rect" as const, icon: RectangleHorizontal, tip: "Rectángulo (⇧ cuadrado)" },
                    { kind: "circle" as const, icon: Circle, tip: "Óvalo desde esquina (⇧ círculo)" },
                    { kind: "line" as const, icon: Minus, tip: "Línea de corte (⇧ recta)" },
                  ] as const
                ).map(({ kind, icon: Icon, tip }) => (
                  <button
                    key={kind}
                    type="button"
                    className={`${viewToolBtn} ${cutShapeKind === kind ? "bg-warning/25 text-warning ring-1 ring-warning/40" : ""}`}
                    title={tip}
                    onClick={(e) => {
                      e.stopPropagation();
                      setCutDraft(null);
                      setCutShapeKind(kind);
                    }}
                    aria-label={tip}
                    aria-pressed={cutShapeKind === kind}
                  >
                    <Icon size={15} />
                  </button>
                ))}
                {userCuts.length > 0 && (
                  <span className="text-[10px] font-semibold text-warning/80 px-1 tabular-nums border-l border-warning/20 ml-0.5 pl-1.5">
                    {userCuts.length}
                  </span>
                )}
              </div>
            )}

            <div className="hidden sm:block w-px h-7 bg-base-300/50" />

            {/* "Mostrar ocultos" — única acción contextual en la barra. Ocultar
                vive en el eye-off de cada fila y en el menú contextual. */}
            {hiddenGroupIds.size > 0 && (
              <>
                <div className="inline-flex items-center gap-0.5 p-0.5 rounded-xl bg-base-200/50">
                  <div className="tooltip tooltip-bottom" data-tip="Mostrar ocultos">
                    <button
                      type="button"
                      className={`${viewToolBtn} w-auto px-2 gap-1`}
                      onClick={handleShowAllHidden}
                    >
                      <Eye size={14} />
                      <span className="text-xs font-semibold tabular-nums">{hiddenGroupIds.size}</span>
                    </button>
                  </div>
                </div>
                <div className="hidden sm:block w-px h-7 bg-base-300/50" />
              </>
            )}

            {/* Vista y opciones — divulgación progresiva en un solo menú */}
            <div className="dropdown dropdown-end">
              <div tabIndex={0} role="button" className="btn btn-sm btn-ghost gap-1.5 rounded-lg">
                <SlidersHorizontal size={15} />
                <span className="text-sm font-medium hidden sm:inline">Vista</span>
                <ChevronDown size={14} className="opacity-60" />
              </div>
              <ul tabIndex={0} className="dropdown-content menu bg-base-100 rounded-2xl shadow-xl border border-base-300/40 w-64 p-2 mt-2 z-30">
                <li>
                  <button
                    type="button"
                    onClick={handleRotateAxis}
                    disabled={isRecomputing || isGenerating}
                    className="justify-between"
                  >
                    <span className="flex items-center gap-2">
                      {isRecomputing ? <span className="loading loading-spinner loading-xs" /> : <RefreshCw size={15} />}
                      Rotar eje vertical
                    </span>
                    <span className="badge badge-sm badge-ghost font-mono">{phase1.appliedAxis === "Y" ? "Y↑" : "Z↑"}</span>
                  </button>
                </li>
                <li>
                  <label className="justify-between cursor-pointer">
                    <span className="flex items-center gap-2"><Crosshair size={15} /> Mostrar ejes</span>
                    <input
                      type="checkbox"
                      className="toggle toggle-sm toggle-primary"
                      checked={showCenterAxes}
                      onChange={() => setShowCenterAxes((s) => !s)}
                    />
                  </label>
                </li>
                <li>
                  <label className="justify-between cursor-pointer">
                    <span className="flex items-center gap-2"><Box size={15} /> Vista maciza</span>
                    <input
                      type="checkbox"
                      className="toggle toggle-sm toggle-primary"
                      checked={isSolid}
                      onChange={() => setIsSolid((s) => !s)}
                    />
                  </label>
                </li>
                <li>
                  <label className="justify-between cursor-pointer">
                    <span className="flex items-center gap-2"><Maximize size={15} /> Pantalla completa</span>
                    <input
                      type="checkbox"
                      className="toggle toggle-sm toggle-primary"
                      checked={hideSidebar}
                      onChange={() => setHideSidebar((s) => !s)}
                    />
                  </label>
                </li>
                <div className="divider my-1" />
                <li>
                  <div className="flex items-center justify-between gap-2 py-1" title="Componentes más chicos que este umbral se descartan al generar">
                    <span className="flex items-center gap-2"><SlidersHorizontal size={15} /> Descartar &lt; (mín. área)</span>
                    <select
                      className="select select-bordered select-xs h-7 min-h-0 rounded-lg font-mono"
                      value={minAreaM2}
                      onChange={(e) => handleMinAreaChangeWithReset(Number(e.target.value))}
                    >
                      {MIN_AREA_OPTIONS.map((a) => (
                        <option key={a} value={a}>
                          {a === 0 ? "Ninguno" : `${a} m²`}
                        </option>
                      ))}
                    </select>
                  </div>
                </li>
              </ul>
            </div>
          </div>
        </div>

      </div>

      {!hideSidebar && (
        <aside className="w-full md:w-[21rem] lg:w-[24rem] flex flex-col border-t md:border-t-0 md:border-l border-base-300/40 bg-base-100 shrink-0 h-[42vh] md:h-full z-20 shadow-2xl shadow-base-content/5">
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

        {/* Pestañas: lista de componentes vs acciones de la selección */}
        <div role="tablist" className="tabs tabs-bordered px-2 shrink-0 bg-base-100">
          <button
            type="button"
            role="tab"
            className={`tab gap-1.5 ${sidebarTab === "capas" ? "tab-active" : ""}`}
            onClick={() => setSidebarTab("capas")}
          >
            Componentes
            <span className="badge badge-xs badge-neutral font-mono">{phase1.groups.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            className={`tab gap-1.5 ${sidebarTab === "seleccion" ? "tab-active" : ""}`}
            onClick={() => setSidebarTab("seleccion")}
          >
            Selección
            {selectedGroupIds.size > 0 && (
              <span className="badge badge-xs badge-primary font-mono">{selectedGroupIds.size}</span>
            )}
          </button>
        </div>

        {/* Pestaña: Capas */}
        <div className={`flex-1 min-h-0 flex flex-col ${sidebarTab === "capas" ? "" : "hidden"}`}>
          <GroupList
            groups={phase1.groups}
            selectedGroupIds={selectedGroupIds}
            hiddenGroupIds={hiddenGroupIds}
            categoryOverrides={overrides}
            visibleCategories={visibleCategories}
            listActive={sidebarTab === "capas"}
            onSelectGroup={handleSelectGroup}
            onToggleGroup={handleToggleGroup}
            onHideGroup={handleHideGroup}
            onShowGroup={handleShowGroup}
            onShowAllHidden={handleShowAllHidden}
            onChangeCategory={handleChangeCategory}
            onOpenContextMenu={openViewerContextMenu}
          />
        </div>

        {/* Pestaña: Selección */}
        <div className={`flex-1 min-h-0 overflow-y-auto custom-scrollbar ${sidebarTab === "seleccion" ? "" : "hidden"}`}>
          {/* Grupo fusionado: ver paredes, enfocar y desfusionar solo una */}
          {selectedGroupIds.size === 1 && displayMergeMembers.length >= 2 && (
            <div className="px-4 py-3 border-b border-base-300/30 bg-primary/5 space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-primary/60">
                Fusionada · {displayMergeMembers.length} pared{displayMergeMembers.length !== 1 ? "es" : ""}
              </p>
              <div className="flex flex-col gap-1">
                {displayMergeMembers.map((id) => {
                  const g = phase1.groups.find((gr) => gr.id === id);
                  const isFocused = mergeMemberFocusId != null && id === mergeMemberFocusId;
                  const pid = panelIdByGroup.get(id);
                  const label = g?.label ?? (pid ? `Panel ${pid}` : `Pared ${id}`);
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
                        <span className="text-[10px] opacity-70">seleccionada</span>
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
                    <span className="text-[10px] opacity-60 font-normal">· D</span>
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
                        {panelIdByGroup.get(mergeMemberFocusId) ?? `#${mergeMemberFocusId}`}
                      </span>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Encuentros pared-pared */}
          {encountersWallId != null && (() => {
            const memberCluster = findMergeClusterForGroupId(encountersWallId, merges, phase1.groups);
            const survivorId =
              (memberCluster ? findMergeSurvivorId(memberCluster, phase1.groups) : null) ??
              encountersWallId;
            const selGroup = phase1.groups.find((g) => g.id === survivorId);
            if (!selGroup) return null;

            const groupWWJoints = wallWallList.filter(
              ({ ww }) => ww.groupA === survivorId || ww.groupB === survivorId,
            );
            if (groupWWJoints.length === 0) return null;

            const groupById = new Map(phase1.groups.map((g) => [g.id, g]));
            const selPid = panelIdByGroup.get(encountersWallId) ?? panelIdByGroup.get(survivorId);
            const cm = (m: number) => `${(m * 100).toFixed(1).replace(".", ",")} cm`;

            return (
              <div className="px-4 py-3 border-b border-base-300/30 bg-base-100/60">
                <div className="flex items-start gap-2.5">
                  <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 text-primary shrink-0">
                    <Link2 size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold leading-tight flex items-center gap-1.5">
                      Encuentros de esta pared
                      {selPid && (
                        <span className="font-mono text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                          {selPid}
                        </span>
                      )}
                    </h3>
                    {showWallWallHelp && (
                      <p className="text-xs text-base-content/60 mt-1 leading-snug">
                        Donde dos paredes se cruzan, al armar la maqueta se pisarían por el espesor del
                        material. Una se acorta para que encajen. Elegí cuál se acorta
                        <span className="text-base-content/45"> (ya sugerimos una).</span>
                      </p>
                    )}
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
                    title={showWallWallHelp ? "Ocultar ayuda" : "¿Qué es esto?"}
                  >
                    <Lightbulb size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEncountersWallId(null)}
                    className="flex items-center justify-center w-7 h-7 rounded-lg shrink-0 text-base-content/40 hover:bg-base-200/80 hover:text-base-content/70 transition-colors"
                    aria-label="Cerrar encuentros"
                    title="Cerrar"
                  >
                    <X size={15} />
                  </button>
                </div>

                <div className="mt-3 flex flex-col gap-2.5">
                  {groupWWJoints.map(({ ww, labelA, labelB, pidA, pidB, hasThickness }) => {
                    const otherId = ww.groupA === survivorId ? ww.groupB : ww.groupA;
                    const otherLabel = ww.groupA === survivorId ? labelB : labelA;
                    const otherPid = ww.groupA === survivorId ? pidB : pidA;
                    const effYielder = wallWallDecisions.get(ww.jointIndex) ?? ww.suggestedYieldGroupId;
                    const suggested = ww.suggestedYieldGroupId;
                    const isOpen = selectedJointIndex === ww.jointIndex;

                    const selThick = groupById.get(survivorId)?.thickness ?? 0;
                    const otherThick = groupById.get(otherId)?.thickness ?? 0;
                    const trimIfSel = otherThick > 0.001 ? otherThick : selThick > 0.001 ? selThick : 0;
                    const trimIfOther = selThick > 0.001 ? selThick : otherThick > 0.001 ? otherThick : 0;

                    return (
                      <div
                        key={ww.jointIndex}
                        onClick={() =>
                          setSelectedJointIndex((cur) => (cur === ww.jointIndex ? null : ww.jointIndex))
                        }
                        className={`rounded-xl border p-3 cursor-pointer transition-all ${
                          isOpen
                            ? "border-primary/50 bg-primary/5 ring-1 ring-primary/20"
                            : "border-base-300/50 bg-base-200/30 hover:bg-base-200/50 hover:border-base-300/70"
                        }`}
                      >
                        <div className="flex items-center gap-1.5 text-sm font-medium">
                          <span className="text-base-content/50">Cruce con</span>
                          {otherPid && (
                            <span className="font-mono text-xs bg-base-100 border border-base-300/50 px-1.5 py-0.5 rounded">
                              {otherPid}
                            </span>
                          )}
                          <span className="truncate text-base-content/80">{otherLabel}</span>
                        </div>

                        {!hasThickness ? (
                          <p className="mt-2 text-xs text-base-content/55 px-2.5 py-2 rounded-lg bg-base-100/80 border border-base-300/40">
                            Sin ajuste necesario — no se detectó espesor en ninguna de las dos.
                          </p>
                        ) : (
                          <div className="mt-2.5 flex flex-col gap-1.5">
                            <p className="text-xs font-medium text-base-content/55">¿Cuál se acorta?</p>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleWallWallDecision(ww.jointIndex, survivorId);
                              }}
                              className={`flex items-center gap-2 w-full text-left rounded-lg border px-3 py-2 transition-colors ${
                                effYielder === survivorId
                                  ? "border-primary bg-primary/10"
                                  : "border-base-300/50 bg-base-100 hover:bg-base-200/60"
                              }`}
                            >
                              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: "#f59e0b" }} />
                              <span className="flex-1 text-sm">
                                Esta pared{" "}
                                {selPid && <span className="font-mono text-xs text-base-content/60">({selPid})</span>}
                              </span>
                              {effYielder === survivorId ? (
                                <span className="text-xs font-semibold text-primary tabular-nums">−{cm(trimIfSel)}</span>
                              ) : (
                                suggested === survivorId && (
                                  <span className="text-[11px] font-medium text-base-content/45">Sugerida</span>
                                )
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleWallWallDecision(ww.jointIndex, otherId);
                              }}
                              className={`flex items-center gap-2 w-full text-left rounded-lg border px-3 py-2 transition-colors ${
                                effYielder === otherId
                                  ? "border-primary bg-primary/10"
                                  : "border-base-300/50 bg-base-100 hover:bg-base-200/60"
                              }`}
                            >
                              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: "#3b82f6" }} />
                              <span className="flex-1 text-sm">
                                La otra{" "}
                                {otherPid && <span className="font-mono text-xs text-base-content/60">({otherPid})</span>}
                              </span>
                              {effYielder === otherId ? (
                                <span className="text-xs font-semibold text-primary tabular-nums">−{cm(trimIfOther)}</span>
                              ) : (
                                suggested === otherId && (
                                  <span className="text-[11px] font-medium text-base-content/45">Sugerida</span>
                                )
                              )}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {selectedGroupIds.size === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center px-6 gap-2 text-base-content/50">
              <ScanSearch size={26} className="text-base-content/25" />
              <p className="text-sm">Seleccioná una capa para ver sus acciones</p>
              <p className="text-xs text-base-content/35">Tipo, fusión/división y opciones por tamaño.</p>
            </div>
          )}

          {/* Lista de capas cuando hay 2 o más seleccionadas */}
          {selectedGroupIds.size >= 2 && (() => {
            const selectedGroups = Array.from(selectedGroupIds).map((id) => ({
              id,
              group: phase1.groups.find((g) => g.id === id),
              pid: panelIdByGroup.get(id),
              cat: overrides.get(id) ?? phase1.groups.find((g) => g.id === id)?.category ?? "discard",
            }));
            return (
              <div className="px-4 py-3 border-b border-base-300/30">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-base-content/40 mb-2">
                  {selectedGroupIds.size} capas seleccionadas
                </p>
                <div className="flex flex-col gap-1">
                  {selectedGroups.map(({ id, group, pid, cat }) => (
                    <div key={id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-base-200/40 text-sm">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          cat === "wall" ? "bg-primary" : cat === "floor" ? "bg-success" : "bg-base-content/25"
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
                  Seleccioná varios componentes con Ctrl+clic o los checkboxes de la lista.
                </p>
              )}
            </div>
          )}



        {selectedGroupIds.size === 1 && cutsForSelectedGroup.length > 0 && (
          <div className="px-4 py-3 border-b border-base-300/30 bg-warning/5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-warning/70">
                Cortes · {cutsForSelectedGroup.length}
              </p>
              <button
                type="button"
                className="btn btn-ghost btn-xs gap-1 text-base-content/50 hover:text-warning"
                onClick={() => {
                  pushHistory();
                  setUserCuts((prev) =>
                    prev.filter((c) => c.groupId !== selectedGroup!.id),
                  );
                }}
              >
                <Trash2 size={11} />
                Quitar todos
              </button>
            </div>
            <div className="flex flex-col gap-1">
              {cutsForSelectedGroup.map((cut) => (
                <div
                  key={cut.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-base-100/80 border border-warning/20 text-xs"
                >
                  <Scissors size={10} className="text-warning shrink-0" />
                  <span className="flex-1 font-mono text-[11px] text-base-content/70">
                    {cut.kind} · {cutDimensionsLabel(cut)}
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs btn-circle opacity-50 hover:opacity-100 hover:text-error"
                    onClick={() => handleRemoveCut(cut.id)}
                    aria-label="Eliminar corte"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {selectedGroupIds.size === 1 && sameAreaMatches.length > 0 && (
          <div className="px-4 py-2 border-b border-base-300/30 bg-base-100/60">
            <p className="text-[11px] text-base-content/45 mb-2">
              {sameAreaMatches.length} capa{sameAreaMatches.length !== 1 ? "s" : ""} más con{" "}
              <span className="font-mono font-semibold text-base-content/70">
                {selectedGroup?.totalArea.toFixed(2)} m²
              </span>
              {" "}· misma orientación y tipo
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

        {selectedGroupIds.size === 1 && sameAreaDiscardMatches.length > 0 && (
          <div className="px-4 py-2 border-b border-base-300/30 bg-info/5">
            <p className="text-[11px] text-base-content/45 mb-2 leading-relaxed">
              {sameAreaDiscardMatches.length} descarte{sameAreaDiscardMatches.length !== 1 ? "s" : ""} más
              iguales ({selectedGroup?.totalArea.toFixed(2)} m² · {selectedGroup?.orientation}).
              Marcá todas como pared o piso para incluirlas en los planos (p. ej. ventanas).
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

        </div>
        {/* /Pestaña: Selección */}

        {merges.length > 0 && (
          <div className="border-b border-base-300/30 bg-base-100/60">
            <button
              type="button"
              className="flex w-full items-center justify-between px-4 py-3 hover:bg-base-200/40 transition-colors"
              onClick={() => setMergeCardOpen((o) => !o)}
            >
              <span className="text-sm font-medium">
                Fusiones activas
                <span className="ml-2 badge badge-sm badge-neutral font-mono">{merges.length}</span>
              </span>
              {mergeCardOpen ? (
                <ChevronDown size={16} className="text-base-content/40" />
              ) : (
                <ChevronRight size={16} className="text-base-content/40" />
              )}
            </button>
            {mergeCardOpen && (
              <div className="px-4 pb-3 flex flex-col gap-1.5">
                {merges.map((ids, i) => {
                  const members = filterTrueMergeMembers(
                    ids,
                    phase1.groups,
                    phase1.wallWallJoints,
                  );
                  const labels = members.map((id) => {
                    const g = phase1.groups.find((gr) => gr.id === id);
                    const pid = panelIdByGroup.get(id);
                    return g?.label ?? (pid ? `Panel ${pid}` : `Grupo ${id}`);
                  });
                  return (
                    <div
                      key={i}
                      className="flex justify-between items-center gap-2 bg-base-200/50 border border-base-300/30 rounded-lg px-3 py-2 text-xs"
                    >
                      <span className="truncate font-medium text-base-content/80">{labels.join(" + ")}</span>
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs btn-square text-base-content/40 hover:text-error hover:bg-error/10"
                        onClick={() => handleUnmerge(i)}
                        title="Deshacer fusión"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="mt-auto border-t border-base-300/40 p-4 bg-base-100 shrink-0">
          {overrides.size > 0 && (
            <p className="text-[11px] text-warning mb-3 px-2 py-1.5 rounded-lg bg-warning/8 border border-warning/15 text-center font-medium">
              {overrides.size} clasificación{overrides.size !== 1 ? "es" : ""} modificada{overrides.size !== 1 ? "s" : ""}
            </p>
          )}

         

          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-ghost flex-1 rounded-xl border border-base-300/40"
              onClick={onCancel}
              disabled={isGenerating}
            >
              Volver
            </button>
            <button
              type="button"
              className="btn btn-primary flex-[1.4] rounded-xl gap-2 shadow-md shadow-primary/20"
              onClick={handleConfirm}
              disabled={isGenerating}
            >
              {isGenerating ? (
                <>
                  <span className="loading loading-spinner loading-sm" />
                  Generando…
                </>
              ) : (
                <>
                  Continuar
                  <ArrowRight size={15} />
                </>
              )}
            </button>
          </div>
        </div>
        </aside>
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
              , la misma orientación y tipo. Desmarcá las que no quieras incluir.
            </p>
            {bulkSimilarModal.mode === "promote" && (
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  className={`btn btn-sm flex-1 rounded-xl ${
                    bulkSimilarModal.promoteTarget === "wall" ? "btn-primary" : "btn-outline"
                  }`}
                  onClick={() =>
                    setBulkSimilarModal((m) => m && { ...m, promoteTarget: "wall" })
                  }
                >
                  Pared
                </button>
                <button
                  type="button"
                  className={`btn btn-sm flex-1 rounded-xl ${
                    bulkSimilarModal.promoteTarget === "floor" ? "btn-primary" : "btn-outline"
                  }`}
                  onClick={() =>
                    setBulkSimilarModal((m) => m && { ...m, promoteTarget: "floor" })
                  }
                >
                  Piso
                </button>
              </div>
            )}
            <div className="mt-4 max-h-56 overflow-y-auto space-y-1.5 custom-scrollbar">
              {[bulkSimilarModal.reference, ...bulkSimilarModal.matches].map((g) => {
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
                      <span className="text-sm font-medium truncate block">{g.label}</span>
                      <span className="text-[11px] text-base-content/45">
                        {g.totalArea.toFixed(2)} m² ·{" "}
                        {eff === "wall" ? "Pared" : eff === "floor" ? "Piso" : "Descartar"}
                      </span>
                    </div>
                  </label>
                );
              })}
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
                      bulkSimilarModal.promoteTarget === "floor" ? "piso" : "pared"
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
