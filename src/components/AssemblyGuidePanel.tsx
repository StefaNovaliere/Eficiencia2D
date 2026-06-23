"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Layers, Square, Package } from "lucide-react";
import type { AssemblyPreviewData, AssemblyPanel } from "@/services/api";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(m: number, decimals = 2): string {
  return m.toFixed(decimals);
}

function categoryLabel(cat: string): string {
  switch (cat) {
    case "wall": return "Muro";
    case "floor": return "Piso";
    default: return cat;
  }
}

function categoryColor(cat: string): string {
  switch (cat) {
    case "wall": return "badge-primary";
    case "floor": return "badge-secondary";
    default: return "badge-neutral";
  }
}

// ---------------------------------------------------------------------------
// Single panel card
// ---------------------------------------------------------------------------

function PanelCard({
  panel,
  isSelected,
  onSelect,
}: {
  panel: AssemblyPanel;
  isSelected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(panel.id)}
      className={`w-full text-left rounded-lg border px-3 py-2 transition-all duration-150 ${
        isSelected
          ? "bg-primary/10 border-primary/40 ring-1 ring-primary/30"
          : "bg-base-200/50 border-base-300/40 hover:bg-base-200 hover:border-base-300"
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span
          className={`font-mono font-bold text-sm ${
            isSelected ? "text-primary" : "text-base-content"
          }`}
        >
          {panel.id}
        </span>
        <span className={`badge badge-xs ${categoryColor(panel.category)}`}>
          {categoryLabel(panel.category)}
        </span>
      </div>
      <div className="text-xs text-base-content/60 font-mono space-y-0.5">
        <div className="flex gap-3">
          <span>{fmt(panel.width_m * 100)} × {fmt(panel.height_m * 100)} cm</span>
          <span className="text-base-content/40">{fmt(panel.area_m2)} m²</span>
        </div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Elevation section (collapsible)
// ---------------------------------------------------------------------------

function ElevationSection({
  label,
  panelIds,
  panelMap,
  selectedId,
  onSelect,
}: {
  label: string;
  panelIds: string[];
  panelMap: Map<string, AssemblyPanel>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const panels = panelIds.map((id) => panelMap.get(id)).filter(Boolean) as AssemblyPanel[];

  return (
    <div className="border border-base-300/40 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 w-full px-3 py-2.5 bg-base-200/60 hover:bg-base-200 transition-colors text-sm font-semibold text-base-content/80"
      >
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 shrink-0 text-base-content/50" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 shrink-0 text-base-content/50" />
        )}
        <Layers className="w-3.5 h-3.5 shrink-0 text-primary/70" />
        <span className="flex-1 text-left">{label}</span>
        <span className="badge badge-sm badge-ghost font-mono">{panels.length}</span>
      </button>

      {open && panels.length > 0 && (
        <div className="px-2 py-2 space-y-1.5 bg-base-100/50">
          {panels.map((panel) => (
            <PanelCard
              key={panel.id}
              panel={panel}
              isSelected={selectedId === panel.id}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Totals header
// ---------------------------------------------------------------------------

function TotalsBar({ totals }: { totals: AssemblyPreviewData["totals"] }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-base-200/50 border-b border-base-300/30 text-xs text-base-content/60 shrink-0">
      <Package className="w-3.5 h-3.5 text-primary/70 shrink-0" />
      <span className="font-semibold text-base-content/80">
        {totals.total_panels} piezas totales
      </span>
      <span className="text-base-content/40">·</span>
      <span>{totals.wall_count} muros</span>
      {totals.floor_count > 0 && (
        <>
          <span className="text-base-content/40">·</span>
          <span>{totals.floor_count} pisos</span>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// All-panels flat table (toggle view)
// ---------------------------------------------------------------------------

function AllPanelsTable({
  panels,
  selectedId,
  onSelect,
}: {
  panels: AssemblyPanel[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="table table-xs w-full">
        <thead>
          <tr className="text-base-content/50">
            <th>ID</th>
            <th>Tipo</th>
            <th>Ancho (cm)</th>
            <th>Alto (cm)</th>
            <th>Área (m²)</th>
          </tr>
        </thead>
        <tbody>
          {panels.map((p) => (
            <tr
              key={p.id}
              onClick={() => onSelect(p.id)}
              className={`cursor-pointer hover:bg-base-200 transition-colors ${
                selectedId === p.id ? "bg-primary/10 font-semibold" : ""
              }`}
            >
              <td className="font-mono font-bold text-primary">{p.id}</td>
              <td>
                <span className={`badge badge-xs ${categoryColor(p.category)}`}>
                  {categoryLabel(p.category)}
                </span>
              </td>
              <td className="font-mono">{fmt(p.width_m * 100)}</td>
              <td className="font-mono">{fmt(p.height_m * 100)}</td>
              <td className="font-mono">{fmt(p.area_m2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export type AssemblyView = "elevations" | "table";

export interface AssemblyGuidePanelProps {
  data: AssemblyPreviewData | null;
  loading: boolean;
  error: string | null;
  selectedPanelId: string | null;
  onSelectPanel: (id: string | null) => void;
  onLoad: () => void;
}

export default function AssemblyGuidePanel({
  data,
  loading,
  error,
  selectedPanelId,
  onSelectPanel,
  onLoad,
}: AssemblyGuidePanelProps) {
  const [view, setView] = useState<AssemblyView>("elevations");

  const panelMap = new Map<string, AssemblyPanel>(
    (data?.panels ?? []).map((p) => [p.id, p]),
  );

  const handleSelect = (id: string) => {
    onSelectPanel(selectedPanelId === id ? null : id);
  };

  // ── Empty / loading / error states ──────────────────────────────────────

  if (!data && !loading && !error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 px-6 py-10 text-center">
        <Package className="w-10 h-10 text-base-content/20" />
        <div>
          <p className="font-semibold text-base-content/70 mb-1">Instructivo de armado</p>
          <p className="text-xs text-base-content/50 max-w-[220px]">
            Generá la vista interactiva para ver qué pieza va en cada lugar.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-sm gap-1.5"
          onClick={onLoad}
        >
          <Package className="w-3.5 h-3.5" />
          Cargar instructivo
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-base-content/50">
        <span className="loading loading-spinner loading-md" />
        <span className="text-sm">Calculando instructivo…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 px-6 py-10 text-center">
        <p className="text-sm text-error font-semibold">Error al cargar instructivo</p>
        <p className="text-xs text-base-content/50">{error}</p>
        <button
          type="button"
          className="btn btn-outline btn-error btn-sm"
          onClick={onLoad}
        >
          Reintentar
        </button>
      </div>
    );
  }

  if (!data) return null;

  // ── Normal render ────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Totals bar */}
      <TotalsBar totals={data.totals} />

      {/* View switcher */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-base-300/30 shrink-0">
        <button
          type="button"
          className={`btn btn-xs gap-1 ${view === "elevations" ? "btn-primary" : "btn-ghost"}`}
          onClick={() => setView("elevations")}
        >
          <Layers className="w-3 h-3" />
          Por cara
        </button>
        <button
          type="button"
          className={`btn btn-xs gap-1 ${view === "table" ? "btn-primary" : "btn-ghost"}`}
          onClick={() => setView("table")}
        >
          <Square className="w-3 h-3" />
          Tabla
        </button>
        {selectedPanelId && (
          <button
            type="button"
            className="btn btn-xs btn-ghost ml-auto text-base-content/50"
            onClick={() => onSelectPanel(null)}
          >
            Limpiar selección
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-2 py-2 space-y-2">
        {view === "elevations" ? (
          Object.entries(data.elevations).map(([key, elev]) => (
            <ElevationSection
              key={key}
              label={elev.label}
              panelIds={elev.panel_ids}
              panelMap={panelMap}
              selectedId={selectedPanelId}
              onSelect={handleSelect}
            />
          ))
        ) : (
          <AllPanelsTable
            panels={data.panels}
            selectedId={selectedPanelId}
            onSelect={handleSelect}
          />
        )}
      </div>
    </div>
  );
}
