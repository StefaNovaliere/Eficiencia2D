import { rotateEdges } from "@/core/sheet-nester";
import type { NestingSheet, PlacedNestingPanel, SheetConfig } from "@/core/sheet-nester";
import type { HeroSheetLayout } from "./demo-nesting-sheets";

export interface NestingCanvasColors {
  wall: string;
  floor: string;
  sheetBg: string;
  sheetStroke: string;
  labelText: string;
}

/** Mismo criterio visual que `SheetCanvas` en NestingPreview. */
function drawPlacedPanel(
  ctx: CanvasRenderingContext2D,
  placed: PlacedNestingPanel,
  sheetOx: number,
  sheetOy: number,
  pxPerM: number,
  wallColor: string,
  floorColor: string,
) {
  const { panel, x, y, rotated, effectiveW, effectiveH } = placed;
  const px = sheetOx + x;
  const py = sheetOy + y;
  const color = panel.category === "floor" ? floorColor : wallColor;
  const edges = rotated ? rotateEdges(panel.edges, panel.widthM) : panel.edges;

  ctx.fillStyle = color + "18";
  ctx.fillRect(px * pxPerM, py * pxPerM, effectiveW * pxPerM, effectiveH * pxPerM);

  const isMark = panel.isMark === true;
  ctx.lineWidth = 1.25;
  ctx.lineJoin = "round";
  for (const e of edges) {
    ctx.strokeStyle = isMark && e.hole === true ? "#dc2626" : color;
    ctx.beginPath();
    ctx.moveTo((px + e.a.x) * pxPerM, (py + e.a.y) * pxPerM);
    ctx.lineTo((px + e.b.x) * pxPerM, (py + e.b.y) * pxPerM);
    ctx.stroke();
  }

  const LABEL_M = 0.008;
  const targetPx = LABEL_M * pxPerM;
  const maxPx = Math.min(effectiveW, effectiveH) * pxPerM * 0.7;
  const fontSize = Math.max(7, Math.min(targetPx, maxPx));
  if (fontSize >= 7) {
    ctx.fillStyle = color;
    ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(panel.id, (px + effectiveW / 2) * pxPerM, (py + effectiveH / 2) * pxPerM);
  }
}

function drawSheet(
  ctx: CanvasRenderingContext2D,
  sheet: NestingSheet,
  config: SheetConfig,
  pxPerM: number,
  colors: NestingCanvasColors,
  showLabel: boolean,
) {
  const wPx = config.widthM * pxPerM;
  const hPx = config.heightM * pxPerM;

  ctx.fillStyle = colors.sheetBg;
  ctx.fillRect(0, 0, wPx, hPx);

  ctx.strokeStyle = colors.sheetStroke;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(0, 0, wPx, hPx);
  ctx.setLineDash([]);

  if (showLabel) {
    ctx.fillStyle = colors.labelText;
    ctx.font = "600 11px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(
      `Plancha ${sheet.index + 1} (${(sheet.utilization * 100).toFixed(0)}%)`,
      wPx / 2,
      -4,
    );
  }

  for (const placed of sheet.panels) {
    drawPlacedPanel(ctx, placed, 0, 0, pxPerM, colors.wall, colors.floor);
  }
}

export function drawHeroNestingScene(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  sheets: NestingSheet[],
  config: SheetConfig,
  layouts: HeroSheetLayout[],
  colors: NestingCanvasColors,
  timeMs: number,
) {
  ctx.clearRect(0, 0, width, height);

  for (const layout of layouts) {
    const sheet = sheets[layout.sheetIndex];
    if (!sheet) continue;

    const drift = Math.sin(timeMs * 0.00035 + layout.phase) * 4;
    const wPx = config.widthM * layout.scale;
    const hPx = config.heightM * layout.scale;

    ctx.save();
    ctx.translate(layout.cx * width, layout.cy * height + drift);
    ctx.rotate(layout.rot);
    ctx.translate(-wPx / 2, -hPx / 2);
    drawSheet(ctx, sheet, config, layout.scale, colors, layout.sheetIndex === 0);
    ctx.restore();
  }
}
