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
    <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-base-200/60 border border-base-300/40">
      {ORDER.map((cat) => {
        const visible = visibleCategories.has(cat);
        return (
          <button
            key={cat}
            type="button"
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
              visible
                ? "bg-base-100 text-base-content shadow-sm"
                : "text-base-content/40 hover:text-base-content/60 hover:bg-base-100/50"
            }`}
            onClick={() => onToggle(cat)}
          >
            <span
              className="w-2 h-2 rounded-full shrink-0 ring-2 ring-offset-1 ring-offset-base-200"
              style={{
                backgroundColor: visible ? CATEGORY_COLORS[cat] : "transparent",
                ringColor: visible ? `${CATEGORY_COLORS[cat]}55` : "transparent",
              }}
            />
            <span>{CATEGORY_LABELS[cat]}</span>
            <span className="tabular-nums opacity-50">{counts[cat]}</span>
          </button>
        );
      })}
    </div>
  );
}
