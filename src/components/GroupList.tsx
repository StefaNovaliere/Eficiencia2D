"use client";

import { useEffect, useRef } from "react";
import { Eye, EyeOff } from "lucide-react";
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
  hiddenGroupIds: Set<number>;
  categoryOverrides: Map<number, FaceCategory>;
  visibleCategories: Set<FaceCategory>;
  onSelectGroup: (id: number) => void;
  onToggleGroup: (id: number) => void;
  onHideGroup: (id: number) => void;
  onShowGroup: (id: number) => void;
  onShowAllHidden: () => void;
  onChangeCategory: (id: number, category: FaceCategory) => void;
}

export default function GroupList({
  groups,
  selectedGroupIds,
  hiddenGroupIds,
  categoryOverrides,
  visibleCategories,
  onSelectGroup,
  onToggleGroup,
  onHideGroup,
  onShowGroup,
  onShowAllHidden,
  onChangeCategory,
}: GroupListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);

  // Filter by visibility (based on effective category).
  const visibleGroups = groups.filter((g) => {
    const eff = categoryOverrides.get(g.id) ?? g.category;
    return visibleCategories.has(eff);
  });
  const shownGroups = visibleGroups.filter((g) => !hiddenGroupIds.has(g.id));
  const hiddenGroups = visibleGroups.filter((g) => hiddenGroupIds.has(g.id));

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
    <div className="flex flex-col flex-1 min-h-0 bg-base-100/50 relative z-10" ref={listRef}>
      <div className="flex items-center justify-between p-4 border-b border-base-200/50 bg-base-100/80 backdrop-blur-md sticky top-0 z-20 shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
        <h3 className="font-bold text-base tracking-tight flex items-center gap-2">
          Capas
          <span className="badge badge-sm badge-neutral font-mono">{shownGroups.length}</span>
          {hiddenGroups.length > 0 && (
            <span className="badge badge-sm badge-ghost font-mono text-base-content/50">
              {hiddenGroups.length} oculto{hiddenGroups.length !== 1 ? "s" : ""}
            </span>
          )}
        </h3>
        {visibleGroups.length > 0 && (
          <label className="flex items-center gap-2 text-xs cursor-pointer hover:bg-base-200 px-2 py-1 rounded-md transition-colors">
            <input
              type="checkbox"
              className="checkbox checkbox-xs checkbox-primary rounded-sm"
              checked={allVisibleSelected}
              onChange={(e) => {
                if (allVisibleSelected) {
                  for (const g of visibleGroups) {
                    if (selectedGroupIds.has(g.id)) onToggleGroup(g.id);
                  }
                } else {
                  for (const g of visibleGroups) {
                    if (!selectedGroupIds.has(g.id)) onToggleGroup(g.id);
                  }
                }
              }}
            />
            <span className="font-medium text-base-content/70">Seleccionar todos</span>
          </label>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
        {shownGroups.map((group) => {
          const effectiveCat = categoryOverrides.get(group.id) ?? group.category;
          const isSelected = selectedGroupIds.has(group.id);
          const color = CATEGORY_COLORS[effectiveCat];

          return (
            <div
              key={group.id}
              ref={isSelected ? selectedRef : undefined}
              className={`flex items-center justify-between p-2.5 rounded-xl cursor-pointer transition-all duration-200 border shadow-sm hover:shadow-md ${isSelected ? "bg-primary/10 border-primary/30" : "bg-base-100 border-base-200/50 hover:bg-base-200/50 hover:-translate-y-[1px]"} ${effectiveCat === "discard" ? "opacity-60 grayscale-[50%]" : ""}`}
              onClick={(e) => {
                if (e.ctrlKey || e.metaKey) {
                  onToggleGroup(group.id);
                } else {
                  onSelectGroup(group.id);
                }
              }}

            >
              <div className="flex items-center gap-3 overflow-hidden pl-1">
                <input
                  type="checkbox"
                  className="checkbox checkbox-xs checkbox-primary rounded-sm"
                  checked={isSelected}
                  onChange={(e) => {
                    e.stopPropagation();
                    onToggleGroup(group.id);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`Seleccionar ${group.label}`}
                />
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0 shadow-sm"
                  style={{ backgroundColor: color }}
                />
                <div className="flex flex-col overflow-hidden">
                  <span className="text-sm font-semibold truncate">{group.label}</span>
                  <span className="text-[10px] text-base-content/60 truncate">
                    {group.totalArea.toFixed(1)} m² · {group.faceIndices.length} caras
                    {group.thickness != null && ` · ${(group.thickness * 100).toFixed(1)}cm grosor`}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                className="btn btn-ghost btn-xs btn-square rounded-lg"
                title="Ocultar en el visor 3D"
                onClick={(e) => {
                  e.stopPropagation();
                  onHideGroup(group.id);
                }}
              >
                <EyeOff size={14} />
              </button>
              <select
                className="select select-bordered select-xs w-28 bg-base-100/80 hover:bg-base-200 transition-colors shadow-sm ml-2 rounded-lg"
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
            </div>
          );
        })}

        {hiddenGroups.length > 0 && (
          <div className="pt-3 mt-2 border-t border-base-200/60">
            <div className="flex items-center justify-between px-1 mb-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-base-content/50">
                Ocultos en 3D
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-xs rounded-lg text-primary"
                onClick={onShowAllHidden}
              >
                Mostrar todos
              </button>
            </div>
            <div className="space-y-2">
              {hiddenGroups.map((group) => {
                const effectiveCat = categoryOverrides.get(group.id) ?? group.category;
                const color = CATEGORY_COLORS[effectiveCat];
                return (
                  <div
                    key={group.id}
                    className="flex items-center justify-between p-2.5 rounded-xl border border-dashed border-base-300/70 bg-base-200/30 opacity-70"
                  >
                    <div className="flex items-center gap-3 overflow-hidden pl-1 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: color }}
                      />
                      <span className="text-sm font-medium truncate">{group.label}</span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs gap-1 rounded-lg shrink-0"
                      title="Mostrar de nuevo"
                      onClick={() => onShowGroup(group.id)}
                    >
                      <Eye size={14} />
                      Mostrar
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
