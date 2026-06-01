"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import GroupList from "./GroupList";
import VisibilityFilters from "./VisibilityFilters";
import type { FaceCategory, GeometryGroup } from "@/core/group-classifier";
import { reclassifyWithAxis } from "@/core/pipeline";
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
  onConfirm: (overrides: ClassificationOverride[], wallWallDecisions: WallWallDecisions) => void;
  onCancel: () => void;
  onAxisChange: (newPhase1: Phase1Result) => void;
  minAreaM2: number;
  onMinAreaChange: (area: number) => void;
  initialOverrides?: ClassificationOverride[];
  initialWallWallDecisions?: WallWallDecisions;
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
        // Determine which IDs to update: if the changed row is part of the
        // multi-selection, apply to ALL selected groups; otherwise just the one.
        const idsToUpdate = selectedGroupIds.has(id)
          ? Array.from(selectedGroupIds)
          : [id];
        for (const gid of idsToUpdate) {
          const original = phase1.groups.find((g) => g.id === gid)?.category;
          if (original === category) {
            next.delete(gid);
          } else {
            next.set(gid, category);
          }
        }
        return next;
      });
    },
    [phase1.groups, selectedGroupIds],
  );

  // Re-seed wall-wall decisions whenever the underlying phase1 changes (axis
  // rotation / min-area change recompute the joints and their indices). The ref
  // guard skips the initial mount so restored / initial decisions survive.
  const phase1Ref = useRef(phase1);
  useEffect(() => {
    if (phase1Ref.current === phase1) return;
    phase1Ref.current = phase1;
    const m = new Map<number, number>();
    for (const ww of phase1.wallWallJoints) {
      if (ww.suggestedYieldGroupId != null) m.set(ww.jointIndex, ww.suggestedYieldGroupId);
    }
    setWallWallDecisions(m);
  }, [phase1]);

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
    onConfirm(result, wallWallDecisions);
  }, [overrides, wallWallDecisions, onConfirm]);

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
        hasThickness:
          (groupById.get(ww.groupA)?.thickness ?? 0) > 0.001 ||
          (groupById.get(ww.groupB)?.thickness ?? 0) > 0.001,
      }));
  }, [phase1.wallWallJoints, phase1.groups, overrides]);

  return (
    <div className="review-overlay">
      <div className="review-viewer">
        <ModelViewer
          faces={phase1.faces}
          groups={phase1.groups}
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
        </div>
      </div>

      <div className="review-sidebar">
        <GroupList
          groups={phase1.groups}
          selectedGroupIds={selectedGroupIds}
          categoryOverrides={overrides}
          visibleCategories={visibleCategories}
          onSelectGroup={handleSelectGroup}
          onToggleGroup={handleToggleGroup}
          onChangeCategory={handleChangeCategory}
        />

        {wallWallList.length > 0 && (
          <div className="wallwall-panel">
            <div className="wallwall-header">
              <span className="wallwall-title">
                Juntas pared-pared ({wallWallList.length})
              </span>
              <span className="wallwall-hint">
                Elegí qué pared cede el grosor en cada encuentro. Hay un valor
                por defecto (cede la más fina) que podés cambiar.
              </span>
            </div>
            {wallWallList.map(({ ww, labelA, labelB, hasThickness }) => {
              const chosen = wallWallDecisions.get(ww.jointIndex);
              return (
                <div key={ww.jointIndex} className="wallwall-row">
                  <div className="wallwall-pair">
                    <span className="wallwall-vs">{labelA} ↔ {labelB}</span>
                    {!hasThickness && (
                      <span className="wallwall-nothick">sin grosor detectado</span>
                    )}
                  </div>
                  <div className="wallwall-choices">
                    <button
                      className={`wallwall-choice ${chosen === ww.groupA ? "wallwall-choice--on" : ""}`}
                      disabled={!hasThickness}
                      onClick={() => handleWallWallDecision(ww.jointIndex, ww.groupA, ww.groupA, ww.groupB)}
                    >
                      {labelA} cede
                    </button>
                    <button
                      className={`wallwall-choice ${chosen === ww.groupB ? "wallwall-choice--on" : ""}`}
                      disabled={!hasThickness}
                      onClick={() => handleWallWallDecision(ww.jointIndex, ww.groupB, ww.groupA, ww.groupB)}
                    >
                      {labelB} cede
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {selectedGroupIds.size === 1 && (() => {
          const selId = Array.from(selectedGroupIds)[0];
          const selGroup = phase1.groups.find((g) => g.id === selId);
          if (!selGroup) return null;

          const groupJoints = phase1.joints.filter(
            (j) => j.groupA === selId || j.groupB === selId,
          );
          const groupAdjs = phase1.adjustments.filter(
            (a) => a.groupId === selId,
          );

          if (groupJoints.length === 0 && !selGroup.thickness) return null;

          const groupById = new Map(phase1.groups.map((g) => [g.id, g]));

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
