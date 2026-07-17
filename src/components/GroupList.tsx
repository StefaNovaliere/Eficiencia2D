"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Eye, EyeOff, Layers, StickyNote } from "lucide-react";
import type { FaceCategory, GeometryGroup } from "@/core/group-classifier";

const CATEGORY_COLORS: Record<FaceCategory, string> = {
  floor: "var(--viewer-floor, #2d4f3e)",
  wall: "var(--viewer-wall, #556068)",
  discard: "var(--viewer-discard, #434c57)",
};

const CATEGORY_LABELS: Record<FaceCategory, string> = {
  floor: "Piso",
  wall: "Pared",
  discard: "Descartar",
};

const ALL_CATEGORIES: FaceCategory[] = ["floor", "wall", "discard"];

export interface GroupListProps {
  groups: GeometryGroup[];
  selectedGroupIds: Set<number>;
  hiddenGroupIds: Set<number>;
  categoryOverrides: Map<number, FaceCategory>;
  visibleCategories: Set<FaceCategory>;
  /** When true, scroll the primary selected row into view (e.g. tab became visible). */
  listActive?: boolean;
  onSelectGroup: (id: number) => void;
  onToggleGroup: (id: number) => void;
  onHideGroup: (id: number) => void;
  onShowGroup: (id: number) => void;
  onShowAllHidden: () => void;
  onChangeCategory: (id: number, category: FaceCategory) => void;
  onOpenContextMenu?: (detail: { clientX: number; clientY: number; groupId: number }) => void;
  /** Conteo de notas por group_id padre. */
  noteCountByGroupId?: Map<number, number>;
}

export default function GroupList({
  groups,
  selectedGroupIds,
  hiddenGroupIds,
  categoryOverrides,
  visibleCategories,
  listActive = true,
  onSelectGroup,
  onToggleGroup,
  onHideGroup,
  onShowGroup,
  onShowAllHidden,
  onChangeCategory,
  onOpenContextMenu,
  noteCountByGroupId,
}: GroupListProps) {
  const [collapsed, setCollapsed] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);

  const primarySelectedId = useMemo(() => {
    if (selectedGroupIds.size === 0) return null;
    return Array.from(selectedGroupIds)[0];
  }, [selectedGroupIds]);

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

  useEffect(() => {
    if (!listActive || primarySelectedId == null || collapsed) return;

    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        selectedRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [primarySelectedId, listActive, selectedGroupIds, collapsed]);

  const summary = `${shownGroups.length} visible${shownGroups.length !== 1 ? "s" : ""}${
    hiddenGroups.length > 0
      ? ` · ${hiddenGroups.length} oculta${hiddenGroups.length !== 1 ? "s" : ""}`
      : ""
  }`;

  return (
    <div
      className={`flex flex-col min-h-0 relative z-10 ${collapsed ? "shrink-0" : "flex-1"}`}
      ref={listRef}
    >
      <div className="flex items-center gap-2 px-3 py-2 shrink-0 border-b border-base-300/30 bg-base-100/60">
        <button
          type="button"
          className="btn btn-ghost btn-xs btn-square h-7 min-h-7 rounded-lg shrink-0 text-base-content/60"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expandir capas" : "Contraer capas"}
          title={collapsed ? "Expandir" : "Contraer"}
        >
          {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
        </button>

        <Layers size={14} className="text-primary shrink-0" />

        <button
          type="button"
          className="flex-1 min-w-0 text-left"
          onClick={() => setCollapsed((c) => !c)}
        >
          <h3 className="font-semibold text-sm tracking-tight text-base-content leading-tight">
            Capas
            <span className="ml-1.5 font-mono text-[11px] font-normal text-base-content/45">
              ({visibleGroups.length})
            </span>
          </h3>
          <p className="text-[10px] text-base-content/45 truncate mt-0.5">
            {collapsed
              ? summary
              : `${summary} · clic varias paredes del mismo plano para fusionar`}
          </p>
        </button>

        {!collapsed && visibleGroups.length > 0 && (
          <label className="flex items-center gap-1.5 text-[10px] cursor-pointer text-base-content/60 hover:text-base-content transition-colors shrink-0">
            <input
              type="checkbox"
              className="checkbox checkbox-xs checkbox-primary rounded"
              checked={allVisibleSelected}
              onChange={() => {
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
            Todos
          </label>
        )}
      </div>

      {!collapsed && (
      <div className="flex-1 overflow-y-auto p-3 space-y-1.5 custom-scrollbar min-h-0">
        {shownGroups.length === 0 && (
          <div className="flex flex-col items-center justify-center py-2 text-center px-4">
            <Layers size={28} className="text-base-content/20 mb-3" />
            <p className="text-sm text-base-content/50">No hay capas visibles</p>
            <p className="text-xs text-base-content/35 mt-1">Activá filtros en la barra superior</p>
          </div>
        )}

        {shownGroups.map((group) => {
          const effectiveCat = categoryOverrides.get(group.id) ?? group.category;
          const isSelected = selectedGroupIds.has(group.id);
          const color = CATEGORY_COLORS[effectiveCat];
          const notesCount = noteCountByGroupId?.get(group.id) ?? 0;

          return (
            <div
              key={group.id}
              ref={group.id === primarySelectedId ? selectedRef : undefined}
              className={`group flex items-center gap-2 p-2.5 rounded-xl cursor-pointer transition-all duration-200 border ${
                isSelected
                  ? "bg-primary/8 border-primary/25 shadow-sm"
                  : "bg-base-100/80 border-base-300/30 hover:border-base-300/60 hover:bg-base-200/40"
              } ${effectiveCat === "discard" ? "opacity-55" : ""}`}
              style={isSelected ? { borderLeftWidth: 3, borderLeftColor: color } : undefined}
              onClick={(e) => {
                if (e.ctrlKey || e.metaKey) onToggleGroup(group.id);
                else onSelectGroup(group.id);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                onOpenContextMenu?.({
                  clientX: e.clientX,
                  clientY: e.clientY,
                  groupId: group.id,
                });
              }}
            >
              <input
                type="checkbox"
                className="checkbox checkbox-xs checkbox-primary rounded shrink-0"
                checked={isSelected}
                onChange={(e) => {
                  e.stopPropagation();
                  onToggleGroup(group.id);
                }}
                onClick={(e) => e.stopPropagation()}
                aria-label={`Seleccionar ${group.label}`}
              />

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <span className="text-sm font-medium truncate">{group.label}</span>
                  {notesCount > 0 && (
                    <span
                      className="inline-flex items-center gap-0.5 shrink-0 px-1 py-0.5 rounded-md text-[10px] font-medium border border-primary/35 bg-primary/10 text-primary"
                      title={`${notesCount} nota${notesCount !== 1 ? "s" : ""}`}
                    >
                      <StickyNote size={10} strokeWidth={2} />
                      {notesCount}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-base-content/45 mt-0.5 pl-4 tabular-nums">
                  {group.totalArea.toFixed(1)} m² · {group.faceIndices.length} caras
                  {group.thickness != null && ` · ${(group.thickness * 100).toFixed(1)} cm`}
                </p>
              </div>

              <div className="flex items-center gap-0.5 shrink-0 opacity-70 group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  className="btn btn-ghost btn-xs btn-square rounded-lg"
                  title="Ocultar en el visor 3D"
                  onClick={(e) => {
                    e.stopPropagation();
                    onHideGroup(group.id);
                  }}
                >
                  <EyeOff size={13} />
                </button>
                <select
                  className="select select-bordered select-xs w-[5.5rem] bg-base-100 rounded-lg text-[11px]"
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
          <div className="pt-4 mt-2 border-t border-base-300/30">
            <div className="flex items-center justify-between px-1 mb-2">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-base-content/40">
                Ocultos
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-xs h-6 min-h-0 text-primary"
                onClick={onShowAllHidden}
              >
                Mostrar todos
              </button>
            </div>
            <div className="space-y-1.5">
              {hiddenGroups.map((group) => {
                const effectiveCat = categoryOverrides.get(group.id) ?? group.category;
                const color = CATEGORY_COLORS[effectiveCat];
                return (
                  <div
                    key={group.id}
                    ref={group.id === primarySelectedId ? selectedRef : undefined}
                    className="flex items-center justify-between gap-2 p-2 rounded-lg border border-dashed border-base-300/50 bg-base-200/30"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2 h-2 rounded-full shrink-0 opacity-60"
                        style={{ backgroundColor: color }}
                      />
                      <span className="text-xs font-medium truncate text-base-content/60">
                        {group.label}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs h-6 min-h-0 gap-1 shrink-0"
                      title="Mostrar de nuevo"
                      onClick={() => onShowGroup(group.id)}
                    >
                      <Eye size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      )}
    </div>
  );
}
