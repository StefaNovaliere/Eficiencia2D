"use client";

import type { FaceCategory } from "@/core/group-classifier";

const CATEGORY_LABELS: Record<FaceCategory, string> = {
  floor: "Pisos",
  wall: "Paredes",
  discard: "Descartados",
};

const CATEGORY_COLORS: Record<FaceCategory, string> = {
  floor: "#22c55e",
  wall: "#3b82f6",
  discard: "#71717a",
};

const ORDER: FaceCategory[] = ["floor", "wall", "discard"];

export interface VisibilityFiltersProps {
  stats: { floors: number; walls: number; discarded: number };
  visibleCategories: Set<FaceCategory>;
  onToggle: (cat: FaceCategory) => void;
}

export default function VisibilityFilters({
  stats,
  visibleCategories,
  onToggle,
}: VisibilityFiltersProps) {
  const counts: Record<FaceCategory, number> = {
    floor: stats.floors,
    wall: stats.walls,
    discard: stats.discarded,
  };

  return (
    <div className="visibility-filters">
      <span className="visibility-label">Mostrar:</span>
      {ORDER.map((cat) => {
        const visible = visibleCategories.has(cat);
        return (
          <button
            key={cat}
            className={`visibility-chip ${visible ? "visibility-chip--on" : ""}`}
            style={visible ? { borderColor: CATEGORY_COLORS[cat] } : undefined}
            onClick={() => onToggle(cat)}
          >
            <span
              className="visibility-dot"
              style={{ backgroundColor: visible ? CATEGORY_COLORS[cat] : "transparent" }}
            />
            {CATEGORY_LABELS[cat]} ({counts[cat]})
          </button>
        );
      })}
    </div>
  );
}
