"use client";

import { useEffect, useRef } from "react";
import type { FaceCategory, GeometryGroup } from "@/core/group-classifier";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CATEGORY_COLORS: Record<FaceCategory, string> = {
  floor: "#22c55e",
  wall: "#3b82f6",
  discard: "#71717a",
};

const CATEGORY_LABELS: Record<FaceCategory, string> = {
  floor: "Piso",
  wall: "Pared",
  discard: "Descartar",
};

const ALL_CATEGORIES: FaceCategory[] = [
  "floor",
  "wall",
  "discard",
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface GroupListProps {
  groups: GeometryGroup[];
  selectedGroupIds: Set<number>;
  categoryOverrides: Map<number, FaceCategory>;
  visibleCategories: Set<FaceCategory>;
  onSelectGroup: (id: number) => void;
  onToggleGroup: (id: number) => void;
  onChangeCategory: (id: number, category: FaceCategory) => void;
}

export default function GroupList({
  groups,
  selectedGroupIds,
  categoryOverrides,
  visibleCategories,
  onSelectGroup,
  onToggleGroup,
  onChangeCategory,
}: GroupListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);

  // Filter by visibility (based on effective category).
  const visibleGroups = groups.filter((g) => {
    const eff = categoryOverrides.get(g.id) ?? g.category;
    return visibleCategories.has(eff);
  });

  const selectedVisibleCount = visibleGroups.reduce(
    (n, g) => (selectedGroupIds.has(g.id) ? n + 1 : n),
    0,
  );
  const allVisibleSelected =
    visibleGroups.length > 0 && selectedVisibleCount === visibleGroups.length;
  const someVisibleSelected = selectedVisibleCount > 0;

  // Scroll selected item into view.
  useEffect(() => {
    if (selectedRef.current) {
      selectedRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [selectedGroupIds]);

  return (
    <div className="group-list" ref={listRef}>
      <div className="group-list-header">
        <h3 className="group-list-title">Clasificacion de Grupos</h3>
        <p className="group-list-subtitle">
          {visibleGroups.length} de {groups.length} grupo{groups.length !== 1 ? "s" : ""}
        </p>
        {visibleGroups.length > 0 && (
          <label className="group-select-all">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              ref={(el) => {
                if (el) el.indeterminate = someVisibleSelected && !allVisibleSelected;
              }}
              onChange={(e) => {
                e.stopPropagation();
                if (allVisibleSelected) {
                  // Deselect all visible
                  for (const g of visibleGroups) {
                    if (selectedGroupIds.has(g.id)) onToggleGroup(g.id);
                  }
                } else {
                  // Select all visible that aren't already selected
                  for (const g of visibleGroups) {
                    if (!selectedGroupIds.has(g.id)) onToggleGroup(g.id);
                  }
                }
              }}
            />
            <span>Seleccionar todos</span>
          </label>
        )}
      </div>

      <div className="group-list-items">
        {visibleGroups.map((group) => {
          const effectiveCat = categoryOverrides.get(group.id) ?? group.category;
          const isSelected = selectedGroupIds.has(group.id);
          const color = CATEGORY_COLORS[effectiveCat];

          return (
            <div
              key={group.id}
              ref={isSelected ? selectedRef : undefined}
              className={`group-row ${isSelected ? "group-row--selected" : ""} ${effectiveCat === "discard" ? "group-row--discard" : ""}`}
              onClick={(e) => {
                if (e.ctrlKey || e.metaKey) {
                  onToggleGroup(group.id);
                } else {
                  onSelectGroup(group.id);
                }
              }}
            >
              <div className="group-row-left">
                <input
                  type="checkbox"
                  className="group-row-checkbox"
                  checked={isSelected}
                  onChange={(e) => {
                    e.stopPropagation();
                    onToggleGroup(group.id);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`Seleccionar ${group.label}`}
                />
                <span
                  className="group-color-dot"
                  style={{ backgroundColor: color }}
                />
                <div className="group-row-info">
                  <span className="group-row-label">{group.label}</span>
                  <span className="group-row-meta">
                    {group.totalArea.toFixed(1)} m² · {group.faceIndices.length} caras
                    {group.thickness != null && ` · ${(group.thickness * 100).toFixed(1)}cm grosor`}
                  </span>
                </div>
              </div>

              <select
                className="category-select"
                value={effectiveCat}
                onChange={(e) => {
                  e.stopPropagation();
                  onChangeCategory(group.id, e.target.value as FaceCategory);
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {ALL_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {CATEGORY_LABELS[cat]}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );
}
