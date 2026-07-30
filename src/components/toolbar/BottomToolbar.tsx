"use client";

import { useEffect, useRef, useState } from "react";
import {
  Eye,
  ArrowLeft,
  ArrowRight,
  Trash2,
  Crosshair,
  Maximize,
  ScanSearch,
  Scissors,
  Footprints,
  MousePointer2,
  Lasso,
  Ruler,
  PenLine,
  Magnet,
  Minus,
  RectangleHorizontal,
  Circle,
  Spline,
  RefreshCw,
  Box,
  ChevronDown,
  ChevronUp,
  Layers,
  Tangent,
  PencilRuler,
  Move3D,
  Navigation2,
  Palette,
  Rotate3D,
  SquareDashedMousePointer,
  SquareBottomDashedScissors,
  SquareSplitHorizontal,
  Link2,
  Camera,
  ScanEye,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import CameraNavigationSelect from "@/components/CameraNavigationSelect";
import MeasureScaleSelect from "@/components/MeasureScaleSelect";
import type { FaceCategory } from "@/core/group-classifier";
import type { SectionState } from "@/components/ModelViewer";
import type { MarkLineMode } from "@/components/MarkLineToolOverlay";
import type { ActiveCutShapeKind } from "@/core/user-cuts";
import type { MeasureShapeKind } from "@/core/measure-tool";
import type { Phase1Result } from "@/core/pipeline";
import ConfigButtom from "./ConfigButtom";

// ─── Public props ─────────────────────────────────────────────────────────────

export interface BottomToolbarProps {
  stats: { floors: number; walls: number; discarded: number };
  visibleCategories: Set<FaceCategory>;
  onToggleVisibility: (cat: FaceCategory) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  xrayMode: boolean;
  onToggleXray: () => void;
  section: SectionState;
  onToggleSection: () => void;
  walkMode: boolean;
  onToggleWalk: () => void;
  onFrameCamera: (cmd: "frameAll" | "frameSelection" | "reset") => void;
  selectedGroupIds: Set<number>;
  activeTool: "cursor" | "box" | "cut" | "measure" | "markLine" | "rib" | "angle";
  onSelectTool: (tool: "cursor" | "box" | "cut" | "measure" | "markLine" | "rib" | "angle") => void;
  onCycleCutShape: () => void;
  markLineMode: MarkLineMode;
  onMarkLineModeChange: (m: MarkLineMode) => void;
  measureShapeKind: MeasureShapeKind;
  onMeasureShapeChange: (k: MeasureShapeKind) => void;
  measureLabelScale: number;
  onMeasureScaleChange: (scale: number, e?: React.MouseEvent) => void;
  measureCount: number;
  onClearMeasures: () => void;
  cutShapeKind: ActiveCutShapeKind;
  onCutShapeChange: (k: ActiveCutShapeKind) => void;
  cutCount: number;
  edgeSnap: boolean;
  onToggleEdgeSnap: () => void;
  hiddenCount: number;
  onShowAllHidden: () => void;
  phase1: Phase1Result;
  onRotateAxis: () => void;
  isRecomputing: boolean;
  isGenerating: boolean;
  showCenterAxes: boolean;
  onToggleCenterAxes: () => void;
  isSolid: boolean;
  onToggleSolid: () => void;
  hideSidebar: boolean;
  onToggleSidebar: () => void;
  hideToolbar: boolean;
  onToggleToolbar: () => void;
  minAreaM2: number;
  onMinAreaChange: (v: number) => void;
  pinTools: boolean;
  onPinToolsChange: (pin: boolean) => void;
  minAreaOptions: number[];
  formatMinAreaOption: (v: number) => string;
  angleMeasureMode: "off" | "line" | "panels";
  onSetAngleMeasureMode: (m: "line" | "panels") => void;
  /** Fusionar (unir) paredes seleccionadas — atajo F. */
  canMerge: boolean;
  onMerge: () => void;
  mergeTitle?: string;
  /** Dividir (desfusionar) el componente fusionado — atajo D. */
  canSplit: boolean;
  onSplit: () => void;
  splitTitle?: string;
}

// ─── Groups ───────────────────────────────────────────────────────────────────

export type GroupId =
  | "visibility"
  | "nav"
  | "visualizacion"
  | "tools";

const GROUP_DEFS: { id: GroupId; label: string; icon: LucideIcon }[] = [
  { id: "visibility",    label: "Capas",         icon: Layers      },
  { id: "nav",           label: "Cámara",        icon: Camera      },
  { id: "visualizacion", label: "Visualización", icon: ScanEye     },
  { id: "tools",         label: "Herramientas",  icon: PencilRuler },
];

export const TOOLBAR_GROUPS_SK = "eficiencia_toolbar_groups_v3";
const SK = TOOLBAR_GROUPS_SK;

export { GROUP_DEFS };

function loadVisible(): Record<GroupId, boolean> {
  try {
    const r = localStorage.getItem(SK);
    if (r) return JSON.parse(r) as Record<GroupId, boolean>;
  } catch { /* ignore */ }
  return Object.fromEntries(GROUP_DEFS.map((g) => [g.id, true])) as Record<GroupId, boolean>;
}
function saveVisible(v: Record<GroupId, boolean>) {
  try { localStorage.setItem(SK, JSON.stringify(v)); } catch { /* ignore */ }
}

// ─── Style tokens ─────────────────────────────────────────────────────────────

// Main-bar group tab button
const TAB = "inline-flex shrink-0 items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-medium transition-colors select-none";
const TAB_ON     = "bg-primary/15 text-primary";
// Subtle ring: flyout is closed but something in this group is currently affecting the view
const TAB_ACTIVE = "text-primary/80 ring-1 ring-primary/35 hover:bg-primary/8";
const TAB_OFF    = "text-base-content/65 hover:bg-base-200/70 hover:text-base-content";

// Ribbon item button (inside flyout)
const RIB = "inline-flex shrink-0 items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap";
const RIB_ON  = "bg-primary/15 text-primary ring-1 ring-primary/25";
const RIB_OFF = "text-base-content/70 hover:bg-base-200/70 hover:text-base-content";

// Vertical divider
function VDivider({ light }: { light?: boolean }) {
  return <div className={`self-stretch w-px rounded-full mx-1 ${light ? "bg-base-300/30" : "bg-base-300/50"}`} />;
}

// ─── Ribbon sections ──────────────────────────────────────────────────────────

const CAT_LABELS: Record<FaceCategory, string> = { floor: "Pisos", wall: "Paredes", discard: "Descartados" };
const CAT_COLORS: Record<FaceCategory, string> = {
  floor: "var(--viewer-floor,#2d4f3e)",
  wall: "var(--viewer-wall,#556068)",
  discard: "var(--viewer-discard,#434c57)",
};

function VisibilityRibbon({ stats, visibleCategories, onToggle, hiddenCount, onShowAllHidden }: {
  stats: BottomToolbarProps["stats"];
  visibleCategories: Set<FaceCategory>;
  onToggle: (c: FaceCategory) => void;
  hiddenCount: number;
  onShowAllHidden: () => void;
}) {
  const cats: FaceCategory[] = ["floor", "wall", "discard"];
  const counts: Record<FaceCategory, number> = { floor: stats.floors, wall: stats.walls, discard: stats.discarded };
  return (
    <>
      {cats.map((cat) => {
        const on = visibleCategories.has(cat);
        return (
          <button key={cat} type="button" onClick={() => onToggle(cat)}
            className={`${RIB} ${on ? "bg-base-200/80 shadow-sm ring-1 ring-base-300/40" : "text-base-content/40 hover:bg-base-200/50 hover:text-base-content/60"}`}
          >
            <span className="w-2 h-2 rounded-full shrink-0" style={{
              backgroundColor: on ? CAT_COLORS[cat] : "transparent",
              outline: `2px solid ${CAT_COLORS[cat]}`, outlineOffset: 2,
            }} />
            {CAT_LABELS[cat]}
            <span className="tabular-nums opacity-50">{counts[cat]}</span>
          </button>
        );
      })}
      {hiddenCount > 0 && (
        <>
          <VDivider />
          <button type="button" onClick={onShowAllHidden} className={`${RIB} ${RIB_OFF}`}>
            <Eye size={13} /> Mostrar {hiddenCount} ocultos
          </button>
        </>
      )}
    </>
  );
}

/** Cámara — todo lo que mueve u orienta la cámara respecto al espacio. */
function NavRibbon({
  walkMode, onToggleWalk, onFrameCamera, selectedGroupIds,
  phase1, onRotateAxis, isRecomputing, isGenerating,
}: Pick<BottomToolbarProps,
  "walkMode"|"onToggleWalk"|"onFrameCamera"|"selectedGroupIds"|
  "phase1"|"onRotateAxis"|"isRecomputing"|"isGenerating"
>) {
  return (
    <>
      <button type="button" onClick={() => onFrameCamera(selectedGroupIds.size > 0 ? "frameSelection" : "frameAll")} className={`${RIB} ${RIB_OFF}`}>
        <Crosshair size={13} />
        {selectedGroupIds.size > 0 ? "Encuadrar selección" : "Encuadrar todo"}
        <kbd className="kbd kbd-xs">Z</kbd>
      </button>
      <button type="button" onClick={() => onFrameCamera("reset")} className={`${RIB} ${RIB_OFF}`}>
        <Maximize size={13} /> Vista general
      </button>
      <VDivider />
      <button type="button" onClick={onToggleWalk} className={`${RIB} ${walkMode ? RIB_ON : RIB_OFF}`}>
        <Footprints size={13} /> Caminar
      </button>
      <VDivider />
      <button type="button" onClick={onRotateAxis} disabled={isRecomputing || isGenerating} className={`${RIB} ${RIB_OFF}`}>
        {isRecomputing ? <span className="loading loading-spinner loading-xs" /> : <Rotate3D size={13} />}
        Rotar eje
        <span className="badge badge-xs badge-ghost font-mono">
          {phase1.appliedAxis === "Y" ? "Y↑" : "Z↑"}
        </span>
      </button>
    </>
  );
}

/** Apariencia — estilos visuales y ayudas gráficas sin mover la cámara. */
function VisualizationRibbon({
  xrayMode, onToggleXray, section, onToggleSection,
  showCenterAxes, onToggleCenterAxes, isSolid, onToggleSolid,
}: Pick<BottomToolbarProps,
  "xrayMode"|"onToggleXray"|"section"|"onToggleSection"|
  "showCenterAxes"|"onToggleCenterAxes"|"isSolid"|"onToggleSolid"
>) {
  return (
    <>
      <button type="button" onClick={onToggleSolid} className={`${RIB} ${isSolid ? RIB_ON : RIB_OFF}`}>
        <Box size={13} /> Vista maciza
      </button>
      <button type="button" onClick={onToggleXray} className={`${RIB} ${xrayMode ? RIB_ON : RIB_OFF}`}>
        <SquareDashedMousePointer size={13} /> Rayos X
      </button>
      <button type="button" onClick={onToggleSection} className={`${RIB} ${section.enabled ? RIB_ON : RIB_OFF}`}>
        <SquareBottomDashedScissors size={13} /> Plano de corte
      </button>
      <VDivider />
      <button type="button" onClick={onToggleCenterAxes} className={`${RIB} ${showCenterAxes ? RIB_ON : RIB_OFF}`}>
        <Move3D size={13} /> Ejes
      </button>
    </>
  );
}

function ToolsRibbon({
  activeTool, onSelectTool,
  markLineMode, onMarkLineModeChange,
  measureShapeKind, onMeasureShapeChange,
  measureLabelScale, onMeasureScaleChange,
  measureCount, onClearMeasures,
  cutShapeKind, onCutShapeChange,
  cutCount, edgeSnap, onToggleEdgeSnap,
  angleMeasureMode, onSetAngleMeasureMode,
  canMerge, onMerge, mergeTitle,
  canSplit, onSplit, splitTitle,
}: Pick<BottomToolbarProps,
  "activeTool"|"onSelectTool"|"markLineMode"|"onMarkLineModeChange"|
  "measureShapeKind"|"onMeasureShapeChange"|"measureLabelScale"|"onMeasureScaleChange"|
  "measureCount"|"onClearMeasures"|"cutShapeKind"|"onCutShapeChange"|
  "cutCount"|"edgeSnap"|"onToggleEdgeSnap"|"angleMeasureMode"|"onSetAngleMeasureMode"|
  "canMerge"|"onMerge"|"mergeTitle"|"canSplit"|"onSplit"|"splitTitle"
>) {
  const t = (tool: typeof activeTool) =>
    activeTool === tool
      ? tool === "cursor"
        ? `${RIB} bg-base-200/70 text-base-content/80 ring-1 ring-base-300/60`
        : `${RIB} ${RIB_ON}`
      : `${RIB} ${RIB_OFF}`;
  return (
    <>
      {/* Selection */}
      <button type="button" onClick={() => onSelectTool("cursor")} className={t("cursor")}>
        <MousePointer2 size={13} /> Cursor <kbd className="kbd kbd-xs">V</kbd>
      </button>
      <button type="button" onClick={() => onSelectTool("box")} className={t("box")}>
        <Lasso size={13} /> Selección área <kbd className="kbd kbd-xs">S</kbd>
      </button>
      <VDivider />
      {/* Unir / Dividir (mismos atajos F / D) */}
      <button
        type="button"
        onClick={onMerge}
        disabled={!canMerge}
        title={mergeTitle ?? (canMerge ? "Unir paredes seleccionadas (F)" : "Seleccioná 2 o más paredes para unir")}
        className={`${RIB} ${canMerge ? RIB_OFF : "opacity-30 cursor-not-allowed"}`}
      >
        <Link2 size={13} /> Unir <kbd className="kbd kbd-xs">F</kbd>
      </button>
      <button
        type="button"
        onClick={onSplit}
        disabled={!canSplit}
        title={splitTitle ?? (canSplit ? "Dividir fusión (D)" : "Seleccioná un componente fusionado para dividir")}
        className={`${RIB} ${canSplit ? RIB_OFF : "opacity-30 cursor-not-allowed"}`}
      >
        <SquareSplitHorizontal size={13} /> Dividir <kbd className="kbd kbd-xs">D</kbd>
      </button>
      <VDivider />
      {/* Drawing */}
      <button type="button" onClick={() => onSelectTool("cut")} className={t("cut")}>
        <Scissors size={13} /> Cortes <kbd className="kbd kbd-xs">C</kbd>
      </button>
      <button type="button" onClick={() => onSelectTool("measure")} className={t("measure")}>
        <Ruler size={13} /> Medir <kbd className="kbd kbd-xs">M</kbd>
      </button>
      <button type="button" onClick={() => onSelectTool("markLine")} className={t("markLine")}>
        <PenLine size={13} /> Marcas rojas <kbd className="kbd kbd-xs">R</kbd>
      </button>
      <button type="button" onClick={() => onSelectTool("angle")} className={t("angle")}>
        <Tangent size={13} />
        {activeTool === "angle" && angleMeasureMode === "panels" ? "Transportador (2P)" : "Transportador"}
        <kbd className="kbd kbd-xs">T</kbd>
      </button>

      {/* ── Active tool sub-modes ── */}
      {activeTool === "angle" && (
        <>
          <VDivider light />
          <span className="text-[10px] font-semibold text-primary/60 uppercase tracking-wide self-center">Modo</span>
          <button type="button" onClick={() => onSetAngleMeasureMode("line")}
            className={`${RIB} ${angleMeasureMode === "line" ? RIB_ON : RIB_OFF}`}
          >
            <Tangent size={13} /> Línea
          </button>
          <button type="button" onClick={() => onSetAngleMeasureMode("panels")}
            className={`${RIB} ${angleMeasureMode === "panels" ? RIB_ON : RIB_OFF}`}
          >
            <Layers size={13} /> Entre componentes
          </button>
        </>
      )}
      {activeTool === "markLine" && (
        <>
          <VDivider light />
          <span className="text-[10px] font-semibold text-error/60 uppercase tracking-wide self-center">Trazo</span>
          {([
            { m: "straight" as const, icon: Minus,             label: "Recta"      },
            { m: "freehand" as const, icon: Spline,            label: "Libre"      },
            { m: "rect"     as const, icon: RectangleHorizontal, label: "Rectángulo" },
            { m: "circle"   as const, icon: Circle,            label: "Círculo"    },
          ] as const).map(({ m, icon: Icon, label }) => (
            <button key={m} type="button" onClick={() => onMarkLineModeChange(m)}
              className={`${RIB} ${markLineMode === m ? "bg-error/15 text-error ring-1 ring-error/30" : "text-error/60 hover:bg-error/10 hover:text-error"}`}
            >
              <Icon size={13} /> {label}
            </button>
          ))}
        </>
      )}

      {activeTool === "measure" && (
        <>
          <VDivider light />
          <span className="text-[10px] font-semibold text-secondary/60 uppercase tracking-wide self-center">Forma</span>
          {([
            { kind: "line" as const, icon: Minus,             label: "Distancia" },
            { kind: "rect" as const, icon: RectangleHorizontal, label: "Área"     },
          ] as const).map(({ kind, icon: Icon, label }) => (
            <button key={kind} type="button" onClick={() => onMeasureShapeChange(kind)}
              className={`${RIB} ${measureShapeKind === kind ? "bg-secondary/15 text-secondary ring-1 ring-secondary/30" : "text-secondary/60 hover:bg-secondary/10 hover:text-secondary"}`}
            >
              <Icon size={13} /> {label}
            </button>
          ))}
          <MeasureScaleSelect
            value={measureLabelScale}
            onChange={onMeasureScaleChange}
            onClick={(e) => e.stopPropagation()}
            selectClassName="select select-bordered select-xs h-8 min-h-8 w-[5.5rem] bg-base-100 font-mono text-[11px]"
          />
          <button type="button" onClick={onToggleEdgeSnap}
            className={`${RIB} ${edgeSnap ? "bg-secondary/15 text-secondary ring-1 ring-secondary/30" : RIB_OFF}`}
            title="Bordes pegajosos"
          >
            <Magnet size={13} /> Snap
          </button>
          {measureCount > 0 && (
            <button type="button" onClick={onClearMeasures} className={`${RIB} text-error/60 hover:bg-error/10 hover:text-error`} title="Borrar medidas">
              <Trash2 size={13} />
              <span className="tabular-nums">{measureCount}</span>
            </button>
          )}
        </>
      )}

      {activeTool === "cut" && (
        <>
          <VDivider light />
          <span className="text-[10px] font-semibold text-secondary/60 uppercase tracking-wide self-center">Forma</span>
          {([
            { kind: "rect"   as const, icon: RectangleHorizontal, label: "Rectángulo" },
            { kind: "circle" as const, icon: Circle,            label: "Círculo"    },
            { kind: "line"   as const, icon: Minus,             label: "Línea"      },
          ] as const).map(({ kind, icon: Icon, label }) => (
            <button key={kind} type="button" onClick={() => onCutShapeChange(kind)}
              className={`${RIB} ${cutShapeKind === kind ? "bg-secondary/15 text-secondary ring-1 ring-secondary/30" : "text-secondary/60 hover:bg-secondary/10 hover:text-secondary"}`}
            >
              <Icon size={13} /> {label}
            </button>
          ))}
          <button type="button" onClick={onToggleEdgeSnap}
            className={`${RIB} ${edgeSnap ? "bg-secondary/15 text-secondary ring-1 ring-secondary/30" : RIB_OFF}`}
            title="Bordes pegajosos"
          >
            <Magnet size={13} /> Snap
          </button>
          {cutCount > 0 && (
            <span className="self-center text-[11px] font-mono font-semibold text-warning/70 px-1">
              {cutCount} cortes
            </span>
          )}
        </>
      )}
    </>
  );
}


// ─── Config panel ─────────────────────────────────────────────────────────────

function ConfigPanel({
  minAreaM2, onMinAreaChange, minAreaOptions, formatMinAreaOption,
  isRecomputing, isGenerating,
  pinTools, onPinToolsChange,
}: {
  minAreaM2: number;
  onMinAreaChange: (v: number) => void;
  minAreaOptions: number[];
  formatMinAreaOption: (v: number) => string;
  isRecomputing: boolean;
  isGenerating: boolean;
  pinTools: boolean;
  onPinToolsChange: (pin: boolean) => void;
}) {
  return (
    <ConfigButtom
      minAreaM2={minAreaM2}
      onMinAreaChange={onMinAreaChange}
      minAreaOptions={minAreaOptions}
      formatMinAreaOption={formatMinAreaOption}
      isRecomputing={isRecomputing}
      isGenerating={isGenerating}
      pinTools={pinTools}
      onPinToolsChange={onPinToolsChange}
    />
  );
}

// ─── Active tool badge (exported) ─────────────────────────────────────────────

const TOOL_ICON: Record<string, LucideIcon> = {
  cut: Scissors, measure: Ruler, markLine: PenLine, box: Lasso, rib: Magnet, angle: Tangent,
};
const TOOL_LABEL: Record<string, string> = {
  cursor: "Cursor", box: "Área", cut: "Cortes", measure: "Medir", markLine: "Marcas rojas", rib: "Nervio", angle: "Transportador",
};
const CUT_SHAPE_LABELS: Record<ActiveCutShapeKind, string>   = { rect: "Rectángulo", circle: "Círculo", line: "Línea" };
const MEASURE_SHAPE_LABELS: Record<MeasureShapeKind, string> = { line: "Distancia", rect: "Área" };
const MARK_LABELS: Record<MarkLineMode, string>              = { straight: "Recta", freehand: "Libre", rect: "Rectángulo", circle: "Círculo" };

export function ActiveToolBadge({
  activeTool,
  cutShapeKind, onCutShapeChange,
  measureShapeKind, onMeasureShapeChange,
  markLineMode, onMarkLineModeChange,
  cutCount, measureCount,
  hideToolbar,
  angleMeasureMode, onSetAngleMeasureMode,
}: {
  activeTool: BottomToolbarProps["activeTool"];
  cutShapeKind: ActiveCutShapeKind;
  onCutShapeChange: (k: ActiveCutShapeKind) => void;
  measureShapeKind: MeasureShapeKind;
  onMeasureShapeChange: (k: MeasureShapeKind) => void;
  markLineMode: MarkLineMode;
  onMarkLineModeChange: (m: MarkLineMode) => void;
  cutCount: number;
  measureCount: number;
  hideToolbar: boolean;
  angleMeasureMode?: "off" | "line" | "panels";
  onSetAngleMeasureMode?: (m: "line" | "panels") => void;
}) {
  // Hide the badge if no tool is active
  if (activeTool === "cursor") return null;

  const ToolIcon = TOOL_ICON[activeTool];
  const count = activeTool === "cut" ? cutCount : activeTool === "measure" ? measureCount : 0;
  const isError     = activeTool === "markLine";
  const isSecondary = activeTool === "cut" || activeTool === "measure";

  const accentHeader = isError     ? "bg-error/90 text-error-content"
                     : isSecondary ? "bg-secondary/90 text-secondary-content"
                     :               "bg-primary/90 text-primary-content";
  const accentActive = isError     ? "bg-error/15 text-error ring-1 ring-error/30"
                     : isSecondary ? "bg-secondary/15 text-secondary ring-1 ring-secondary/30"
                     :               "bg-primary/15 text-primary ring-1 ring-primary/30";
  const accentHover  = isError     ? "text-error/60 hover:bg-error/10 hover:text-error"
                     : isSecondary ? "text-secondary/60 hover:bg-secondary/10 hover:text-secondary"
                     :               "text-base-content/60 hover:bg-base-200";

  // When toolbar is visible push badge below it; when hidden go to the very top
  const topPos = hideToolbar ? "top-4" : "top-[3.5rem]";

  const shapeOptions =
    activeTool === "markLine" ? [
      { key: "straight" as MarkLineMode,       ShapeIcon: Minus,               label: "Recta"      },
      { key: "freehand" as MarkLineMode,        ShapeIcon: Spline,              label: "Libre"      },
      { key: "rect"     as MarkLineMode,        ShapeIcon: RectangleHorizontal, label: "Rectángulo" },
      { key: "circle"   as MarkLineMode,        ShapeIcon: Circle,              label: "Círculo"    },
    ] :
    activeTool === "cut" ? [
      { key: "rect"   as ActiveCutShapeKind,    ShapeIcon: RectangleHorizontal, label: "Rectángulo" },
      { key: "circle" as ActiveCutShapeKind,    ShapeIcon: Circle,              label: "Círculo"    },
      { key: "line"   as ActiveCutShapeKind,    ShapeIcon: Minus,               label: "Línea"      },
    ] :
    activeTool === "measure" ? [
      { key: "line" as MeasureShapeKind,        ShapeIcon: Minus,               label: "Distancia"  },
      { key: "rect" as MeasureShapeKind,        ShapeIcon: RectangleHorizontal, label: "Área"       },
    ] :
    activeTool === "angle" ? [
      { key: "line"   as "line"|"panels",       ShapeIcon: Tangent,             label: "Línea"      },
      { key: "panels" as "line"|"panels",       ShapeIcon: Layers,              label: "Componentes"},
    ] : ([] as { key: string; ShapeIcon: LucideIcon; label: string }[]);

  const currentKey =
    activeTool === "markLine" ? markLineMode :
    activeTool === "cut"      ? cutShapeKind :
    activeTool === "measure"  ? measureShapeKind :
    activeTool === "angle"    ? (angleMeasureMode === "off" ? "line" : angleMeasureMode) : null;

  const handleShapeClick = (key: string) => {
    if (activeTool === "markLine") onMarkLineModeChange(key as MarkLineMode);
    else if (activeTool === "cut") onCutShapeChange(key as ActiveCutShapeKind);
    else if (activeTool === "measure") onMeasureShapeChange(key as MeasureShapeKind);
    else if (activeTool === "angle") onSetAngleMeasureMode?.(key as "line" | "panels");
  };

  return (
    <div
      data-viewer-chrome
      className={`absolute ${topPos} right-4 z-50 flex flex-col gap-1 pointer-events-auto transition-all`}
    >
      {/* Tool name pill */}
      <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl shadow-lg backdrop-blur-md text-xs font-semibold self-end ${accentHeader}`}>
        {ToolIcon && <ToolIcon size={13} />}
        <span>
          {activeTool === "angle" && angleMeasureMode === "panels"
            ? "Transportador (2P)"
            : TOOL_LABEL[activeTool]}
        </span>
        {count > 0 && (
          <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-base-300/60 tabular-nums text-[10px] font-bold">{count}</span>
        )}
      </div>

      {/* Shape / mode selector — only for tools with sub-options */}
      {shapeOptions.length > 0 && (
        <div className="flex flex-col gap-0.5 rounded-xl bg-base-100/95 backdrop-blur-xl border border-base-300/40 shadow-lg p-1 self-end min-w-[7rem]">
          {shapeOptions.map(({ key, ShapeIcon, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => handleShapeClick(key)}
              className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-lg text-left font-medium transition-colors ${
                currentKey === key ? accentActive : accentHover
              }`}
            >
              <ShapeIcon size={12} />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function BottomToolbar(props: BottomToolbarProps) {
  const {
    stats, visibleCategories, onToggleVisibility,
    canUndo, canRedo, onUndo, onRedo,
    xrayMode, onToggleXray, section, onToggleSection,
    walkMode, onToggleWalk, onFrameCamera, selectedGroupIds,
    activeTool, onSelectTool, onCycleCutShape,
    markLineMode, onMarkLineModeChange,
    measureShapeKind, onMeasureShapeChange,
    measureLabelScale, onMeasureScaleChange, measureCount, onClearMeasures,
    cutShapeKind, onCutShapeChange, cutCount, edgeSnap, onToggleEdgeSnap,
    hiddenCount, onShowAllHidden,
    phase1, onRotateAxis, isRecomputing, isGenerating,
    showCenterAxes, onToggleCenterAxes, isSolid, onToggleSolid,
    hideSidebar, onToggleSidebar, hideToolbar, onToggleToolbar,
    minAreaM2, onMinAreaChange, minAreaOptions, formatMinAreaOption,
    pinTools, onPinToolsChange,
    angleMeasureMode, onSetAngleMeasureMode,
    canMerge, onMerge, mergeTitle,
    canSplit, onSplit, splitTitle,
  } = props;

  const [openGroups, setOpenGroups] = useState<Set<GroupId>>(new Set());
  const [visible,    setVisible]    = useState<Record<GroupId, boolean>>(loadVisible);
  const rootRef = useRef<HTMLDivElement>(null);

  // pinTools ON  → al abrir un grupo se suma a los ya abiertos (no reemplaza).
  // pinTools OFF → solo un grupo abierto a la vez.
  const toggle = (id: GroupId) => {
    setOpenGroups((prev) => {
      if (pinTools) {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }
      // Sin acumular: click en el abierto lo cierra; click en otro lo reemplaza.
      if (prev.has(id) && prev.size === 1) return new Set();
      return new Set<GroupId>([id]);
    });
  };

  // Si se desactiva acumular con varios abiertos, dejar solo el primero.
  useEffect(() => {
    if (pinTools) return;
    setOpenGroups((prev) => {
      if (prev.size <= 1) return prev;
      const first = GROUP_DEFS.find((g) => prev.has(g.id))?.id;
      return first ? new Set<GroupId>([first]) : new Set();
    });
  }, [pinTools]);

  const toggleVisible = (id: GroupId) => {
    setVisible((p) => {
      const n = { ...p, [id]: !p[id] };
      saveVisible(n);
      if (!n[id]) setOpenGroups((o) => { const no = new Set(o); no.delete(id); return no; });
      return n;
    });
  };

  // Which groups are visible AND open (preserving GROUP_DEFS order)
  const openList = GROUP_DEFS.filter((g) => visible[g.id] && openGroups.has(g.id)).map((g) => g.id);
  const anyOpen = openList.length > 0;

  const toolLabel =
    activeTool === "cut" ? "Cortes" : activeTool === "measure" ? "Medir" :
    activeTool === "markLine" ? "Marcas" : activeTool === "rib" ? "Nervio" :
    activeTool === "angle"
      ? (angleMeasureMode === "panels" ? "Transportador (2P)" : "Transportador")
      : activeTool === "box" ? "Área" : "Herramientas";

  const renderRibbon = (id: GroupId) => {
    switch (id) {
      case "visibility": return <VisibilityRibbon stats={stats} visibleCategories={visibleCategories} onToggle={onToggleVisibility} hiddenCount={hiddenCount} onShowAllHidden={onShowAllHidden} />;
      case "nav": return (
        <NavRibbon
          walkMode={walkMode} onToggleWalk={onToggleWalk}
          onFrameCamera={onFrameCamera} selectedGroupIds={selectedGroupIds}
          phase1={phase1} onRotateAxis={onRotateAxis}
          isRecomputing={isRecomputing} isGenerating={isGenerating}
        />
      );
      case "visualizacion": return (
        <VisualizationRibbon
          xrayMode={xrayMode} onToggleXray={onToggleXray}
          section={section} onToggleSection={onToggleSection}
          showCenterAxes={showCenterAxes} onToggleCenterAxes={onToggleCenterAxes}
          isSolid={isSolid} onToggleSolid={onToggleSolid}
        />
      );
      case "tools": return (
        <ToolsRibbon
          activeTool={activeTool} onSelectTool={onSelectTool}
          markLineMode={markLineMode} onMarkLineModeChange={onMarkLineModeChange}
          measureShapeKind={measureShapeKind} onMeasureShapeChange={onMeasureShapeChange}
          measureLabelScale={measureLabelScale} onMeasureScaleChange={onMeasureScaleChange}
          measureCount={measureCount} onClearMeasures={onClearMeasures}
          cutShapeKind={cutShapeKind} onCutShapeChange={onCutShapeChange}
          cutCount={cutCount} edgeSnap={edgeSnap} onToggleEdgeSnap={onToggleEdgeSnap}
          angleMeasureMode={angleMeasureMode} onSetAngleMeasureMode={onSetAngleMeasureMode}
          canMerge={canMerge} onMerge={onMerge} mergeTitle={mergeTitle}
          canSplit={canSplit} onSplit={onSplit} splitTitle={splitTitle}
        />
      );
    }
  };

  const toolsOpen = openGroups.has("tools");

  return (
    <>
    <div
      ref={rootRef}
      data-viewer-chrome
      className="absolute top-4 left-4 right-4 z-40 flex flex-col gap-1.5 pointer-events-none"
    >
      {/* ── Tab bar ─────────────────────────────────────────────── */}
        <div className="pointer-events-auto relative z-50 flex items-center gap-0.5 p-1 rounded-2xl bg-base-100/90 backdrop-blur-xl e2d-cyber-panel border border-base-300/40 shadow-lg shadow-base-content/5">

        {/* Undo / Redo — siempre visibles */}
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          title="Deshacer (Ctrl Z)"
          className={`${TAB} px-2 ${canUndo ? TAB_OFF : "opacity-30 cursor-not-allowed"}`}
        >
          <ArrowLeft size={14} />
        </button>
        <button
          type="button"
          onClick={onRedo}
          disabled={!canRedo}
          title="Rehacer (Ctrl Y)"
          className={`${TAB} px-2 ${canRedo ? TAB_OFF : "opacity-30 cursor-not-allowed"}`}
        >
          <ArrowRight size={14} />
        </button>
        <div className="shrink-0 self-stretch w-px bg-base-300/40 mx-1 rounded-full" />

        {/* Group tabs — single scrollable row */}
        <div className="flex items-center gap-0.5 flex-1 overflow-x-auto min-w-0 scrollbar-none"
          style={{ scrollbarWidth: "none" }}
        >
          {GROUP_DEFS.map((g, i) => {
            if (!visible[g.id]) return null;
            const Icon = g.icon;
            const isOpen   = openGroups.has(g.id);
            const isActive =
              (g.id === "nav"           && walkMode)                                                    ||
              (g.id === "visualizacion" && (xrayMode || section.enabled || isSolid || showCenterAxes)) ||
              (g.id === "tools"         && activeTool !== "cursor");
            const badge =
              g.id === "visibility" && hiddenCount > 0 ? hiddenCount : undefined;

            return (
              <button
                key={g.id}
                type="button"
                data-tour={`toolbar-${g.id}`}
                onClick={() => toggle(g.id)}
                className={`${TAB} ${isOpen ? TAB_ON : isActive ? TAB_ACTIVE : TAB_OFF}`}
              >
                <Icon size={14} />
                <span className="hidden sm:inline">
                  {g.id === "tools" ? toolLabel : g.label}
                </span>
                {badge !== undefined && (
                  <span className="ml-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-primary text-primary-content text-[9px] font-bold tabular-nums">
                    {badge}
                  </span>
                )}
                <ChevronDown size={11} className={`opacity-40 transition-transform duration-150 ${isOpen ? "rotate-180" : ""}`} />
                {/* Separator after each visible group */}
                {i < GROUP_DEFS.length - 1 && <span />}
              </button>
            );
          })}
        </div>

        {/* Config dropdown — always on the right */}
        <div className="shrink-0 self-stretch w-px bg-base-300/40 mx-1 rounded-full" />
        <ConfigPanel
          minAreaM2={minAreaM2}
          onMinAreaChange={onMinAreaChange}
          minAreaOptions={minAreaOptions}
          formatMinAreaOption={formatMinAreaOption}
          isRecomputing={isRecomputing}
          isGenerating={isGenerating}
          pinTools={pinTools}
          onPinToolsChange={onPinToolsChange}
        />

        {/* Toolbar collapse chevron — always visible at far right */}
        <div className="shrink-0 self-stretch w-px bg-base-300/30 mx-1 rounded-full" />
        <button
          type="button"
          onClick={onToggleToolbar}
          title="Ocultar barra de herramientas"
          className={`${TAB} ${TAB_OFF} px-2`}
        >
          <ChevronUp size={14} className="opacity-60" />
        </button>
      </div>

      {/* ── Ribbon row — all open groups merged, scrollable ──────── */}
      {anyOpen && (
        <div
          data-tour="toolbar-ribbon"
          className="pointer-events-auto relative z-40 flex items-center gap-x-0.5 px-2 py-1.5 rounded-2xl bg-base-100/95 backdrop-blur-xl border border-base-300/45 shadow-lg shadow-base-content/8 overflow-x-auto"
          style={{ scrollbarWidth: "none" }}
        >

          {openList.map((id, idx) => {
            const content = renderRibbon(id);
            if (!content) return null;
            return (
              <div key={id} className="contents">
                {idx > 0 && <VDivider />}
                {/* Section label */}
                <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide self-center px-0.5 text-base-content/35">
                  {GROUP_DEFS.find((g) => g.id === id)?.label}
                </span>
                <VDivider light />
                {content}
              </div>
            );
          })}
        </div>
      )}

    </div>

    {/* Mini badge — shows when a tool is active but its flyout is closed */}
    {activeTool !== "cursor" && !toolsOpen && (
      <ActiveToolBadge
        activeTool={activeTool}
        cutShapeKind={cutShapeKind}
        onCutShapeChange={onCutShapeChange}
        measureShapeKind={measureShapeKind}
        onMeasureShapeChange={onMeasureShapeChange}
        markLineMode={markLineMode}
        onMarkLineModeChange={onMarkLineModeChange}
        cutCount={cutCount}
        measureCount={measureCount}
        hideToolbar={false}
        angleMeasureMode={angleMeasureMode}
        onSetAngleMeasureMode={onSetAngleMeasureMode}
      />
    )}
    </>
  );
}
