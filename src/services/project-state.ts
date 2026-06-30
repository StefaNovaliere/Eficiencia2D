import type { ClassificationOverride, SplitOp } from "@/core/pipeline";
import type { SheetConfig } from "@/core/types";
import type { UserCut } from "@/core/user-cuts";
import { parseUserCutsFromApi } from "@/core/user-cuts";
import type { PdfPageMode } from "@/context/ProjectContext";
import type { SplitOperation } from "@/services/api";
import { userCutsForApi } from "@/services/api";

/** Estado consolidado del proyecto en R2 (`estado.json`). */
export interface ProjectSavedState {
  nombre?: string;
  axis?: "Y" | "Z";
  min_area_m2?: number;
  merges?: number[][];
  splits?: SplitOperation[];
  overrides?: Record<string, string>;
  wall_wall_decisions?: Record<string, number>;
  marks?: number[];
  user_cuts?: Record<string, unknown>[];
  sheet_config?: { width_m: number; height_m: number; gap_m: number };
  scale_denom?: number;
  paper?: string;
  page_mode?: PdfPageMode;
}

export type ProjectStatePatch = Partial<ProjectSavedState>;

export interface ProjectStatePatchResponse {
  proyecto_id: string;
  nombre: string;
  estado_r2: string;
  estado_actualizado_at: string;
  estado: ProjectSavedState;
  message: string;
}

export interface RestoredProjectState {
  projectFileName?: string;
  minAreaM2?: number;
  savedMerges?: number[][];
  savedSplits?: SplitOp[];
  savedOverrides?: ClassificationOverride[];
  savedWallWallDecisions?: Map<number, number>;
  savedMarks?: number[];
  savedUserCuts?: UserCut[];
  scale?: number;
  paper?: string;
  pdfPageMode?: PdfPageMode;
  sheetConfig?: SheetConfig;
  axis?: "Y" | "Z";
}

export interface ReviewEditingSnapshot {
  overrides: ClassificationOverride[];
  wallWallDecisions: Map<number, number>;
  marks: number[];
  userCuts: UserCut[];
}

function parseRecordOfStrings(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value != null && value !== "") out[String(key)] = String(value);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseRecordOfNumbers(raw: unknown): Record<string, number> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(value);
    if (Number.isFinite(n)) out[String(key)] = n;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseSplits(raw: unknown): SplitOperation[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const splits: SplitOperation[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;
    const groupId = Number(s.group_id ?? s.groupId);
    const mode = s.mode;
    if (!Number.isFinite(groupId) || (mode !== "components" && mode !== "panels")) continue;
    splits.push({ group_id: groupId, mode });
  }
  return splits.length > 0 ? splits : undefined;
}

function parseSheetConfig(raw: unknown): ProjectSavedState["sheet_config"] | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const s = raw as Record<string, unknown>;
  const width = Number(s.width_m ?? s.widthM);
  const height = Number(s.height_m ?? s.heightM);
  const gap = Number(s.gap_m ?? s.gapM);
  if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(gap)) {
    return undefined;
  }
  return { width_m: width, height_m: height, gap_m: gap };
}

export function parseSavedState(raw: unknown): ProjectSavedState | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const state: ProjectSavedState = {};

  if (typeof o.nombre === "string" && o.nombre.trim()) state.nombre = o.nombre.trim();
  if (o.axis === "Y" || o.axis === "Z") state.axis = o.axis;

  const minArea = Number(o.min_area_m2 ?? o.minAreaM2);
  if (Number.isFinite(minArea)) state.min_area_m2 = minArea;

  if (Array.isArray(o.merges)) state.merges = o.merges as number[][];

  const splits = parseSplits(o.splits);
  if (splits) state.splits = splits;

  const overrides = parseRecordOfStrings(o.overrides);
  if (overrides) state.overrides = overrides;

  const wallDecisions = parseRecordOfNumbers(o.wall_wall_decisions ?? o.wallWallDecisions);
  if (wallDecisions) state.wall_wall_decisions = wallDecisions;

  if (Array.isArray(o.marks)) {
    state.marks = o.marks.map(Number).filter((n) => Number.isFinite(n));
  }

  if (Array.isArray(o.user_cuts)) {
    state.user_cuts = o.user_cuts as Record<string, unknown>[];
  }

  const sheetConfig = parseSheetConfig(o.sheet_config ?? o.sheetConfig);
  if (sheetConfig) state.sheet_config = sheetConfig;

  const scale = Number(o.scale_denom ?? o.scaleDenom);
  if (Number.isFinite(scale)) state.scale_denom = scale;

  if (typeof o.paper === "string" && o.paper.trim()) state.paper = o.paper.trim();

  const pageMode = o.page_mode ?? o.pageMode;
  if (pageMode === "one_per_sheet" || pageMode === "single_page") {
    state.page_mode = pageMode;
  }

  return state;
}

export function restoreProjectState(raw: unknown): RestoredProjectState | null {
  const state = parseSavedState(raw);
  if (!state) return null;

  const restored: RestoredProjectState = {};

  if (state.nombre) restored.projectFileName = state.nombre;
  if (state.min_area_m2 != null) restored.minAreaM2 = state.min_area_m2;
  if (state.merges) restored.savedMerges = state.merges;
  if (state.splits) {
    restored.savedSplits = state.splits.map((s) => ({
      groupId: s.group_id,
      mode: s.mode,
    }));
  }
  if (state.overrides) {
    restored.savedOverrides = Object.entries(state.overrides).map(([groupId, newCategory]) => ({
      groupId: Number(groupId),
      newCategory,
    }));
  }
  if (state.wall_wall_decisions) {
    restored.savedWallWallDecisions = new Map(
      Object.entries(state.wall_wall_decisions).map(([k, v]) => [Number(k), v]),
    );
  }
  if (state.marks) restored.savedMarks = state.marks;
  if (state.user_cuts) restored.savedUserCuts = parseUserCutsFromApi(state.user_cuts);
  if (state.scale_denom != null) restored.scale = state.scale_denom;
  if (state.paper) restored.paper = state.paper;
  if (state.page_mode) restored.pdfPageMode = state.page_mode;
  if (state.sheet_config) {
    restored.sheetConfig = {
      widthM: state.sheet_config.width_m,
      heightM: state.sheet_config.height_m,
      gapM: state.sheet_config.gap_m,
    };
  }
  if (state.axis) restored.axis = state.axis;

  return restored;
}

export function overridesToStateRecord(
  overrides: ClassificationOverride[],
): Record<string, string> {
  return Object.fromEntries(
    overrides.map((o) => [String(o.groupId), o.newCategory]),
  );
}

export function decisionsToStateRecord(
  decisions: Map<number, number>,
): Record<string, number> {
  return Object.fromEntries(
    Array.from(decisions.entries()).map(([k, v]) => [String(k), v]),
  );
}

export function buildReviewEditingPatch(snapshot: ReviewEditingSnapshot): ProjectStatePatch {
  const patch: ProjectStatePatch = {};

  if (snapshot.overrides.length > 0) {
    patch.overrides = overridesToStateRecord(snapshot.overrides);
  }
  if (snapshot.wallWallDecisions.size > 0) {
    patch.wall_wall_decisions = decisionsToStateRecord(snapshot.wallWallDecisions);
  }
  if (snapshot.marks.length > 0) {
    patch.marks = snapshot.marks;
  }
  if (snapshot.userCuts.length > 0) {
    patch.user_cuts = userCutsForApi(snapshot.userCuts);
  }

  return patch;
}

export function savedStateNeedsRecompute(
  restored: RestoredProjectState,
  topologyAxis: "Y" | "Z",
): boolean {
  const axisMismatch = restored.axis != null && restored.axis !== topologyAxis;
  const hasMerges = (restored.savedMerges?.length ?? 0) > 0;
  const hasSplits = (restored.savedSplits?.length ?? 0) > 0;
  const hasMinArea = restored.minAreaM2 != null;
  return axisMismatch || hasMerges || hasSplits || hasMinArea;
}
