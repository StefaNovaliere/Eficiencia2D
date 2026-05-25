"use client";

import { useCallback, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import GroupList from "./GroupList";
import VisibilityFilters from "./VisibilityFilters";
import type { FaceCategory, GeometryGroup } from "@/core/group-classifier";
import { reclassifyWithAxis } from "@/core/pipeline";
import type { Phase1Result, ClassificationOverride } from "@/core/pipeline";

const ModelViewer = dynamic(() => import("./ModelViewer"), { ssr: false });

const ALL_CATEGORIES: FaceCategory[] = [
  "floor",
  "wall_exterior",
  "wall_interior",
  "discard",
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ReviewScreenProps {
  phase1: Phase1Result;
  onConfirm: (overrides: ClassificationOverride[]) => void;
  onCancel: () => void;
  onAxisChange: (newPhase1: Phase1Result) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ReviewScreen({
  phase1,
  onConfirm,
  onCancel,
  onAxisChange,
}: ReviewScreenProps) {
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [overrides, setOverrides] = useState<Map<number, FaceCategory>>(
    () => new Map(),
  );
  const [visibleCategories, setVisibleCategories] = useState<Set<FaceCategory>>(
    () => new Set(ALL_CATEGORIES),
  );

  const handleSelectGroup = useCallback((id: number) => {
    setSelectedGroupId((prev) => (prev === id || id === -1 ? null : id));
  }, []);

  const handleChangeCategory = useCallback(
    (id: number, category: FaceCategory) => {
      setOverrides((prev) => {
        const next = new Map(prev);
        const original = phase1.groups.find((g) => g.id === id)?.category;
        if (original === category) {
          next.delete(id);
        } else {
          next.set(id, category);
        }
        return next;
      });
    },
    [phase1.groups],
  );

  const handleRotateAxis = useCallback(() => {
    const newAxis = phase1.appliedAxis === "Y" ? "Z" : "Y";
    const updated = reclassifyWithAxis(phase1, newAxis);
    setOverrides(new Map());
    setSelectedGroupId(null);
    onAxisChange(updated);
  }, [phase1, onAxisChange]);

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
    onConfirm(result);
  }, [overrides, onConfirm]);

  // Stats (per effective category).
  const stats = useMemo(() => {
    let floors = 0, wallsExt = 0, wallsInt = 0, discarded = 0;
    for (const group of phase1.groups) {
      const cat = overrides.get(group.id) ?? group.category;
      if (cat === "floor") floors++;
      else if (cat === "wall_exterior") wallsExt++;
      else if (cat === "wall_interior") wallsInt++;
      else discarded++;
    }
    return { floors, wallsExt, wallsInt, discarded };
  }, [phase1.groups, overrides]);

  return (
    <div className="review-overlay">
      <div className="review-viewer">
        <ModelViewer
          faces={phase1.faces}
          groups={phase1.groups}
          selectedGroupId={selectedGroupId}
          categoryOverrides={overrides}
          visibleCategories={visibleCategories}
          onSelectGroup={handleSelectGroup}
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
        </div>
      </div>

      <div className="review-sidebar">
        <GroupList
          groups={phase1.groups}
          selectedGroupId={selectedGroupId}
          categoryOverrides={overrides}
          visibleCategories={visibleCategories}
          onSelectGroup={handleSelectGroup}
          onChangeCategory={handleChangeCategory}
        />

        <div className="review-bottom-bar">
          <div className="review-stats">
            <span className="stat-item stat-floor">{stats.floors} pisos</span>
            <span className="stat-sep">·</span>
            <span className="stat-item stat-wall">{stats.wallsExt + stats.wallsInt} paredes</span>
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
