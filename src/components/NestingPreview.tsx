"use client";

import { useCallback, useMemo, useRef, useEffect, useState } from "react";
import type { NestingPreviewData } from "@/core/pipeline";
import type { NestingResult, NestingSheet, PlacedNestingPanel } from "@/core/sheet-nester";
import type { SheetConfig } from "@/core/types";

export interface NestingPreviewProps {
  nesting: NestingPreviewData;
  onConfirm: () => void;
  onBack: () => void;
  sheetConfig: SheetConfig;
  onSheetConfigChange: (config: SheetConfig) => void;
  scaleDenom: number;
  onScaleChange: (scale: number) => void;
}

const WALL_COLOR = "#3b82f6";
const FLOOR_COLOR = "#22c55e";
const SHEET_STROKE = "#52525b";
const PANEL_STROKE = "#a1a1aa";
const UNPLACED_COLOR = "#ef4444";

function SheetCanvas({
  sheets,
  config,
  color,
  label,
}: {
  sheets: NestingSheet[];
  config: SheetConfig;
  color: string;
  label: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 600, h: 300 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setDims({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || sheets.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = dims.w * dpr;
    canvas.height = dims.h * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, dims.w, dims.h);

    const cols = Math.min(sheets.length, 4);
    const rows = Math.ceil(sheets.length / cols);
    const spacing = 0.05;
    const totalW = cols * config.widthM + (cols - 1) * spacing;
    const totalH = rows * config.heightM + (rows - 1) * spacing;

    const padding = 40;
    const availW = dims.w - padding * 2;
    const availH = dims.h - padding * 2;
    const scale = Math.min(availW / totalW, availH / totalH);

    const offsetX = padding + (availW - totalW * scale) / 2;
    const offsetY = padding + (availH - totalH * scale) / 2;

    function toX(v: number) { return offsetX + v * scale; }
    function toY(v: number) { return offsetY + v * scale; }

    for (let si = 0; si < sheets.length; si++) {
      const col = si % cols;
      const row = Math.floor(si / cols);
      const sx = col * (config.widthM + spacing);
      const sy = row * (config.heightM + spacing);

      // Sheet background
      ctx.fillStyle = "rgba(30, 30, 34, 0.8)";
      ctx.fillRect(toX(sx), toY(sy), config.widthM * scale, config.heightM * scale);

      // Sheet outline
      ctx.strokeStyle = SHEET_STROKE;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(toX(sx), toY(sy), config.widthM * scale, config.heightM * scale);
      ctx.setLineDash([]);

      // Sheet label
      ctx.fillStyle = "#a1a1aa";
      ctx.font = "11px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(
        `Plancha ${si + 1} (${(sheets[si].utilization * 100).toFixed(0)}%)`,
        toX(sx + config.widthM / 2),
        toY(sy) - 6,
      );

      // Panels
      for (const placed of sheets[si].panels) {
        const px = sx + placed.x;
        const py = sy + placed.y;
        const pw = placed.effectiveW;
        const ph = placed.effectiveH;

        ctx.fillStyle = color + "30";
        ctx.fillRect(toX(px), toY(py), pw * scale, ph * scale);

        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.strokeRect(toX(px), toY(py), pw * scale, ph * scale);

        // Panel ID
        const fontSize = Math.max(8, Math.min(13, Math.min(pw, ph) * scale * 0.25));
        ctx.fillStyle = color;
        ctx.font = `600 ${fontSize}px Inter, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(
          placed.panel.id,
          toX(px + pw / 2),
          toY(py + ph / 2),
        );
      }
    }
  }, [sheets, config, color, dims]);

  if (sheets.length === 0) return null;

  return (
    <div className="nesting-section">
      <div className="nesting-section-header">
        <span className="nesting-section-dot" style={{ background: color }} />
        <span className="nesting-section-label">{label}</span>
        <span className="nesting-section-count">
          {sheets.reduce((s, sh) => s + sh.panels.length, 0)} componentes en{" "}
          {sheets.length} plancha{sheets.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="nesting-canvas-wrap" ref={containerRef}>
        <canvas
          ref={canvasRef}
          width={dims.w}
          height={dims.h}
          style={{ width: "100%", height: "100%" }}
        />
      </div>
    </div>
  );
}

const SCALE_OPTIONS = [20, 25, 50, 75, 100, 125, 150, 200, 250, 500];

export default function NestingPreview({
  nesting,
  onConfirm,
  onBack,
  sheetConfig,
  onSheetConfigChange,
  scaleDenom,
  onScaleChange,
}: NestingPreviewProps) {
  const [localWidth, setLocalWidth] = useState(String(sheetConfig.widthM));
  const [localHeight, setLocalHeight] = useState(String(sheetConfig.heightM));

  const handleApplySize = useCallback(() => {
    const w = parseFloat(localWidth);
    const h = parseFloat(localHeight);
    if (w > 0.1 && h > 0.1) {
      onSheetConfigChange({ widthM: w, heightM: h, gapM: sheetConfig.gapM });
    }
  }, [localWidth, localHeight, sheetConfig.gapM, onSheetConfigChange]);

  const totalWallSheets = nesting.wallNesting.sheets.length;
  const totalFloorSheets = nesting.floorNesting.sheets.length;
  const totalSheets = totalWallSheets + totalFloorSheets;
  const wallPanels = nesting.wallNesting.sheets.reduce((s, sh) => s + sh.panels.length, 0);
  const floorPanels = nesting.floorNesting.sheets.reduce((s, sh) => s + sh.panels.length, 0);
  const unplacedCount = nesting.wallNesting.unplaced.length + nesting.floorNesting.unplaced.length;
  const displayScale = nesting.wallNesting.scaleDenom || nesting.floorNesting.scaleDenom || 1;

  return (
    <div className="nesting-overlay">
      <div className="nesting-header">
        <button className="nesting-back-btn" onClick={onBack}>
          &larr; Volver a revision
        </button>
        <h2 className="nesting-title">Vista previa de planchas</h2>
        <div className="nesting-sheet-config">
          <label className="nesting-config-label">Escala:</label>
          <select
            className="nesting-config-select"
            value={scaleDenom}
            onChange={(e) => onScaleChange(Number(e.target.value))}
          >
            {SCALE_OPTIONS.map((s) => (
              <option key={s} value={s}>1:{s}</option>
            ))}
          </select>
          <span className="nesting-config-sep" style={{ margin: "0 0.5rem" }}>&middot;</span>
          <label className="nesting-config-label">Plancha:</label>
          <input
            className="nesting-config-input"
            type="number"
            step="0.01"
            min="0.1"
            value={localWidth}
            onChange={(e) => setLocalWidth(e.target.value)}
            onBlur={handleApplySize}
          />
          <span className="nesting-config-sep">&times;</span>
          <input
            className="nesting-config-input"
            type="number"
            step="0.01"
            min="0.1"
            value={localHeight}
            onChange={(e) => setLocalHeight(e.target.value)}
            onBlur={handleApplySize}
          />
          <span className="nesting-config-unit">m</span>
          <button className="nesting-apply-btn" onClick={handleApplySize}>
            Aplicar
          </button>
        </div>
      </div>

      <div className="nesting-content">
        <SheetCanvas
          sheets={nesting.wallNesting.sheets}
          config={nesting.config}
          color={WALL_COLOR}
          label="Paredes"
        />
        <SheetCanvas
          sheets={nesting.floorNesting.sheets}
          config={nesting.config}
          color={FLOOR_COLOR}
          label="Pisos"
        />

        {unplacedCount > 0 && (
          <div className="nesting-warning">
            {unplacedCount} componente{unplacedCount !== 1 ? "s" : ""} no caben
            en la plancha ({sheetConfig.widthM.toFixed(2)} &times;{" "}
            {sheetConfig.heightM.toFixed(2)} m) y seran excluidos.
          </div>
        )}
      </div>

      <div className="nesting-bottom-bar">
        <div className="nesting-stats">
          <span className="nesting-stat">
            {sheetConfig.widthM.toFixed(2)} &times; {sheetConfig.heightM.toFixed(2)} m
          </span>
          <span className="stat-sep">&middot;</span>
          <span className="nesting-stat">Escala 1:{displayScale}</span>
          <span className="stat-sep">&middot;</span>
          <span className="nesting-stat">3mm separacion</span>
          <span className="stat-sep">&middot;</span>
          <span className="nesting-stat">
            {totalSheets} plancha{totalSheets !== 1 ? "s" : ""} total
          </span>
          {wallPanels > 0 && (
            <>
              <span className="stat-sep">&middot;</span>
              <span className="nesting-stat" style={{ color: WALL_COLOR }}>
                {wallPanels} pared{wallPanels !== 1 ? "es" : ""}
              </span>
            </>
          )}
          {floorPanels > 0 && (
            <>
              <span className="stat-sep">&middot;</span>
              <span className="nesting-stat" style={{ color: FLOOR_COLOR }}>
                {floorPanels} piso{floorPanels !== 1 ? "s" : ""}
              </span>
            </>
          )}
        </div>
        <div className="nesting-actions">
          <button className="review-btn review-btn--cancel" onClick={onBack}>
            Volver
          </button>
          <button className="review-btn review-btn--confirm" onClick={onConfirm}>
            Generar y Descargar
          </button>
        </div>
      </div>
    </div>
  );
}
