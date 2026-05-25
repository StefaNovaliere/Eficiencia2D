"use client";

import type { FaceCategory } from "@/core/group-classifier";

const CATEGORY_LABELS: Record<FaceCategory, string> = {
  floor: "Pisos",
  wall: "Paredes",
  wall_exterior: "Paredes Ext.",
  wall_interior: "Paredes Int.",
  discard: "Descartados",
};

const CATEGORY_COLORS: Record<FaceCategory, string> = {
  floor: "#22c55e",
  wall: "#a855f7",
  wall_exterior: "#3b82f6",
  wall_interior: "#06b6d4",
  discard: "#71717a",
};

const ORDER: FaceCategory[] = ["floor", "wall", "wall_exterior", "wall_interior", "discard"];

export interface VisibilityFiltersProps {
  stats: { floors: number; walls: number; wallsExt: number; wallsInt: number; discarded: number };
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
    wall_exterior: stats.wallsExt,
    wall_interior: stats.wallsInt,
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
