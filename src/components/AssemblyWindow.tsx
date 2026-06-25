"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import {
  X,
  Printer,
  Package,
  Layers,
  Square,
  ChevronDown,
  ChevronRight,
  RefreshCw,
} from "lucide-react";
import {
  normalizeAssemblyPreviewData,
  type AssemblyPreviewData,
  type AssemblyPanel,
} from "@/services/api";
import type { Phase1Result } from "@/core/pipeline";
import type { FaceCategory } from "@/core/group-classifier";
import type { NestingPanel } from "@/core/sheet-nester";
import { getEffectiveCategory } from "@/core/discard-by-area";
import {
  buildAssemblyPieces,
  resolveAssemblySteps,
  type AssemblyLiftContext,
} from "@/core/assembly-sequence";
import { groupLabel } from "@/core/assembly-guide-build";
import { useProjectContext } from "@/context/ProjectContext";
import InteractiveAssemblyViewer from "@/components/InteractiveAssemblyViewer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(m: number, dec = 2) {
  return (m * 100).toFixed(dec);
}

/** Alinea la respuesta del backend con overrides locales (descartes, etc.). */
function filterAssemblyData(
  data: AssemblyPreviewData,
  phase1: Phase1Result,
  categoryOverrides: Map<number, FaceCategory>,
): AssemblyPreviewData {
  const normalized = normalizeAssemblyPreviewData(data);

  // Guía interactiva bbox: usar piezas tal cual; no filtrar por descartes locales.
  if ((normalized.sequencePieces?.length ?? 0) > 0) {
    const pieces = normalized.sequencePieces!;
    const steps = normalized.steps ?? [];
    return {
      panels: normalized.panels.length > 0 ? normalized.panels : pieces.map((p) => ({
        id: p.id,
        category: p.category,
        source_group_id: 0,
        width_m: p.width_m,
        height_m: p.height_m,
        area_m2: p.width_m * p.height_m,
        centroid: p.position,
        normal: p.normal,
        label: p.id,
      })),
      elevations: normalized.elevations,
      steps,
      sequencePieces: pieces,
      viewerSchema: normalized.viewerSchema,
      totals: {
        wall_count: pieces.filter((p) => p.category === "wall").length,
        floor_count: pieces.filter((p) => p.category === "floor").length,
        total_panels: pieces.length,
      },
    };
  }

  const groupById = new Map(phase1.groups.map((g) => [g.id, g]));
  const sourcePanels = normalized.panels;
  const panels = sourcePanels.filter((p) => {
    if (p.source_group_id <= 0) return true;
    const group = groupById.get(p.source_group_id);
    if (!group) return true;
    return getEffectiveCategory(group, categoryOverrides) !== "discard";
  });
  const visibleIds = new Set(panels.map((p) => p.id));
  const steps = (normalized.steps ?? []).map((step) => ({
    ...step,
    panel_ids: step.panel_ids.filter((id) => visibleIds.has(id)),
  }));
  const sequencePieces = (normalized.sequencePieces ?? []).filter((p) =>
    visibleIds.has(p.id),
  );
  const elevations = Object.fromEntries(
    Object.entries(normalized.elevations).map(([key, elev]) => [
      key,
      { ...elev, panel_ids: (elev.panel_ids ?? []).filter((id) => visibleIds.has(id)) },
    ]),
  );
  return {
    panels,
    elevations,
    steps: steps.length > 0 ? steps : undefined,
    sequencePieces: sequencePieces.length > 0 ? sequencePieces : undefined,
    viewerSchema: normalized.viewerSchema,
    totals: {
      wall_count: panels.filter((p) => p.category === "wall").length,
      floor_count: panels.filter((p) => p.category === "floor").length,
      total_panels: panels.length,
    },
  };
}

function categoryLabel(cat: string) {
  if (cat === "wall") return "Muro";
  if (cat === "floor") return "Piso";
  return cat;
}

// ---------------------------------------------------------------------------
// Print-only panel card (simple, no interactivity)
// ---------------------------------------------------------------------------
function PrintPanelCard({ panel }: { panel: AssemblyPanel }) {
  return (
    <div className="border border-base-300 rounded-lg px-3 py-2 break-inside-avoid">
      <div className="flex items-center gap-2 mb-0.5">
        <span className="font-mono font-bold text-base">{panel.id}</span>
        <span className="text-xs text-base-content/50 uppercase tracking-wide">
          {categoryLabel(panel.category)}
        </span>
      </div>
      <p className="text-xs text-base-content/60 font-mono">
        {fmt(panel.width_m)} × {fmt(panel.height_m)} cm &nbsp;|&nbsp;{" "}
        {panel.area_m2.toFixed(3)} m²
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Interactive sidebar panel card
// ---------------------------------------------------------------------------
function InteractivePanelCard({
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
      className={`w-full text-left rounded-lg border px-3 py-2 transition-all ${
        isSelected
          ? "bg-primary/10 border-primary/40 ring-1 ring-primary/30"
          : "bg-base-200/40 border-base-300/40 hover:bg-base-200 hover:border-base-300"
      }`}
    >
      <div className="flex items-center gap-2 mb-0.5">
        <span
          className={`font-mono font-bold text-sm ${isSelected ? "text-primary" : ""}`}
        >
          {panel.id}
        </span>
        <span className="badge badge-xs badge-ghost">{categoryLabel(panel.category)}</span>
      </div>
      <p className="text-xs text-base-content/50 font-mono">
        {fmt(panel.width_m)} × {fmt(panel.height_m)} cm &nbsp;|&nbsp;{" "}
        {panel.area_m2.toFixed(2)} m²
      </p>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Elevation section — collapsible (interactive) / always-open (print)
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
    <section className="border border-base-300/40 rounded-xl overflow-hidden print:border-base-300 print:mb-4">
      {/* Header — hidden on print, replaced by a plain heading */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="print:hidden flex items-center gap-2 w-full px-3 py-2.5 bg-base-200/70 hover:bg-base-200 transition-colors text-sm font-semibold text-base-content/80"
      >
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 shrink-0 opacity-50" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 shrink-0 opacity-50" />
        )}
        <Layers className="w-3.5 h-3.5 shrink-0 text-primary/70" />
        <span className="flex-1 text-left">{label}</span>
        <span className="badge badge-sm badge-ghost font-mono">{panels.length}</span>
      </button>

      {/* Print heading */}
      <h3 className="hidden print:block px-3 pt-2 pb-1 text-sm font-bold uppercase tracking-wide text-base-content/70 border-b border-base-300">
        {label} ({panels.length} {panels.length === 1 ? "pieza" : "piezas"})
      </h3>

      {/* Panel list */}
      <div
        className={`px-2 py-2 space-y-1.5 print:grid print:grid-cols-3 print:gap-2 print:space-y-0 ${
          open ? "" : "print:block hidden"
        }`}
      >
        {panels.map((p) => (
          <div key={p.id}>
            {/* Interactive (screen) */}
            <div className="print:hidden">
              <InteractivePanelCard
                panel={p}
                isSelected={selectedId === p.id}
                onSelect={onSelect}
              />
            </div>
            {/* Print-only */}
            <div className="hidden print:block">
              <PrintPanelCard panel={p} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Totals strip
// ---------------------------------------------------------------------------
function TotalsStrip({ totals }: { totals: AssemblyPreviewData["totals"] }) {
  return (
    <div className="flex items-center gap-4 text-sm text-base-content/70">
      <span>
        <strong className="text-base-content">{totals.total_panels}</strong> piezas totales
      </span>
      <span className="opacity-30">·</span>
      <span>
        <strong className="text-base-content">{totals.wall_count}</strong> muros
      </span>
      {totals.floor_count > 0 && (
        <>
          <span className="opacity-30">·</span>
          <span>
            <strong className="text-base-content">{totals.floor_count}</strong> pisos
          </span>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Full dimensions table (for "tabla" view)
// ---------------------------------------------------------------------------
function DimensionsTable({
  panels,
  selectedId,
  onSelect,
}: {
  panels: AssemblyPanel[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="overflow-auto">
      <table className="table table-sm w-full print:text-xs">
        <thead className="bg-base-200/60 print:bg-transparent">
          <tr className="text-base-content/50 text-xs uppercase tracking-wide">
            <th>ID</th>
            <th>Tipo</th>
            <th>Ancho (cm)</th>
            <th>Alto (cm)</th>
            <th>Área (m²)</th>
          </tr>
        </thead>
        <tbody>
          {panels.map((p, i) => (
            <tr
              key={p.id}
              onClick={() => onSelect(p.id)}
              className={`cursor-pointer hover:bg-base-200 print:cursor-default print:hover:bg-transparent border-b border-base-200 print:border-base-300 ${
                selectedId === p.id ? "bg-primary/10" : i % 2 === 0 ? "" : "bg-base-200/30"
              }`}
            >
              <td className="font-mono font-bold text-primary">{p.id}</td>
              <td className="text-xs text-base-content/60">{categoryLabel(p.category)}</td>
              <td className="font-mono text-sm">{fmt(p.width_m)}</td>
              <td className="font-mono text-sm">{fmt(p.height_m)}</td>
              <td className="font-mono text-sm">{p.area_m2.toFixed(3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main AssemblyWindow component
// ---------------------------------------------------------------------------

export interface AssemblyWindowProps {
  data: AssemblyPreviewData | null;
  loading: boolean;
  error: string | null;
  phase1: Phase1Result;
  categoryOverrides: Map<number, FaceCategory>;
  projectName?: string;
  onClose: () => void;
  onReload: () => void;
}

export default function AssemblyWindow({
  data,
  loading,
  error,
  phase1,
  categoryOverrides,
  projectName = "Proyecto",
  onClose,
  onReload,
}: AssemblyWindowProps) {
  const [selectedPanelId, setSelectedPanelId] = useState<string | null>(null);
  const [view, setView] = useState<"elevations" | "table">("elevations");
  const { nestingData } = useProjectContext();

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const displayData = useMemo(
    () => (data ? filterAssemblyData(data, phase1, categoryOverrides) : null),
    [data, phase1, categoryOverrides],
  );

  const panelMap = useMemo(
    () => new Map((displayData?.panels ?? []).map((p) => [p.id, p])),
    [displayData],
  );

  const assemblySteps = useMemo(
    () => (displayData ? resolveAssemblySteps(displayData) : []),
    [displayData],
  );

  // Contexto para liftear cada pieza a su pose 3D real (instructivo #2): pose
  // desde `placements` (topology) + contorno de corte desde los paneles de
  // nesting. Si falta cualquiera, buildAssemblyPieces cae al render de cajas.
  const liftContext = useMemo<AssemblyLiftContext>(() => {
    // Mapas por etiqueta (misma `groupLabel` que el builder → join consistente).
    const labelToGroupId = new Map<string, number>();
    const faceIndicesByLabel = new Map<string, number[]>();
    for (const g of phase1.groups) {
      const label = groupLabel(g, phase1.panelIdByGroup);
      labelToGroupId.set(label, g.id);
      faceIndicesByLabel.set(label, g.faceIndices);
    }
    const nestingPanelById = new Map<string, NestingPanel>();
    if (nestingData) {
      for (const result of [nestingData.wallNesting, nestingData.floorNesting]) {
        if (!result?.sheets) continue;
        for (const sheet of result.sheets) {
          for (const placed of sheet.panels) {
            nestingPanelById.set(placed.panel.id.trim(), placed.panel);
          }
        }
      }
    }
    return {
      placements: phase1.placements ?? {},
      labelToGroupId,
      nestingPanelById,
      faces: phase1.faces,
      faceIndicesByLabel,
    };
  }, [phase1, nestingData]);

  const assemblyPieces = useMemo(
    () => (displayData ? buildAssemblyPieces(displayData, assemblySteps, liftContext) : []),
    [displayData, assemblySteps, liftContext],
  );

  const handleSelectPanel = useCallback((id: string | null) => {
    setSelectedPanelId(id);
  }, []);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col bg-base-100 print:bg-white"
      role="dialog"
      aria-modal="true"
      aria-label="Instructivo de armado"
    >
      {/* ── Print styles injected via a <style> tag ─────────────────────── */}
      <style>{`
        @media print {
          @page { margin: 15mm 12mm; size: A4 portrait; }
          .assembly-no-print { display: none !important; }
          .assembly-3d-panel { display: none !important; }
          .assembly-content { width: 100% !important; max-width: 100% !important; }
          body { background: white !important; }
        }
      `}</style>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="assembly-no-print flex items-center gap-3 px-5 py-3 border-b border-base-300/40 bg-base-100/95 backdrop-blur shrink-0 z-10">
        <div className="flex items-center gap-2 text-primary">
          <Package className="w-5 h-5" />
          <span className="font-bold tracking-wide text-base">Instructivo de armado</span>
        </div>
        <span className="text-base-content/40 text-sm hidden sm:block">{projectName}</span>

        <div className="ml-auto flex items-center gap-2">
          {displayData && (
            <TotalsStrip totals={displayData.totals} />
          )}
          <div className="w-px h-5 bg-base-300/60 mx-1 hidden sm:block" />
          <button
            type="button"
            className="btn btn-ghost btn-sm gap-1.5"
            onClick={onReload}
            title="Recargar desde backend"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Actualizar</span>
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm gap-1.5"
            onClick={() => window.print()}
            title="Imprimir instructivo"
          >
            <Printer className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Imprimir</span>
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-square"
            onClick={onClose}
            title="Cerrar (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* ── Print header (only shown when printing) ──────────────────── */}
      <div className="hidden print:block px-4 py-3 border-b border-base-300 mb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Instructivo de Armado</h1>
            {projectName && <p className="text-sm text-gray-500">{projectName}</p>}
          </div>
          {displayData && (
            <div className="text-sm text-gray-600 text-right">
              <p>{displayData.totals.total_panels} piezas · {displayData.totals.wall_count} muros</p>
              {displayData.totals.floor_count > 0 && <p>{displayData.totals.floor_count} pisos</p>}
            </div>
          )}
        </div>
      </div>

      {/* ── Body ──────────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* 3D Viewer panel — hidden on print */}
        <div className="assembly-3d-panel assembly-no-print flex-1 relative border-r border-base-300/30 min-w-0">
          {loading && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-base-200/60 backdrop-blur-sm">
              <span className="loading loading-spinner loading-lg text-primary" />
              <p className="text-sm text-base-content/60">Calculando instructivo…</p>
            </div>
          )}

          {!loading && !data && !error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-center px-8">
              <Package className="w-16 h-16 text-base-content/15" />
              <div>
                <p className="font-semibold text-base-content/60 mb-1">Sin datos</p>
                <p className="text-sm text-base-content/40">Hacé click en "Actualizar" para cargar el instructivo</p>
              </div>
            </div>
          )}

          {error && !loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-center px-8">
              <p className="text-error font-semibold">Error al cargar</p>
              <p className="text-sm text-base-content/50">{error}</p>
              <button type="button" className="btn btn-outline btn-error btn-sm" onClick={onReload}>
                Reintentar
              </button>
            </div>
          )}

          {displayData && !loading && !error && (
            <InteractiveAssemblyViewer
              className="absolute inset-0"
              steps={assemblySteps}
              pieces={assemblyPieces}
              viewerSchema={displayData.viewerSchema}
            />
          )}
        </div>

        {/* ── Guide panel (right side / print full-width) ──────────────── */}
        <aside className="assembly-content w-full md:w-[420px] lg:w-[480px] flex flex-col bg-base-50 print:w-full print:max-w-full shrink-0 border-l border-base-300/30 print:border-none">

          {/* View switcher — screen only */}
          {displayData && (
            <div className="assembly-no-print flex items-center gap-1 px-3 py-2.5 border-b border-base-300/30 shrink-0 bg-base-100">
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
                Tabla completa
              </button>
              {selectedPanelId && (
                <button
                  type="button"
                  className="btn btn-xs btn-ghost ml-auto text-base-content/50"
                  onClick={() => handleSelectPanel(null)}
                >
                  Limpiar
                </button>
              )}
            </div>
          )}

          {/* Content */}
          <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-3 py-3 space-y-2 print:overflow-visible print:space-y-3">

            {/* Loading / error inside sidebar */}
            {loading && (
              <div className="flex flex-col items-center justify-center h-40 gap-3">
                <span className="loading loading-spinner loading-md text-primary" />
                <p className="text-sm text-base-content/50">Cargando…</p>
              </div>
            )}

            {!loading && error && (
              <div className="flex flex-col items-center justify-center h-40 gap-3 text-center">
                <p className="text-sm text-error font-semibold">{error}</p>
                <button type="button" className="btn btn-outline btn-error btn-sm" onClick={onReload}>
                  Reintentar
                </button>
              </div>
            )}

            {!loading && !data && !error && (
              <div className="flex flex-col items-center justify-center h-40 gap-3 text-center">
                <Package className="w-10 h-10 text-base-content/20" />
                <p className="text-sm text-base-content/50">Cargá el instructivo para ver las piezas</p>
                <button type="button" className="btn btn-primary btn-sm" onClick={onReload}>
                  Cargar instructivo
                </button>
              </div>
            )}

            {displayData && view === "elevations" &&
              Object.entries(displayData.elevations).map(([key, elev]) => (
                <ElevationSection
                  key={key}
                  label={elev.label}
                  panelIds={elev.panel_ids}
                  panelMap={panelMap}
                  selectedId={selectedPanelId}
                  onSelect={(id) => handleSelectPanel(selectedPanelId === id ? null : id)}
                />
              ))
            }

            {displayData && view === "table" && (
              <div className="assembly-no-print">
                <DimensionsTable
                  panels={displayData.panels ?? []}
                  selectedId={selectedPanelId}
                  onSelect={(id) => handleSelectPanel(selectedPanelId === id ? null : id)}
                />
              </div>
            )}

            {/* Print-only: always show full table after elevations */}
            {displayData && (
              <div className="hidden print:block mt-6">
                <h2 className="text-base font-bold mb-2 border-b border-base-300 pb-1">
                  Tabla de piezas
                </h2>
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b-2 border-base-300">
                      <th className="text-left py-1 pr-3">ID</th>
                      <th className="text-left py-1 pr-3">Tipo</th>
                      <th className="text-right py-1 pr-3">Ancho (cm)</th>
                      <th className="text-right py-1 pr-3">Alto (cm)</th>
                      <th className="text-right py-1">Área (m²)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(displayData.panels ?? []).map((p, i) => (
                      <tr
                        key={p.id}
                        className={`border-b border-base-200 ${i % 2 === 0 ? "" : "bg-gray-50"}`}
                      >
                        <td className="py-0.5 pr-3 font-mono font-bold">{p.id}</td>
                        <td className="py-0.5 pr-3 text-gray-500">{categoryLabel(p.category)}</td>
                        <td className="py-0.5 pr-3 font-mono text-right">{fmt(p.width_m)}</td>
                        <td className="py-0.5 pr-3 font-mono text-right">{fmt(p.height_m)}</td>
                        <td className="py-0.5 font-mono text-right">{p.area_m2.toFixed(3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
