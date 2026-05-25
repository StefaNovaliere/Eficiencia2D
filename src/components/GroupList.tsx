"use client";

import { useEffect, useRef } from "react";
import type { FaceCategory, GeometryGroup } from "@/core/group-classifier";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CATEGORY_COLORS: Record<FaceCategory, string> = {
  floor: "#22c55e",
  wall: "#a855f7",
  wall_exterior: "#3b82f6",
  wall_interior: "#06b6d4",
  discard: "#71717a",
};

const CATEGORY_LABELS: Record<FaceCategory, string> = {
  floor: "Piso",
  wall: "Pared",
  wall_exterior: "Pared Exterior",
  wall_interior: "Pared Interior",
  discard: "Descartar",
};

const ALL_CATEGORIES: FaceCategory[] = [
  "floor",
  "wall",
  "wall_exterior",
  "wall_interior",
  "discard",
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface GroupListProps {
  groups: GeometryGroup[];
  selectedGroupId: number | null;
  categoryOverrides: Map<number, FaceCategory>;
  visibleCategories: Set<FaceCategory>;
  onSelectGroup: (id: number) => void;
  onChangeCategory: (id: number, category: FaceCategory) => void;
}

export default function GroupList({
  groups,
  selectedGroupId,
  categoryOverrides,
  visibleCategories,
  onSelectGroup,
  onChangeCategory,
}: GroupListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);

  // Filter by visibility (based on effective category).
  const visibleGroups = groups.filter((g) => {
    const eff = categoryOverrides.get(g.id) ?? g.category;
    return visibleCategories.has(eff);
  });

  // Scroll selected item into view.
  useEffect(() => {
    if (selectedRef.current) {
      selectedRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [selectedGroupId]);

  return (
    <div className="group-list" ref={listRef}>
      <div className="group-list-header">
        <h3 className="group-list-title">Clasificacion de Grupos</h3>
        <p className="group-list-subtitle">
          {visibleGroups.length} de {groups.length} grupo{groups.length !== 1 ? "s" : ""}
        </p>
      </div>

      <div className="group-list-items">
        {visibleGroups.map((group) => {
          const effectiveCat = categoryOverrides.get(group.id) ?? group.category;
          const isSelected = group.id === selectedGroupId;
          const color = CATEGORY_COLORS[effectiveCat];

          return (
            <div
              key={group.id}
              ref={isSelected ? selectedRef : undefined}
              className={`group-row ${isSelected ? "group-row--selected" : ""} ${effectiveCat === "discard" ? "group-row--discard" : ""}`}
              onClick={() => onSelectGroup(group.id)}
            >
              <div className="group-row-left">
                <span
                  className="group-color-dot"
                  style={{ backgroundColor: color }}
                />
                <div className="group-row-info">
                  <span className="group-row-label">{group.label}</span>
                  <span className="group-row-meta">
                    {group.totalArea.toFixed(1)} m² · {group.faceIndices.length} caras
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
