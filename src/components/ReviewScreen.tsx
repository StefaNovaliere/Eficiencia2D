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
import {
  reclassifyWithAxis,
  computePanelIdByGroup,
  applyMerges,
  canMergeGroups,
  findCoplanarMergeClusters,
  splitGroupInPhase1,
} from "@/core/pipeline";
import {
  splitGroupAtPanelBridges,
  countConnectedComponents,
} from "@/core/group-splitter";
import type { Phase1Result, ClassificationOverride } from "@/core/pipeline";
import type { Joint } from "@/core/joint-detector";
import type { DimensionAdjustment } from "@/core/assembly-adjuster";
import type { LeaderMarker } from "./ModelViewer";
import {
  RefreshCw,
  Box,
  Maximize,
  Minimize,
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
} from "lucide-react";

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
  phase1: Phase1Result;
  onConfirm: (
    overrides: ClassificationOverride[],
    wallWallDecisions: WallWallDecisions,
    merges: number[][],
    topologyPhase1: Phase1Result,
  ) => void;
  onCancel: () => void;
  onAxisChange: (newPhase1: Phase1Result) => void;
  minAreaM2: number;
  onMinAreaChange: (area: number) => void;
  initialOverrides?: ClassificationOverride[];
  initialWallWallDecisions?: WallWallDecisions;
  initialMerges?: number[][];
  isGenerating?: boolean;
}

const MIN_AREA_OPTIONS = [0, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1.0];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ReviewScreen({
  phase1,
  onConfirm,
  onCancel,
  onAxisChange,
  minAreaM2,
  onMinAreaChange,
  initialOverrides,
  initialWallWallDecisions,
  initialMerges,
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
  // Merge state: sets of group IDs to combine into single panels.
  const [merges, setMerges] = useState<number[][]>(
    () => initialMerges ?? phase1.suggestedMerges ?? [],
  );
  const [mergeCardOpen, setMergeCardOpen] = useState(true);
  const [isRotating, setIsRotating] = useState(false);
  const [hiddenGroupIds, setHiddenGroupIds] = useState<Set<number>>(() => new Set());
  const [bulkActionNotice, setBulkActionNotice] = useState<string | null>(null);
  const [bulkSimilarModal, setBulkSimilarModal] = useState<{
    reference: GeometryGroup;
    matches: GeometryGroup[];
    mode: "discard" | "promote";
    promoteTarget?: "wall" | "floor";
  } | null>(null);
  const [bulkSimilarChecked, setBulkSimilarChecked] = useState<Set<number>>(() => new Set());
  const [manualPhase1, setManualPhase1] = useState<Phase1Result | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const viewerAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setManualPhase1(null);
  }, [phase1]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [contextMenu]);

  const workingPhase1 = manualPhase1 ?? phase1;

  // Effective phase1 with merges applied.
  const effectivePhase1 = useMemo(
    () => merges.length > 0 ? applyMerges(workingPhase1, merges) : workingPhase1,
    [workingPhase1, merges],
  );

  const handleHideGroup = useCallback((id: number) => {
    setHiddenGroupIds((prev) => new Set(prev).add(id));
    setSelectedGroupIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setSelectedJointIndex(null);
  }, []);

  const handleSelectGroup = useCallback((id: number) => {
    setSelectedGroupIds((prev) => {
      if (id === -1) return new Set();

      const group = effectivePhase1.groups.find((g) => g.id === id);
      if (!group) return prev;

      if (prev.has(id)) {
        if (prev.size === 1) return new Set();
        const next = new Set(prev);
        next.delete(id);
        return next;
      }

      if (prev.size >= 1) {
        const existing = Array.from(prev)
          .map((gid) => effectivePhase1.groups.find((g) => g.id === gid))
          .filter((g): g is GeometryGroup => g != null);
        const candidate = [...existing, group];
        const allWalls = candidate.every(
          (g) => getEffectiveCategory(g, overrides) === "wall",
        );
        if (
          allWalls &&
          canMergeGroups(candidate, effectivePhase1.groups, effectivePhase1.faces)
        ) {
          return new Set(prev).add(id);
        }
      }

      return new Set([id]);
    });
    setSelectedJointIndex(null);
  }, [effectivePhase1, overrides]);

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
  }, []);

  const handleShowGroup = useCallback((id: number) => {
    setHiddenGroupIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const handleShowAllHidden = useCallback(() => {
    setHiddenGroupIds(new Set());
  }, []);

  const applyCategoryOverride = useCallback(
    (
      next: Map<number, FaceCategory>,
      gid: number,
      category: FaceCategory,
    ) => {
      const original = effectivePhase1.groups.find((g) => g.id === gid)?.category;
      if (original === category) next.delete(gid);
      else next.set(gid, category);
    },
    [effectivePhase1.groups],
  );

  const handleChangeCategory = useCallback(
    (id: number, category: FaceCategory) => {
      const idsToUpdate = selectedGroupIds.has(id)
        ? Array.from(selectedGroupIds)
        : [id];

      setOverrides((prev) => {
        const next = new Map(prev);
        for (const gid of idsToUpdate) {
          applyCategoryOverride(next, gid, category);
        }
        return next;
      });
    },
    [selectedGroupIds, applyCategoryOverride],
  );

  const selectedGroup = useMemo(() => {
    if (selectedGroupIds.size !== 1) return null;
    const selId = Array.from(selectedGroupIds)[0];
    return effectivePhase1.groups.find((g) => g.id === selId) ?? null;
  }, [selectedGroupIds, effectivePhase1.groups]);

  const sameAreaMatches = useMemo(() => {
    if (!selectedGroup) return [];
    if (getEffectiveCategory(selectedGroup, overrides) === "discard") return [];
    return findGroupsWithSameArea(effectivePhase1.groups, selectedGroup, overrides);
  }, [selectedGroup, effectivePhase1.groups, overrides]);

  const sameAreaDiscardMatches = useMemo(() => {
    if (!selectedGroup) return [];
    if (getEffectiveCategory(selectedGroup, overrides) !== "discard") return [];
    return findGroupsWithSameArea(effectivePhase1.groups, selectedGroup, overrides);
  }, [selectedGroup, effectivePhase1.groups, overrides]);

  const openBulkSimilarModal = useCallback(
    (mode: "discard" | "promote", promoteTarget?: "wall" | "floor") => {
      if (!selectedGroup) return;
      const similar = collectSimilarGroups(
        effectivePhase1.groups,
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
    [selectedGroup, effectivePhase1.groups, overrides],
  );

  const confirmBulkSimilar = useCallback(() => {
    if (!bulkSimilarModal) return;
    const ids = Array.from(bulkSimilarChecked);
    const target: FaceCategory =
      bulkSimilarModal.mode === "discard"
        ? "discard"
        : bulkSimilarModal.promoteTarget ?? "wall";

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
  }, [bulkSimilarModal, bulkSimilarChecked, applyCategoryOverride]);

  // Re-seed wall-wall decisions whenever the effective topology changes (axis
  // rotation, min-area, or merge changes recompute joints and their indices).
  // The ref guard skips the initial mount so restored / initial decisions survive.
  const effectiveRef = useRef(effectivePhase1);
  useEffect(() => {
    if (effectiveRef.current === effectivePhase1) return;
    effectiveRef.current = effectivePhase1;
    const m = new Map<number, number>();
    for (const ww of effectivePhase1.wallWallJoints) {
      if (ww.suggestedYieldGroupId != null) m.set(ww.jointIndex, ww.suggestedYieldGroupId);
    }
    setWallWallDecisions(m);
  }, [effectivePhase1]);

  // Clear the highlighted joint whenever the wall selection changes (switch
  // wall, deselect, merge) so stale leader labels never linger.
  useEffect(() => {
    setSelectedJointIndex(null);
  }, [selectedGroupIds]);

  const handleRotateAxis = useCallback(() => {
    if (isRotating || isGenerating) return;
    const newAxis = phase1.appliedAxis === "Y" ? "Z" : "Y";
    setIsRotating(true);
    setOverrides(new Map());
    setSelectedGroupIds(new Set());
    setHiddenGroupIds(new Set());
    queueMicrotask(() => {
      try {
        const updated = reclassifyWithAxis(phase1, newAxis, minAreaM2);
        onAxisChange(updated);
      } catch (err: unknown) {
        console.error(err);
        alert(err instanceof Error ? err.message : "No se pudo rotar el eje.");
      } finally {
        setIsRotating(false);
      }
    });
  }, [phase1, minAreaM2, onAxisChange, isRotating, isGenerating]);

  const handleMinAreaChangeWithReset = useCallback((newArea: number) => {
    setOverrides(new Map());
    setSelectedGroupIds(new Set());
    setHiddenGroupIds(new Set());
    onMinAreaChange(newArea);
  }, [onMinAreaChange]);

  // Merge selected coplanar groups into one panel.
  const selectedGroups = useMemo(() => {
    return Array.from(selectedGroupIds)
      .map((id) => effectivePhase1.groups.find((g) => g.id === id))
      .filter((g): g is GeometryGroup => g != null);
  }, [selectedGroupIds, effectivePhase1.groups]);

  const selectedWallGroups = useMemo(
    () => selectedGroups.filter((g) => getEffectiveCategory(g, overrides) === "wall"),
    [selectedGroups, overrides],
  );

  const mergeClusters = useMemo(
    () =>
      findCoplanarMergeClusters(
        selectedWallGroups,
        effectivePhase1.groups,
        effectivePhase1.faces,
      ),
    [selectedWallGroups, effectivePhase1.groups, effectivePhase1.faces],
  );

  const primaryMergeCluster = useMemo(
    () => mergeClusters.sort((a, b) => b.length - a.length)[0] ?? null,
    [mergeClusters],
  );

  const canMergeSelected = primaryMergeCluster != null && primaryMergeCluster.length >= 2;

  const mergeBlockedReason = useMemo(() => {
    if (selectedGroups.length < 2) return null;
    if (canMergeSelected) return null;
    if (selectedWallGroups.length < 2) return "Solo se pueden fusionar paredes.";
    return "No hay paredes coplanares en la selección.";
  }, [selectedGroups.length, selectedWallGroups.length, canMergeSelected]);

  const handleMergeSelected = useCallback(() => {
    if (!primaryMergeCluster || primaryMergeCluster.length < 2) return;
    setMerges((prev) => [...prev, primaryMergeCluster]);
    setSelectedGroupIds(new Set());
    setContextMenu(null);
  }, [primaryMergeCluster]);

  const handleHideSelected = useCallback(() => {
    if (selectedGroupIds.size === 0) return;
    setHiddenGroupIds((prev) => {
      const next = new Set(prev);
      for (const id of selectedGroupIds) next.add(id);
      return next;
    });
    setSelectedGroupIds(new Set());
    setContextMenu(null);
  }, [selectedGroupIds]);

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

  const splitPreview = useMemo(() => {
    if (selectedGroupIds.size !== 1) return null;
    const gid = Array.from(selectedGroupIds)[0];
    const group = effectivePhase1.groups.find((g) => g.id === gid);
    if (!group) return null;

    const components = countConnectedComponents(effectivePhase1.faces, group);
    const { groups: panelPieces } = splitGroupAtPanelBridges(
      effectivePhase1.faces,
      group,
      group.id + 1,
      { force: true },
    );

    return {
      components,
      panels: panelPieces.length,
    };
  }, [selectedGroupIds, effectivePhase1]);

  const handleSplitComponents = useCallback(() => {
    if (selectedGroupIds.size !== 1) return;
    const gid = Array.from(selectedGroupIds)[0];
    const current = manualPhase1 ?? phase1;
    const updated = splitGroupInPhase1(current, gid, "components");
    if (updated === current) return;
    setManualPhase1(updated);
    setSelectedGroupIds(new Set());
    setSelectedJointIndex(null);
  }, [selectedGroupIds, manualPhase1, phase1]);

  const handleSplitPanels = useCallback(() => {
    if (selectedGroupIds.size !== 1) return;
    const gid = Array.from(selectedGroupIds)[0];
    const current = manualPhase1 ?? phase1;
    const updated = splitGroupInPhase1(current, gid, "panels");
    if (updated === current) return;
    setManualPhase1(updated);
    setSelectedGroupIds(new Set());
    setSelectedJointIndex(null);
  }, [selectedGroupIds, manualPhase1, phase1]);

  const handleUnmerge = useCallback((mergeIndex: number) => {
    setMerges((prev) => prev.filter((_, i) => i !== mergeIndex));
  }, []);

  const handleWallWallDecision = useCallback(
    (jointIndex: number, yieldGroupId: number, groupA: number, groupB: number) => {
      setWallWallDecisions((prev) => {
        const next = new Map(prev);
        next.set(jointIndex, yieldGroupId);
        return next;
      });
      // Highlight both walls of the joint in the 3D viewer.
      setSelectedGroupIds(new Set([groupA, groupB]));
    },
    [],
  );

  const handleToggleVisibility = useCallback((cat: FaceCategory) => {
    setVisibleCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  const handleConfirm = useCallback(() => {
    const result: ClassificationOverride[] = [];
    for (const [groupId, newCategory] of overrides.entries()) {
      result.push({ groupId, newCategory });
    }
    onConfirm(result, wallWallDecisions, merges, workingPhase1);
  }, [overrides, wallWallDecisions, merges, workingPhase1, onConfirm]);

  // Stats (per effective category).
  const stats = useMemo(() => {
    let floors = 0, walls = 0, discarded = 0;
    for (const group of effectivePhase1.groups) {
      const cat = overrides.get(group.id) ?? group.category;
      if (cat === "floor") floors++;
      else if (cat === "wall") walls++;
      else discarded++;
    }
    return { floors, walls, discarded };
  }, [effectivePhase1.groups, overrides]);

  // Map group.id → DXF panel ID ("A1", "B2", etc.). Derived from decomposePanels
  // itself (via computePanelIdByGroup) so the labels match the generated cut
  // sheet exactly — including the groups decomposePanels skips for being empty
  // or below minAreaM2, which would otherwise shift the A#/B# numbering.
  const panelIdByGroup = useMemo(() => {
    const overrideList: ClassificationOverride[] = [];
    for (const [groupId, newCategory] of overrides.entries()) {
      overrideList.push({ groupId, newCategory });
    }
    return computePanelIdByGroup(
      effectivePhase1,
      { scaleDenom: 50, paper: "A4", minAreaM2 },
      overrideList,
      wallWallDecisions,
    );
  }, [effectivePhase1, overrides, wallWallDecisions, minAreaM2]);

  // Wall-wall joints to resolve: skip any whose wall was reclassified to
  // discard (that joint no longer affects the cut).
  const wallWallList = useMemo(() => {
    const groupById = new Map(effectivePhase1.groups.map((g) => [g.id, g]));
    const effCat = (id: number) =>
      overrides.get(id) ?? groupById.get(id)?.category ?? "discard";
    return effectivePhase1.wallWallJoints
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
  }, [effectivePhase1.wallWallJoints, effectivePhase1.groups, overrides, panelIdByGroup]);

  // Floating reference labels for the selected joint: one per wall of the joint,
  // anchored at each wall's centroid and tagged with its panel id (A#/B#).
  const leaderMarkers = useMemo<LeaderMarker[]>(() => {
    if (selectedJointIndex == null) return [];
    const ww = effectivePhase1.wallWallJoints.find((w) => w.jointIndex === selectedJointIndex);
    if (!ww) return [];
    const selId = selectedGroupIds.size === 1 ? Array.from(selectedGroupIds)[0] : ww.groupA;
    const byId = new Map(effectivePhase1.groups.map((g) => [g.id, g]));
    const out: LeaderMarker[] = [];
    for (const gid of [ww.groupA, ww.groupB]) {
      const g = byId.get(gid);
      if (!g) continue;
      out.push({
        groupId: gid,
        anchor: g.centroid,
        label: panelIdByGroup.get(gid) ?? "",
        primary: gid === selId,
      });
    }
    return out;
  }, [selectedJointIndex, effectivePhase1, selectedGroupIds, panelIdByGroup]);

  const viewToolBtn =
    "btn btn-sm btn-ghost h-9 min-h-9 w-9 px-0 rounded-lg hover:bg-base-200/80";

  return (
    <div className="fixed inset-0 z-50 bg-base-200/40 flex flex-col md:flex-row overflow-hidden">
      <div className="flex-1 relative overflow-hidden" ref={viewerAreaRef}>
        <ModelViewer
          faces={effectivePhase1.faces}
          groups={effectivePhase1.groups}
          selectedGroupIds={selectedGroupIds}
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
        />

        {contextMenu && (
          <div
            className="fixed z-[60] min-w-[11rem] rounded-xl border border-base-300/60 bg-base-100/95 backdrop-blur-md shadow-xl shadow-base-content/10 py-1"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            {canMergeSelected && primaryMergeCluster && (
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-left hover:bg-primary/10 transition-colors"
                onClick={handleMergeSelected}
              >
                <Link2 size={15} className="text-primary shrink-0" />
                Fusionar {primaryMergeCluster.length} paredes
              </button>
            )}
            {selectedGroupIds.size >= 2 && !canMergeSelected && mergeBlockedReason && (
              <p className="px-3 py-2 text-[11px] text-base-content/45 leading-relaxed border-b border-base-300/30">
                {mergeBlockedReason}
              </p>
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

        {/* Toolbar */}
        <div className="absolute top-4 left-4 right-4 z-10 flex flex-col gap-2 pointer-events-none">
          {wallWallList.length > 0 && (
            <div className="pointer-events-auto self-start hidden md:flex items-center gap-2 px-3 py-2 rounded-xl bg-info/10 border border-info/20 text-info text-xs font-medium backdrop-blur-md">
              <ScanSearch size={14} className="shrink-0" />
              Seleccioná una pared para revisar sus uniones
            </div>
          )}

          <div className="pointer-events-auto flex flex-wrap items-center gap-2 p-2 rounded-2xl bg-base-100/85 backdrop-blur-xl border border-base-300/40 shadow-lg shadow-base-content/5">
            <VisibilityFilters
              stats={stats}
              visibleCategories={visibleCategories}
              onToggle={handleToggleVisibility}
            />

            <div className="hidden sm:block w-px h-7 bg-base-300/50" />

            <div className="inline-flex items-center gap-0.5 p-0.5 rounded-xl bg-base-200/50">
              {selectedGroupIds.size >= 2 && canMergeSelected && (
                <div className="tooltip tooltip-bottom" data-tip="Fusionar capas seleccionadas">
                  <button
                    type="button"
                    className={`${viewToolBtn} w-auto px-2 gap-1 text-primary`}
                    onClick={handleMergeSelected}
                  >
                    <Link2 size={15} />
                    <span className="text-xs font-semibold">Fusionar</span>
                  </button>
                </div>
              )}
              {splitPreview && splitPreview.components > 1 && (
                <div className="tooltip tooltip-bottom" data-tip="Separar islas de malla desconectadas">
                  <button
                    type="button"
                    className={`${viewToolBtn} w-auto px-2 gap-1`}
                    onClick={handleSplitComponents}
                  >
                    <SquareSplitHorizontal size={15} />
                    <span className="text-xs font-semibold">{splitPreview.components} comp.</span>
                  </button>
                </div>
              )}
              {splitPreview && splitPreview.panels > 1 && (
                <div className="tooltip tooltip-bottom" data-tip="Separar paneles coplanares unidos (L, escalones)">
                  <button
                    type="button"
                    className={`${viewToolBtn} w-auto px-2 gap-1`}
                    onClick={handleSplitPanels}
                  >
                    <SquareSplitHorizontal size={15} />
                    <span className="text-xs font-semibold">{splitPreview.panels} piezas</span>
                  </button>
                </div>
              )}
              {selectedGroupIds.size === 1 && (
                <div className="tooltip tooltip-bottom" data-tip="Ocultar seleccionado">
                  <button
                    type="button"
                    className={viewToolBtn}
                    onClick={() => handleHideGroup(Array.from(selectedGroupIds)[0])}
                  >
                    <EyeOff size={15} />
                  </button>
                </div>
              )}
              {hiddenGroupIds.size > 0 && (
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
              )}
              <div className="tooltip tooltip-bottom" data-tip={`Rotar eje (${phase1.appliedAxis === "Y" ? "Y↑" : "Z↑"})`}>
                <button
                  type="button"
                  className={viewToolBtn}
                  onClick={handleRotateAxis}
                  disabled={isRotating || isGenerating}
                  aria-busy={isRotating}
                >
                  {isRotating ? (
                    <span className="loading loading-spinner loading-xs" />
                  ) : (
                    <RefreshCw size={15} />
                  )}
                </button>
              </div>
              <div className="tooltip tooltip-bottom" data-tip={showCenterAxes ? "Ocultar ejes" : "Mostrar ejes"}>
                <button
                  type="button"
                  className={viewToolBtn}
                  onClick={() => setShowCenterAxes((s) => !s)}
                >
                  <Crosshair size={15} className={showCenterAxes ? "text-primary" : "text-base-content/50"} />
                </button>
              </div>
              <div className="tooltip tooltip-bottom" data-tip={isSolid ? "Vista transparente" : "Vista maciza"}>
                <button
                  type="button"
                  className={`${viewToolBtn} ${isSolid ? "bg-primary/15 text-primary hover:bg-primary/20" : ""}`}
                  onClick={() => setIsSolid((s) => !s)}
                >
                  <Box size={15} />
                </button>
              </div>
              <div className="tooltip tooltip-bottom" data-tip={hideSidebar ? "Mostrar panel" : "Pantalla completa"}>
                <button
                  type="button"
                  className={`${viewToolBtn} ${hideSidebar ? "bg-primary/15 text-primary hover:bg-primary/20" : ""}`}
                  onClick={() => setHideSidebar((s) => !s)}
                >
                  {hideSidebar ? <Minimize size={15} /> : <Maximize size={15} />}
                </button>
              </div>
            </div>

            <div className="hidden sm:block w-px h-7 bg-base-300/50" />

            <div
              className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-base-200/50 border border-base-300/30"
              title="Componentes más chicos que este umbral se descartan al generar"
            >
              <SlidersHorizontal size={13} className="text-base-content/40 shrink-0" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-base-content/50 hidden lg:inline">
                Mín. área
              </span>
              <select
                className="select select-ghost select-xs h-7 min-h-0 rounded-lg font-mono font-semibold px-1"
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
          </div>
        </div>

        {selectedGroupIds.size === 1 && (() => {
          const selId = Array.from(selectedGroupIds)[0];
          const selGroup = effectivePhase1.groups.find((g) => g.id === selId);
          if (!selGroup) return null;

          const groupWWJoints = wallWallList.filter(
            ({ ww }) => ww.groupA === selId || ww.groupB === selId,
          );

          if (groupWWJoints.length === 0) return null;

          const groupById = new Map(effectivePhase1.groups.map((g) => [g.id, g]));

          return (
            <div className="absolute bottom-5 right-5 z-10 w-[19rem] max-h-[42vh] overflow-y-auto bg-base-100/90 backdrop-blur-xl border border-base-300/40 rounded-2xl shadow-xl shadow-base-content/8 pointer-events-auto custom-scrollbar hidden md:block">
              <div className="sticky top-0 z-10 px-4 pt-4 pb-3 bg-base-100/95 backdrop-blur-md border-b border-base-300/30">
                <div className="flex items-center gap-2">
                  <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 text-primary shrink-0">
                    <Link2 size={15} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {panelIdByGroup.get(selId) && (
                        <span className="font-mono text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-bold">
                          {panelIdByGroup.get(selId)}
                        </span>
                      )}
                      <span className="text-sm font-semibold truncate">{selGroup.label}</span>
                    </div>
                    <p className="text-[10px] text-base-content/45 mt-0.5">
                      {groupWWJoints.length} unión{groupWWJoints.length !== 1 ? "es" : ""} pared-pared
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-4 pt-3 flex flex-col gap-3">
                <p className="text-[10px] leading-relaxed text-base-content/45">
                  Elegí qué pared cede grosor para que encajen sin superponerse.
                </p>
                <div className="flex flex-col gap-2">
                    {groupWWJoints.map(({ ww, labelA, labelB, pidA, pidB, hasThickness }) => {
                      const otherId = ww.groupA === selId ? ww.groupB : ww.groupA;
                      const otherLabel = ww.groupA === selId ? labelB : labelA;
                      const otherPid = ww.groupA === selId ? pidB : pidA;
                      const selPid = panelIdByGroup.get(selId);
                      const effYielder = wallWallDecisions.get(ww.jointIndex) ?? ww.suggestedYieldGroupId;

                      const selThick = groupById.get(selId)?.thickness ?? 0;
                      const otherThick = groupById.get(otherId)?.thickness ?? 0;
                      const trimIfSel = otherThick > 0.001 ? otherThick : selThick > 0.001 ? selThick : 0;
                      const trimIfOther = selThick > 0.001 ? selThick : otherThick > 0.001 ? otherThick : 0;

                      return (
                        <div
                          key={ww.jointIndex}
                          onClick={() =>
                            setSelectedJointIndex((cur) =>
                              cur === ww.jointIndex ? null : ww.jointIndex,
                            )
                          }
                          className={`rounded-xl p-3 flex flex-col gap-2.5 border transition-all cursor-pointer ${
                            selectedJointIndex === ww.jointIndex
                              ? "border-primary/40 bg-primary/5 shadow-sm ring-1 ring-primary/20"
                              : "border-base-300/40 bg-base-200/30 hover:bg-base-200/50 hover:border-base-300/60"
                          }`}
                        >
                          <div className="text-xs font-medium flex items-center gap-1.5 text-base-content/75">
                            <span className="text-base-content/40">con</span>
                            {otherPid && (
                              <span className="font-mono bg-base-100 border border-base-300/40 px-1.5 py-0.5 rounded text-[10px]">
                                {otherPid}
                              </span>
                            )}
                            <span className="truncate">{otherLabel}</span>
                          </div>
                          {!hasThickness ? (
                            <span className="text-[10px] text-base-content/45 italic px-2 py-1.5 rounded-lg bg-base-100/80 border border-base-300/30">
                              Sin grosor — no se puede recortar
                            </span>
                          ) : (
                            <div className="space-y-1.5">
                              <span className="text-[9px] uppercase font-semibold tracking-widest text-base-content/40">
                                Se recorta
                              </span>
                              <div className="grid grid-cols-2 gap-1.5">
                                <button
                                  type="button"
                                  className={`btn btn-xs h-8 min-h-8 rounded-lg font-medium border ${
                                    effYielder === selId
                                      ? "btn-primary text-primary-content border-primary"
                                      : "btn-ghost bg-base-100 border-base-300/40"
                                  }`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleWallWallDecision(ww.jointIndex, selId, ww.groupA, ww.groupB);
                                  }}
                                >
                                  {selPid && <span className="font-mono opacity-70 mr-1 text-[10px]">{selPid}</span>}
                                  Esta
                                  {effYielder === selId && trimIfSel > 0.001 && (
                                    <span className="ml-1 opacity-70 text-[10px] font-mono">−{(trimIfSel * 100).toFixed(1)}</span>
                                  )}
                                </button>
                                <button
                                  type="button"
                                  className={`btn btn-xs h-8 min-h-8 rounded-lg font-medium border ${
                                    effYielder === otherId
                                      ? "btn-primary text-primary-content border-primary"
                                      : "btn-ghost bg-base-100 border-base-300/40"
                                  }`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleWallWallDecision(ww.jointIndex, otherId, ww.groupA, ww.groupB);
                                  }}
                                >
                                  {otherPid && <span className="font-mono opacity-70 mr-1 text-[10px]">{otherPid}</span>}
                                  Otra
                                  {effYielder === otherId && trimIfOther > 0.001 && (
                                    <span className="ml-1 opacity-70 text-[10px] font-mono">−{(trimIfOther * 100).toFixed(1)}</span>
                                  )}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {!hideSidebar && (
        <aside className="w-full md:w-[21rem] lg:w-[24rem] flex flex-col border-t md:border-t-0 md:border-l border-base-300/40 bg-base-100 shrink-0 h-[42vh] md:h-full z-20 shadow-2xl shadow-base-content/5">
        <div className="px-4 pt-4 pb-3 border-b border-base-300/30 shrink-0">
          <StepIndicator current="review" />
        </div>
        <div className="px-4 py-3.5 border-b border-base-300/30 bg-base-100/80">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-primary/80 mb-0.5">
            Revisión
          </p>
          <h2 className="text-base font-semibold tracking-tight">Clasificación del modelo</h2>
          <p className="text-[11px] text-base-content/45 mt-0.5 leading-relaxed">
            Verificá capas, fusiones y uniones antes de generar planos.
          </p>
        </div>

        {bulkActionNotice && (
          <div className="px-4 py-2 border-b border-base-300/30 bg-success/5">
            <p className="text-[10px] text-success font-medium px-2 py-1.5 rounded-lg bg-success/10 border border-success/20">
              {bulkActionNotice}
            </p>
          </div>
        )}

        <GroupList
          groups={effectivePhase1.groups}
          selectedGroupIds={selectedGroupIds}
          hiddenGroupIds={hiddenGroupIds}
          categoryOverrides={overrides}
          visibleCategories={visibleCategories}
          onSelectGroup={handleSelectGroup}
          onToggleGroup={handleToggleGroup}
          onHideGroup={handleHideGroup}
          onShowGroup={handleShowGroup}
          onShowAllHidden={handleShowAllHidden}
          onChangeCategory={handleChangeCategory}
          onOpenContextMenu={openViewerContextMenu}
        />

        {selectedGroupIds.size === 1 && sameAreaMatches.length > 0 && (
          <div className="px-4 py-2 border-b border-base-300/30 bg-base-100/60">
            <p className="text-[10px] text-base-content/45 mb-2">
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
            <p className="text-[10px] text-base-content/45 mb-2 leading-relaxed">
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

        {selectedGroup && getEffectiveCategory(selectedGroup, overrides) === "wall" && (
          <div className="px-4 py-2 border-b border-base-300/30 bg-primary/5">
            <p className="text-[10px] text-base-content/50 leading-relaxed">
              Seleccioná más piezas del mismo plano y clic derecho → Fusionar, o usá los checkboxes.
            </p>
          </div>
        )}

        {(canMergeSelected || mergeBlockedReason || (splitPreview && (splitPreview.components > 1 || splitPreview.panels > 1))) && (
          <div className="px-4 py-3 border-b border-base-300/30 bg-base-100/60 space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-base-content/40">
              Capas · fusión / división
            </p>

            {canMergeSelected && primaryMergeCluster && (
              <button
                type="button"
                className="btn btn-primary btn-sm w-full rounded-xl gap-2"
                onClick={handleMergeSelected}
              >
                <Link2 size={14} />
                Fusionar {primaryMergeCluster.length} paredes del mismo plano
              </button>
            )}

            {mergeBlockedReason && (
              <p className="text-[10px] text-base-content/45 leading-relaxed px-1">
                {mergeBlockedReason}
              </p>
            )}

            {splitPreview && splitPreview.components > 1 && (
              <button
                type="button"
                className="btn btn-outline btn-sm w-full rounded-xl gap-2 border-warning/40 text-base-content/80 hover:border-warning"
                onClick={handleSplitComponents}
              >
                <SquareSplitHorizontal size={14} />
                Dividir en {splitPreview.components} componentes
              </button>
            )}

            {splitPreview && splitPreview.panels > 1 && (
              <>
                <button
                  type="button"
                  className="btn btn-outline btn-sm w-full rounded-xl gap-2 border-warning/40 text-base-content/80 hover:border-warning"
                  onClick={handleSplitPanels}
                >
                  <SquareSplitHorizontal size={14} />
                  Dividir en {splitPreview.panels} piezas
                </button>
                <p className="text-[10px] text-base-content/40 leading-relaxed px-1">
                  Para paneles en L o escalones. Una pared lisa no necesita dividirse.
                </p>
              </>
            )}

            {selectedGroupIds.size >= 2 && !canMergeSelected && !mergeBlockedReason && (
              <p className="text-[10px] text-base-content/45 leading-relaxed px-1">
                Seleccioná varias capas con Ctrl+clic o los checkboxes de la lista.
              </p>
            )}
          </div>
        )}

        {selectedGroupIds.size >= 2 && !canMergeSelected && !mergeBlockedReason && (
          <div className="px-4 py-2 border-b border-base-300/30 bg-base-100/40">
            <p className="text-[10px] text-base-content/45 leading-relaxed">
              Ctrl+clic en la lista para seleccionar varias capas y fusionarlas.
            </p>
          </div>
        )}

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
                  const labels = ids.map((id) => {
                    const g = phase1.groups.find((gr) => gr.id === id);
                    return g?.label ?? `Grupo ${id}`;
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
          <div className="grid grid-cols-3 gap-1.5 mb-3">
            <div className="text-center px-2 py-2 rounded-lg bg-success/8 border border-success/15">
              <p className="text-lg font-bold tabular-nums text-success leading-none">{stats.floors}</p>
              <p className="text-[9px] uppercase tracking-wider text-base-content/45 mt-1">Pisos</p>
            </div>
            <div className="text-center px-2 py-2 rounded-lg bg-info/8 border border-info/15">
              <p className="text-lg font-bold tabular-nums text-info leading-none">{stats.walls}</p>
              <p className="text-[9px] uppercase tracking-wider text-base-content/45 mt-1">Paredes</p>
            </div>
            <div className="text-center px-2 py-2 rounded-lg bg-base-200/80 border border-base-300/30">
              <p className="text-lg font-bold tabular-nums text-base-content/60 leading-none">{stats.discarded}</p>
              <p className="text-[9px] uppercase tracking-wider text-base-content/45 mt-1">Descart.</p>
            </div>
          </div>

          {overrides.size > 0 && (
            <p className="text-[10px] text-warning mb-3 px-2 py-1.5 rounded-lg bg-warning/8 border border-warning/15 text-center font-medium">
              {overrides.size} clasificación{overrides.size !== 1 ? "es" : ""} modificada{overrides.size !== 1 ? "s" : ""}
            </p>
          )}

          {wallWallList.length > 0 && (
            <p className="text-[10px] leading-relaxed text-base-content/45 mb-3 px-2.5 py-2 rounded-lg bg-base-200/50 border border-base-300/25">
              Las uniones entre paredes se resolvieron automáticamente. Revisá cada pared en el visor 3D.
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
                ? "Descartar capas del mismo tamaño"
                : "Reclasificar capas del mismo tamaño"}
            </h3>
            <p className="text-xs text-base-content/55 mt-2 leading-relaxed">
              Estas capas tienen{" "}
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
                      <span className="text-[10px] text-base-content/45">
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
