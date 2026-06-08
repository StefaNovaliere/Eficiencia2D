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
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] uppercase tracking-wider font-bold text-base-content/50 mr-1">Mostrar:</span>
      {ORDER.map((cat) => {
        const visible = visibleCategories.has(cat);
        return (
          <button
            key={cat}
            className={`btn btn-xs rounded-full border shadow-sm transition-all duration-200 ${
              visible 
                ? "bg-base-100 hover:bg-base-200" 
                : "bg-base-200/40 text-base-content/40 border-transparent hover:bg-base-200"
            }`}
            style={visible ? { borderColor: CATEGORY_COLORS[cat] } : undefined}
            onClick={() => onToggle(cat)}
          >
            <span
              className={`w-2 h-2 rounded-full border transition-colors ${visible ? "border-transparent" : "border-base-content/30"}`}
              style={{ backgroundColor: visible ? CATEGORY_COLORS[cat] : "transparent" }}
            />
            {CATEGORY_LABELS[cat]} <span className="opacity-60 ml-0.5">({counts[cat]})</span>
          </button>
        );
      })}
    </div>
  );
}
