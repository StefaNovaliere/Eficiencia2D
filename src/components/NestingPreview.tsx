"use client";

import { useCallback, useMemo, useRef, useEffect, useState } from "react";
import type { NestingPreviewData } from "@/core/pipeline";
import type { NestingResult, NestingSheet, PlacedNestingPanel } from "@/core/sheet-nester";
import type { SheetConfig } from "@/core/types";
import { getNestingCanvasColors, useTheme } from "@/context/ThemeContext";

export interface NestingPreviewProps {
  nesting: NestingPreviewData;
  onConfirm: () => void;
  onBack: () => void;
  sheetConfig: SheetConfig;
  onSheetConfigChange: (config: SheetConfig) => void;
  scaleDenom: number;
  onScaleChange: (scale: number) => void;
}

function SheetCanvas({
  sheets,
  config,
  color,
  label,
  sheetBg,
  sheetStroke,
  labelText,
}: {
  sheets: NestingSheet[];
  config: SheetConfig;
  color: string;
  label: string;
  sheetBg: string;
  sheetStroke: string;
  labelText: string;
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
      ctx.fillStyle = sheetBg;
      ctx.fillRect(toX(sx), toY(sy), config.widthM * scale, config.heightM * scale);

      // Sheet outline
      ctx.strokeStyle = sheetStroke;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(toX(sx), toY(sy), config.widthM * scale, config.heightM * scale);
      ctx.setLineDash([]);

      // Sheet label
      ctx.fillStyle = labelText;
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

        // Panel ID — fixed size in sheet space (8mm) so labels don't scale
        // with panel size and overlap edges.
        const LABEL_M = 0.008;
        const targetPx = LABEL_M * scale;
        const maxPx = Math.min(pw, ph) * scale * 0.7;
        const fontSize = Math.max(7, Math.min(targetPx, maxPx));
        if (fontSize >= 7) {
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
    }
  }, [sheets, config, color, dims, sheetBg, sheetStroke, labelText]);

  if (sheets.length === 0) return null;

  return (
    <div className="flex flex-col gap-4 mb-8">
      <div className="flex items-center gap-2 mb-2 font-medium">
        <span className="w-3 h-3 rounded-full" style={{ background: color }} />
        <span className="text-lg font-bold text-base-content">{label}</span>
        <span className="text-sm text-base-content/60">
          {sheets.reduce((s, sh) => s + sh.panels.length, 0)} componentes en{" "}
          {sheets.length} plancha{sheets.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="w-full h-[300px] bg-base-200/50 rounded-xl overflow-hidden relative" ref={containerRef}>
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
  const { theme } = useTheme();
  const canvasColors = getNestingCanvasColors(theme);

  const [localWidth, setLocalWidth] = useState(String(sheetConfig.widthM));
  const [localHeight, setLocalHeight] = useState(String(sheetConfig.heightM));
  const [showConfirm, setShowConfirm] = useState(false);

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

  // When a whole piece is too big for the sheet, work out the scale denominator
  // that would make the largest offending piece fit, so we can tell the user
  // exactly how much smaller to draw it instead of silently dropping it.
  const allUnplaced = [
    ...nesting.wallNesting.unplaced,
    ...nesting.floorNesting.unplaced,
  ];
  let suggestedScale = scaleDenom;
  for (const p of allUnplaced) {
    // p dimensions are already at the current scale (real / scaleDenom).
    // Largest side must fit in the largest sheet side (rotation allowed).
    const pieceMax = Math.max(p.widthM, p.heightM);
    const pieceMin = Math.min(p.widthM, p.heightM);
    const sheetMax = Math.max(sheetConfig.widthM, sheetConfig.heightM);
    const sheetMin = Math.min(sheetConfig.widthM, sheetConfig.heightM);
    const factor = Math.max(pieceMax / sheetMax, pieceMin / sheetMin);
    if (factor > 1) {
      const needed = Math.ceil(scaleDenom * factor);
      if (needed > suggestedScale) suggestedScale = needed;
    }
  }
  const nextScaleOption = SCALE_OPTIONS.find((s) => s >= suggestedScale) ?? suggestedScale;

  return (
    <div className="fixed inset-0 z-50 bg-base-100 flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 border-b border-base-300 bg-base-200/50 shrink-0">
        <button className="btn btn-ghost btn-sm" onClick={onBack}>
          &larr; Volver a revisión
        </button>
        <h2 className="text-lg font-bold hidden sm:block">Vista previa de planchas</h2>
        <div className="flex items-center gap-2 flex-wrap text-sm">
          <label className="font-medium text-base-content/70">Escala:</label>
          <select
            className="select select-bordered select-sm w-24 bg-base-100"
            value={scaleDenom}
            onChange={(e) => onScaleChange(Number(e.target.value))}
          >
            {SCALE_OPTIONS.map((s) => (
              <option key={s} value={s}>1:{s}</option>
            ))}
          </select>
          <span className="text-base-content/40 mx-2">&middot;</span>
          <label className="font-medium text-base-content/70">Plancha:</label>
          <input
            className="input input-bordered input-sm w-20 bg-base-100"
            type="number"
            step="0.01"
            min="0.1"
            value={localWidth}
            onChange={(e) => setLocalWidth(e.target.value)}
            onBlur={handleApplySize}
          />
          <span className="text-base-content/40">&times;</span>
          <input
            className="input input-bordered input-sm w-20 bg-base-100"
            type="number"
            step="0.01"
            min="0.1"
            value={localHeight}
            onChange={(e) => setLocalHeight(e.target.value)}
            onBlur={handleApplySize}
          />
          <span className="text-base-content/60 font-medium">m</span>
          <button className="btn btn-primary btn-sm ml-2" onClick={handleApplySize}>
            Aplicar
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-8 bg-base-100">
        <SheetCanvas
          sheets={nesting.wallNesting.sheets}
          config={nesting.config}
          color={canvasColors.wall}
          label="Paredes"
          sheetBg={canvasColors.sheetBg}
          sheetStroke={canvasColors.sheetStroke}
          labelText={canvasColors.labelText}
        />
        <SheetCanvas
          sheets={nesting.floorNesting.sheets}
          config={nesting.config}
          color={canvasColors.floor}
          label="Pisos"
          sheetBg={canvasColors.sheetBg}
          sheetStroke={canvasColors.sheetStroke}
          labelText={canvasColors.labelText}
        />

        {unplacedCount > 0 && (
          <div className="alert alert-warning shadow-sm mt-4 rounded-xl">
            <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            <div>
              {unplacedCount} componente{unplacedCount !== 1 ? "s" : ""} no
              {unplacedCount !== 1 ? "" : ""} entra{unplacedCount !== 1 ? "n" : ""}{" "}
              enteros en la plancha ({sheetConfig.widthM.toFixed(2)} &times;{" "}
              {sheetConfig.heightM.toFixed(2)} m).{" "}
              {nextScaleOption > scaleDenom ? (
                <>
                  Reduci la escala a <strong>1:{nextScaleOption}</strong> para que quepan.
                  <button
                    className="btn btn-xs btn-active ml-3"
                    onClick={() => onScaleChange(nextScaleOption)}
                  >
                    Aplicar 1:{nextScaleOption}
                  </button>
                </>
              ) : (
                <>Usa una plancha mas grande o reduci la escala.</>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="mt-auto border-t border-base-300 p-4 bg-base-200/30 flex flex-col sm:flex-row items-center justify-between gap-4 shrink-0">
        <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 text-xs font-medium">
          <span className="text-base-content/70">
            {sheetConfig.widthM.toFixed(2)} &times; {sheetConfig.heightM.toFixed(2)} m
          </span>
          <span className="text-base-content/30">&middot;</span>
          <span className="text-base-content/70">Escala 1:{displayScale}</span>
          <span className="text-base-content/30">&middot;</span>
          <span className="text-base-content/70">3mm separación</span>
          <span className="text-base-content/30">&middot;</span>
          <span className="text-base-content/70">
            {totalSheets} plancha{totalSheets !== 1 ? "s" : ""} total
          </span>
          {wallPanels > 0 && (
            <>
              <span className="text-base-content/30">&middot;</span>
              <span className="font-semibold" style={{ color: canvasColors.wall }}>
                {wallPanels} pared{wallPanels !== 1 ? "es" : ""}
              </span>
            </>
          )}
          {floorPanels > 0 && (
            <>
              <span className="text-base-content/30">&middot;</span>
              <span className="font-semibold" style={{ color: canvasColors.floor }}>
                {floorPanels} piso{floorPanels !== 1 ? "s" : ""}
              </span>
            </>
          )}
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <button className="btn btn-outline flex-1 sm:flex-none" onClick={onBack}>
            Volver
          </button>
          <button
            className="btn btn-primary flex-1 sm:flex-none"
            onClick={() => setShowConfirm(true)}
          >
            Generar y Descargar
          </button>
        </div>
      </div>

      {showConfirm && (
        <div className="fixed inset-0 z-[200] bg-neutral/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200" onClick={() => setShowConfirm(false)}>
          <div className="card bg-base-100 shadow-2xl max-w-md w-full border border-base-300 text-center" onClick={(e) => e.stopPropagation()}>
            <div className="card-body">
              <div className="text-warning flex justify-center mb-4">
                <svg
                  width="48"
                  height="48"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </div>
              <h3 className="text-xl font-bold mb-2">¿Revisaste todo bien?</h3>
              <p className="text-sm text-base-content/70 mb-4">
                Después de pagar no vas a poder modificar las planchas. Asegurate de
                haber revisado:
              </p>
              <ul className="text-left text-sm text-base-content/70 list-disc list-inside mb-6 space-y-1">
                <li>La clasificación de cada componente (pisos, paredes, descartados)</li>
                <li>La escala y el tamaño de la plancha</li>
                <li>Que no haya componentes sin ubicar</li>
              </ul>
              <div className="flex gap-2 w-full">
                <button
                  className="btn btn-outline flex-1"
                  onClick={() => setShowConfirm(false)}
                >
                  Volver a revisar
                </button>
                <button
                  className="btn btn-primary flex-1"
                  onClick={() => {
                    setShowConfirm(false);
                    onConfirm();
                  }}
                >
                  Continuar al pago
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
