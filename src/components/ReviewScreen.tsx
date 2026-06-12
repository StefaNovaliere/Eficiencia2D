"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import GroupList from "./GroupList";
import VisibilityFilters from "./VisibilityFilters";
import type { FaceCategory, GeometryGroup } from "@/core/group-classifier";
import { reclassifyWithAxis, computePanelIdByGroup, applyMerges, areGroupsCoplanar } from "@/core/pipeline";
import type { Phase1Result, ClassificationOverride } from "@/core/pipeline";
import type { Joint } from "@/core/joint-detector";
import type { DimensionAdjustment } from "@/core/assembly-adjuster";
import type { LeaderMarker } from "./ModelViewer";
import { RefreshCw, Box, Maximize, Minimize, Crosshair } from "lucide-react";

export type WallWallDecisions = Map<number, number>;

const ModelViewer = dynamic(() => import("./ModelViewer"), { ssr: false });

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
  onConfirm: (overrides: ClassificationOverride[], wallWallDecisions: WallWallDecisions, merges: number[][]) => void;
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

  // Effective phase1 with merges applied.
  const effectivePhase1 = useMemo(
    () => merges.length > 0 ? applyMerges(phase1, merges) : phase1,
    [phase1, merges],
  );

  const handleSelectGroup = useCallback((id: number) => {
    setSelectedGroupIds((prev) => {
      if (id === -1) return new Set();
      if (prev.size === 1 && prev.has(id)) return new Set();
      return new Set([id]);
    });
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
  }, []);

  const handleChangeCategory = useCallback(
    (id: number, category: FaceCategory) => {
      setOverrides((prev) => {
        const next = new Map(prev);
        const idsToUpdate = selectedGroupIds.has(id)
          ? Array.from(selectedGroupIds)
          : [id];
        for (const gid of idsToUpdate) {
          const original = effectivePhase1.groups.find((g) => g.id === gid)?.category;
          if (original === category) {
            next.delete(gid);
          } else {
            next.set(gid, category);
          }
        }
        return next;
      });
    },
    [effectivePhase1.groups, selectedGroupIds],
  );

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
    onMinAreaChange(newArea);
  }, [onMinAreaChange]);

  // Merge selected coplanar groups into one panel.
  const canMergeSelected = useMemo(() => {
    if (selectedGroupIds.size < 2) return false;
    const selected = Array.from(selectedGroupIds)
      .map((id) => effectivePhase1.groups.find((g) => g.id === id))
      .filter((g): g is GeometryGroup => g != null);
    if (selected.length < 2) return false;
    return areGroupsCoplanar(selected);
  }, [selectedGroupIds, effectivePhase1.groups]);

  const handleMergeSelected = useCallback(() => {
    const ids = Array.from(selectedGroupIds);
    if (ids.length < 2) return;
    setMerges((prev) => [...prev, ids]);
    setSelectedGroupIds(new Set());
  }, [selectedGroupIds]);

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
    onConfirm(result, wallWallDecisions, merges);
  }, [overrides, wallWallDecisions, merges, onConfirm]);

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

  return (
    <div className="fixed inset-0 z-50 bg-base-100 flex flex-col md:flex-row overflow-hidden">
      <div className="flex-1 relative bg-base-200/30 overflow-hidden">
        <ModelViewer
          faces={effectivePhase1.faces}
          groups={effectivePhase1.groups}
          selectedGroupIds={selectedGroupIds}
          categoryOverrides={overrides}
          visibleCategories={visibleCategories}
          onSelectGroup={handleSelectGroup}
          onToggleGroup={handleToggleGroup}
          appliedAxis={phase1.appliedAxis}
          showCenterAxes={showCenterAxes}
          leaderMarkers={leaderMarkers}
          isSolid={isSolid}
        />
        <div className="absolute top-6 left-6 right-6 z-10 flex flex-wrap items-center gap-3 pointer-events-auto">
          <div className="flex flex-wrap items-center gap-3 bg-base-100/70 backdrop-blur-xl border border-base-200/50 p-2 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
            <VisibilityFilters
              stats={stats}
              visibleCategories={visibleCategories}
              onToggle={handleToggleVisibility}
            />
            <div className="w-[1px] h-8 bg-base-300/50 mx-1"></div>
            <div className="tooltip tooltip-bottom" data-tip={`Rotar eje (${phase1.appliedAxis === "Y" ? "Y↑" : "Z↑"})`}>
              <button
                className="btn btn-sm btn-ghost hover:bg-base-200 rounded-xl"
                onClick={handleRotateAxis}
                disabled={isRotating || isGenerating}
                aria-busy={isRotating}
              >
                {isRotating ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : (
                  <RefreshCw size={16} />
                )}
              </button>
            </div>
            <div className="tooltip tooltip-bottom" data-tip={showCenterAxes ? "Ocultar eje" : "Mostrar eje"}>
              <button
                className="btn btn-sm btn-ghost hover:bg-base-200 rounded-xl"
                onClick={() => setShowCenterAxes((s) => !s)}
              >
                <Crosshair size={16} className={showCenterAxes ? "text-primary" : "text-base-content/70"} />
              </button>
            </div>
            <div className="tooltip tooltip-bottom" data-tip={isSolid ? "Vista Transparente" : "Vista Maciza"}>
              <button
                className={`btn btn-sm ${isSolid ? 'btn-primary text-primary-content' : 'btn-ghost hover:bg-base-200'} rounded-xl transition-colors`}
                onClick={() => setIsSolid((s) => !s)}
              >
                <Box size={16} />
              </button>
            </div>
            <div className="tooltip tooltip-bottom" data-tip={hideSidebar ? "Mostrar Panel" : "Pantalla Completa"}>
              <button
                className={`btn btn-sm ${hideSidebar ? 'btn-primary text-primary-content' : 'btn-ghost hover:bg-base-200'} rounded-xl transition-colors`}
                onClick={() => setHideSidebar((s) => !s)}
              >
                {hideSidebar ? <Minimize size={16} /> : <Maximize size={16} />}
              </button>
            </div>
            <div className="w-[1px] h-8 bg-base-300/50 mx-1"></div>
            <div
              className="flex items-center bg-base-200/40 border border-base-200/80 rounded-lg overflow-hidden h-8 shadow-sm transition-colors hover:bg-base-200/60"
              title="Componentes más chicos que este umbral se descartan al generar las planchas"
            >
              <span className="text-[10px] font-bold uppercase tracking-wider text-base-content/70 px-2.5 border-r border-base-200/80 bg-base-200/70 h-full flex items-center">
                Descartar &lt;
              </span>
              <select
                className="select select-ghost select-sm h-full min-h-0 rounded-none focus:outline-none focus:bg-transparent text-xs font-mono font-bold px-2"
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
          {wallWallList.length > 0 && (
            <span className="text-xs font-medium bg-info/10 text-info px-3 py-1.5 rounded-full border border-info/20 shadow-sm hidden md:inline-block animate-pulse">
              Seleccioná una pared para ver o editar sus uniones
            </span>
          )}
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
            <div className="absolute bottom-6 right-6 z-10 w-80 max-h-[45vh] overflow-y-auto bg-base-100/80 backdrop-blur-xl border border-base-200/50 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] p-4 pointer-events-auto custom-scrollbar hidden md:block">
              <div className="flex items-center gap-2 mb-3">
                {panelIdByGroup.get(selId) && (
                  <span className="font-mono text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded font-bold">{panelIdByGroup.get(selId)}</span>
                )}
                <span className="text-xs font-bold text-base-content/70 truncate">{selGroup.label}</span>
              </div>
              {groupWWJoints.length > 0 && (
                <div className="flex flex-col gap-2">
                  <span className="text-[11px] font-black uppercase tracking-wider text-base-content/50 ml-1">
                    Uniones pared-pared ({groupWWJoints.length})
                  </span>
                  <span className="text-[10px] leading-tight text-base-content/50 italic mb-2 ml-1">
                    La pared que se recorta se acorta el grosor de la otra para que encajen sin superponerse.
                  </span>
                  <div className="flex flex-col gap-2.5">
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
                          className={`bg-base-200/50 border rounded-xl p-2.5 flex flex-col gap-2.5 shadow-sm hover:shadow-md transition-shadow cursor-pointer ${
                            selectedJointIndex === ww.jointIndex
                              ? "border-primary ring-2 ring-primary/40 bg-primary/5"
                              : "border-base-200"
                          }`}
                        >
                          <div className="text-xs font-semibold flex items-center gap-1.5 text-base-content/80">
                            Unión con{" "}
                            {otherPid && <span className="font-mono bg-base-100 shadow-sm border border-base-300/50 px-1.5 rounded text-[10px]">{otherPid}</span>}{" "}
                            <span className="truncate">{otherLabel}</span>
                          </div>
                          {!hasThickness ? (
                            <span className="text-[10px] text-base-content/50 italic bg-base-100 p-2 rounded-lg border border-base-200/50">Sin grosor — no se puede recortar</span>
                          ) : (
                            <div className="flex items-center justify-between bg-base-100 p-2 rounded-lg border border-base-200/50">
                              <span className="text-[10px] uppercase font-bold text-base-content/50 tracking-wide">Se recorta:</span>
                              <div className="join shadow-sm">
                                <button
                                  className={`btn btn-xs join-item font-medium h-7 px-3 border-base-300/50 ${effYielder === selId ? "btn-active bg-primary hover:bg-primary border-primary text-primary-content" : "bg-base-100 hover:bg-base-200"}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleWallWallDecision(ww.jointIndex, selId, ww.groupA, ww.groupB);
                                  }}
                                >
                                  {selPid && <span className="font-mono opacity-80 mr-1.5 text-[10px]">{selPid}</span>}
                                  Esta
                                  {effYielder === selId && trimIfSel > 0.001 && (
                                    <span className="ml-1.5 bg-black/10 rounded px-1 text-[10px] font-mono">&minus;{(trimIfSel * 100).toFixed(1)}</span>
                                  )}
                                </button>
                                <button
                                  className={`btn btn-xs join-item font-medium h-7 px-3 border-base-300/50 ${effYielder === otherId ? "btn-active bg-primary hover:bg-primary border-primary text-primary-content" : "bg-base-100 hover:bg-base-200"}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleWallWallDecision(ww.jointIndex, otherId, ww.groupA, ww.groupB);
                                  }}
                                >
                                  {otherPid && <span className="font-mono opacity-80 mr-1.5 text-[10px]">{otherPid}</span>}
                                  Otra
                                  {effYielder === otherId && trimIfOther > 0.001 && (
                                    <span className="ml-1.5 bg-black/10 rounded px-1 text-[10px] font-mono">&minus;{(trimIfOther * 100).toFixed(1)}</span>
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
              )}
            </div>
          );
        })()}
      </div>

      {!hideSidebar && (
        <div className="w-full md:w-[22rem] lg:w-[26rem] flex flex-col border-t md:border-t-0 md:border-l border-base-200/60 bg-base-100/95 backdrop-blur-3xl shrink-0 h-[40vh] md:h-full shadow-[-20px_0_40px_-15px_rgba(0,0,0,0.05)] z-20">
        <GroupList
          groups={effectivePhase1.groups}
          selectedGroupIds={selectedGroupIds}
          categoryOverrides={overrides}
          visibleCategories={visibleCategories}
          onSelectGroup={handleSelectGroup}
          onToggleGroup={handleToggleGroup}
          onChangeCategory={handleChangeCategory}
        />

        {selectedGroupIds.size >= 2 && canMergeSelected && (
          <div className="p-4 border-b border-base-200/50 bg-base-200/20 backdrop-blur-sm relative z-10">
            <button className="btn btn-primary w-full rounded-xl shadow-sm" onClick={handleMergeSelected}>
              Fusionar seleccionados ({selectedGroupIds.size})
            </button>
          </div>
        )}

        {merges.length > 0 && (
          <div className="border-b border-base-200/50 relative z-10 bg-base-100/50">
            <button
              className="flex w-full items-center justify-between p-4 hover:bg-base-200/50 transition-colors font-semibold"
              onClick={() => setMergeCardOpen((o) => !o)}
            >
              <span className="text-sm">
                Fusiones ({merges.length})
              </span>
              <span className="text-base-content/50 bg-base-200 rounded-full w-6 h-6 flex items-center justify-center">{mergeCardOpen ? "▾" : "▸"}</span>
            </button>
            {mergeCardOpen && (
              <div className="px-4 pb-4 flex flex-col gap-2">
                {merges.map((ids, i) => {
                  const labels = ids.map((id) => {
                    const g = phase1.groups.find((gr) => gr.id === id);
                    return g?.label ?? `Grupo ${id}`;
                  });
                  return (
                    <div key={i} className="flex justify-between items-center bg-base-200/70 border border-base-200 rounded-xl px-3 py-2 text-xs transition-transform hover:scale-[1.02]">
                      <span className="truncate mr-2 font-medium">{labels.join(" + ")}</span>
                      <button
                        className="text-base-content/50 hover:text-error hover:bg-error/10 w-6 h-6 rounded-md flex items-center justify-center text-lg leading-none transition-colors"
                        onClick={() => handleUnmerge(i)}
                        title="Deshacer fusión"
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="mt-auto border-t border-base-200/50 p-5 bg-base-100 relative z-10 shadow-[0_-10px_30px_rgba(0,0,0,0.03)] shrink-0">
          <div className="flex flex-wrap items-center gap-2 mb-4 text-xs font-medium">
            <div className="px-2.5 py-1 bg-success/10 text-success rounded-lg border border-success/20 flex items-center gap-1">
              {stats.floors} pisos
            </div>
            <div className="px-2.5 py-1 bg-info/10 text-info rounded-lg border border-info/20 flex items-center gap-1">
              {stats.walls} paredes
            </div>
            <div className="px-2.5 py-1 bg-base-200 text-base-content/60 rounded-lg border border-base-300/50 flex items-center gap-1">
              {stats.discarded} descartados
            </div>
            {overrides.size > 0 && (
              <div className="px-2.5 py-1 bg-warning/10 text-warning-content rounded-lg border border-warning/20 flex items-center gap-1 font-bold">
                {overrides.size} cambio{overrides.size !== 1 ? "s" : ""}
              </div>
            )}
          </div>
          {wallWallList.length > 0 && (
            <p className="text-[11px] leading-relaxed text-base-content/50 mb-4 bg-base-200/50 p-3 rounded-xl border border-base-200">
              Las uniones entre paredes fueron resueltas automáticamente.
              Seleccioná una pared para revisar qué pared se recorta en cada unión.
            </p>
          )}
          <div className="flex gap-3">
            <button className="btn flex-1 btn-ghost bg-base-200 hover:bg-base-300 rounded-xl" onClick={onCancel} disabled={isGenerating}>
              Volver
            </button>
            <button 
              className="btn flex-1 btn-primary shadow-lg shadow-primary/30 rounded-xl text-primary-content" 
              onClick={handleConfirm}
              disabled={isGenerating}
            >
              {isGenerating ? (
                <>
                  <span className="loading loading-spinner loading-sm"></span>
                  Generando...
                </>
              ) : (
                "Confirmar y Generar"
              )}
            </button>
          </div>
        </div>
        </div>
      )}
    </div>
  );
}
