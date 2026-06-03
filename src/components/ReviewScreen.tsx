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

  const handleRotateAxis = useCallback(() => {
    const newAxis = phase1.appliedAxis === "Y" ? "Z" : "Y";
    const updated = reclassifyWithAxis(phase1, newAxis);
    setOverrides(new Map());
    setSelectedGroupIds(new Set());
    onAxisChange(updated);
  }, [phase1, onAxisChange]);

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

  return (
    <div className="review-overlay">
      <div className="review-viewer">
        <ModelViewer
          faces={effectivePhase1.faces}
          groups={effectivePhase1.groups}
          selectedGroupIds={selectedGroupIds}
          categoryOverrides={overrides}
          visibleCategories={visibleCategories}
          onSelectGroup={handleSelectGroup}
          onToggleGroup={handleToggleGroup}
        />
        <div className="review-viewer-overlay">
          <VisibilityFilters
            stats={stats}
            visibleCategories={visibleCategories}
            onToggle={handleToggleVisibility}
          />
          <button
            className="axis-toggle-btn"
            onClick={handleRotateAxis}
            title="Intercambiar eje vertical (Y/Z) si pisos y paredes están invertidos"
          >
            Rotar eje ({phase1.appliedAxis === "Y" ? "Y↑" : "Z↑"})
          </button>
          <div
            className="min-area-control"
            title="Componentes más chicos que este umbral se descartan al generar las planchas"
          >
            <label className="min-area-label">Descartar &lt;</label>
            <select
              className="min-area-select"
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
          {wallWallList.length > 0 && (
            <span className="viewer-hint">
              Seleccioná una pared para ver o editar sus uniones
            </span>
          )}
        </div>
      </div>

      <div className="review-sidebar">
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
          <div className="merge-action-bar">
            <button className="merge-btn" onClick={handleMergeSelected}>
              Fusionar seleccionados ({selectedGroupIds.size})
            </button>
          </div>
        )}

        {merges.length > 0 && (
          <div className={`merge-card ${mergeCardOpen ? "" : "merge-card--collapsed"}`}>
            <button
              className="merge-card-header"
              onClick={() => setMergeCardOpen((o) => !o)}
            >
              <span className="merge-card-title">
                Fusiones ({merges.length})
              </span>
              <span className="merge-card-chevron">{mergeCardOpen ? "▾" : "▸"}</span>
            </button>
            {mergeCardOpen && (
              <div className="merge-card-body">
                {merges.map((ids, i) => {
                  const labels = ids.map((id) => {
                    const g = phase1.groups.find((gr) => gr.id === id);
                    return g?.label ?? `Grupo ${id}`;
                  });
                  return (
                    <div key={i} className="merge-row">
                      <span className="merge-row-labels">{labels.join(" + ")}</span>
                      <button
                        className="merge-row-remove"
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

        {selectedGroupIds.size === 1 && (() => {
          const selId = Array.from(selectedGroupIds)[0];
          const selGroup = effectivePhase1.groups.find((g) => g.id === selId);
          if (!selGroup) return null;

          const groupJoints = effectivePhase1.joints.filter(
            (j) => j.groupA === selId || j.groupB === selId,
          );
          const groupAdjs = effectivePhase1.adjustments.filter(
            (a) => a.groupId === selId,
          );
          const groupWWJoints = wallWallList.filter(
            ({ ww }) => ww.groupA === selId || ww.groupB === selId,
          );

          if (groupJoints.length === 0 && !selGroup.thickness && groupWWJoints.length === 0) return null;

          const groupById = new Map(effectivePhase1.groups.map((g) => [g.id, g]));

          return (
            <div className="assembly-detail">
              {selGroup.thickness != null && (
                <div className="assembly-detail-row">
                  <span className="assembly-detail-label">Grosor detectado</span>
                  <span className="assembly-detail-value">{(selGroup.thickness * 100).toFixed(1)} cm</span>
                </div>
              )}
              {groupJoints.length > 0 && (
                <div className="assembly-detail-section">
                  <span className="assembly-detail-label">Juntas ({groupJoints.length})</span>
                  {groupJoints.map((j, i) => {
                    const otherId = j.groupA === selId ? j.groupB : j.groupA;
                    const other = groupById.get(otherId);
                    return (
                      <div key={i} className="assembly-joint-row">
                        <span>{other?.label ?? `Grupo ${otherId}`}</span>
                        <span className="assembly-joint-meta">
                          {j.totalLength.toFixed(2)}m · {j.dihedralAngle.toFixed(0)}°
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
              {groupAdjs.length > 0 && (
                <div className="assembly-detail-section">
                  <span className="assembly-detail-label">Ajustes de ensamblaje</span>
                  {groupAdjs.map((a, i) => (
                    <div key={i} className="assembly-adj-row">
                      <span>{a.reason}</span>
                      <span className="assembly-adj-delta">
                        {(a.delta * 100).toFixed(1)} cm
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {groupWWJoints.length > 0 && (
                <div className="assembly-detail-section">
                  <span className="assembly-detail-label">
                    Uniones pared-pared ({groupWWJoints.length})
                  </span>
                  <span className="ww-ctx-help">
                    La pared que se recorta se acorta el grosor de la otra para que encajen sin superponerse.
                  </span>
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
                      <div key={ww.jointIndex} className="ww-joint-card">
                        <div className="ww-joint-header">
                          Unión con{" "}
                          {otherPid && <span className="ww-ctx-pid">{otherPid}</span>}{" "}
                          <span className="ww-ctx-name">{otherLabel}</span>
                        </div>
                        {!hasThickness ? (
                          <span className="ww-ctx-nothick">Sin grosor — no se puede recortar</span>
                        ) : (
                          <div className="ww-seg-row">
                            <span className="ww-seg-label">Se recorta:</span>
                            <div className="ww-seg">
                              <button
                                className={`ww-seg-option${effYielder === selId ? " ww-seg-option--active" : ""}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleWallWallDecision(ww.jointIndex, selId, ww.groupA, ww.groupB);
                                }}
                              >
                                {selPid && <span className="ww-seg-pid">{selPid}</span>}
                                Esta
                                {effYielder === selId && trimIfSel > 0.001 && (
                                  <span className="ww-trim-tag">&minus;{(trimIfSel * 100).toFixed(1)} cm</span>
                                )}
                              </button>
                              <button
                                className={`ww-seg-option${effYielder === otherId ? " ww-seg-option--active" : ""}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleWallWallDecision(ww.jointIndex, otherId, ww.groupA, ww.groupB);
                                }}
                              >
                                {otherPid && <span className="ww-seg-pid">{otherPid}</span>}
                                Otra
                                {effYielder === otherId && trimIfOther > 0.001 && (
                                  <span className="ww-trim-tag">&minus;{(trimIfOther * 100).toFixed(1)} cm</span>
                                )}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}

        <div className="review-bottom-bar">
          <div className="review-stats">
            <span className="stat-item stat-floor">{stats.floors} pisos</span>
            <span className="stat-sep">·</span>
            <span className="stat-item stat-wall">{stats.walls} paredes</span>
            <span className="stat-sep">·</span>
            <span className="stat-item stat-discard">{stats.discarded} descartados</span>
            {overrides.size > 0 && (
              <>
                <span className="stat-sep">·</span>
                <span className="stat-item stat-changes">{overrides.size} cambio{overrides.size !== 1 ? "s" : ""}</span>
              </>
            )}
          </div>
          {wallWallList.length > 0 && (
            <p className="ww-preconfirm-hint">
              Las uniones entre paredes fueron resueltas automáticamente.
              Seleccioná una pared para revisar qué pared se recorta en cada unión.
            </p>
          )}
          <div className="review-actions">
            <button className="review-btn review-btn--cancel" onClick={onCancel}>
              Volver
            </button>
            <button className="review-btn review-btn--confirm" onClick={handleConfirm}>
              Confirmar y Generar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
