"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from "react";
import type {
  Phase1Result,
  ClassificationOverride,
  NestingPreviewData,
  SplitOp,
} from "@/core/pipeline";
import { DEFAULT_SHEET } from "@/core/sheet-nester";
import type { SheetConfig } from "@/core/types";
import type { UserCut } from "@/core/user-cuts";
import type { AssemblyPreviewData } from "@/services/api";
import type { RestoredProjectState } from "@/services/project-state";

interface PersistedSession {
  fileName: string;
  fileId: string;
  previewObj: string;
  phase1Result: Phase1Result;
  scale: number;
  paper: string;
  minAreaM2: number;
  sheetConfig: SheetConfig;
  overrides: ClassificationOverride[];
  wallWallDecisions: [number, number][];
  merges?: number[][];
  splits?: SplitOp[];
  marks?: number[];
  userCuts?: UserCut[];
  pageMode?: PdfPageMode;
}

const SESSION_KEY = "e2d_pending_session";

/** Paginación del PDF de planchas de corte (sólo afecta el PDF descargado). */
export type PdfPageMode = "one_per_sheet" | "single_page";


interface ProjectContextType {
  file: File | null;
  setFile: (file: File | null) => void;
  projectFileName: string | null;
  setProjectFileName: (name: string | null) => void;
  fileId: string | null;
  setFileId: (id: string | null) => void;
  previewObj: string | null;
  setPreviewObj: (obj: string | null) => void;
  scale: number;
  setScale: (scale: number) => void;
  paper: string;
  setPaper: (paper: string) => void;
  pdfPageMode: PdfPageMode;
  setPdfPageMode: (mode: PdfPageMode) => void;
  minAreaM2: number;
  setMinAreaM2: (area: number) => void;
  phase1Result: Phase1Result | null;
  setPhase1Result: (res: Phase1Result | null) => void;
  nestingData: NestingPreviewData | null;
  setNestingData: (data: NestingPreviewData | null) => void;
  sheetConfig: SheetConfig;
  setSheetConfig: (config: SheetConfig) => void;
  savedOverrides: ClassificationOverride[];
  setSavedOverrides: (overrides: ClassificationOverride[]) => void;
  savedWallWallDecisions: Map<number, number>;
  setSavedWallWallDecisions: (decisions: Map<number, number>) => void;
  savedMerges: number[][];
  setSavedMerges: (merges: number[][]) => void;
  savedSplits: SplitOp[];
  setSavedSplits: (splits: SplitOp[]) => void;
  savedMarks: number[];
  setSavedMarks: (marks: number[]) => void;
  savedUserCuts: UserCut[];
  setSavedUserCuts: (cuts: UserCut[]) => void;
  /** Parsed `guia_ensamble.json` from the last generate ZIP (in-memory). */
  assemblyGuideData: AssemblyPreviewData | null;
  setAssemblyGuideData: (data: AssemblyPreviewData | null) => void;
  resetProject: () => void;
  persistSession: () => Promise<void>;
  applyRestoredState: (restored: RestoredProjectState) => void;
  isLoadingSession: boolean;
}

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [file, setFile] = useState<File | null>(null);
  const [fileId, setFileId] = useState<string | null>(null);
  const [previewObj, setPreviewObj] = useState<string | null>(null);
  const [scale, setScale] = useState(100);
  const [paper, setPaper] = useState("A4");
  const [pdfPageMode, setPdfPageMode] = useState<PdfPageMode>("one_per_sheet");
  const [minAreaM2, setMinAreaM2] = useState(1.0);
  const [phase1Result, setPhase1Result] = useState<Phase1Result | null>(null);
  const [nestingData, setNestingData] = useState<NestingPreviewData | null>(null);
  const [savedOverrides, setSavedOverrides] = useState<ClassificationOverride[]>([]);
  const [savedWallWallDecisions, setSavedWallWallDecisions] = useState<Map<number, number>>(new Map());
  const [savedMerges, setSavedMerges] = useState<number[][]>([]);
  const [savedSplits, setSavedSplits] = useState<SplitOp[]>([]);
  const [savedMarks, setSavedMarks] = useState<number[]>([]);
  const [savedUserCuts, setSavedUserCuts] = useState<UserCut[]>([]);
  const [assemblyGuideData, setAssemblyGuideData] = useState<AssemblyPreviewData | null>(null);
  const [sheetConfig, setSheetConfig] = useState<SheetConfig>({ ...DEFAULT_SHEET });
  const [projectFileName, setProjectFileName] = useState<string | null>(null);
  const [isLoadingSession, setIsLoadingSession] = useState(true);

  // Restore session on mount
  useEffect(() => {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) {
      setIsLoadingSession(false);
      return;
    }

    try {
      const parsed: PersistedSession = JSON.parse(raw);
      
      setProjectFileName(parsed.fileName ?? null);
      setFileId(parsed.fileId);
      setPreviewObj(parsed.previewObj);
      setPhase1Result(parsed.phase1Result ?? null);
      setScale(parsed.scale);
      setPaper(parsed.paper);
      setPdfPageMode(parsed.pageMode ?? "one_per_sheet");
      setMinAreaM2(parsed.minAreaM2);
      setSheetConfig(parsed.sheetConfig);
      setSavedOverrides(parsed.overrides);
      
      const restoredDecisions = new Map<number, number>(parsed.wallWallDecisions ?? []);
      setSavedWallWallDecisions(restoredDecisions);
      
      const restoredMerges = parsed.merges ?? [];
      setSavedMerges(restoredMerges);

      setSavedSplits(parsed.splits ?? []);
      setSavedMarks(parsed.marks ?? []);
      setSavedUserCuts(parsed.userCuts ?? []);

      if (!parsed.phase1Result) {
        sessionStorage.removeItem(SESSION_KEY);
      }
    } catch {
      sessionStorage.removeItem(SESSION_KEY);
    }
    
    setIsLoadingSession(false);
  }, []);

  const persistSession = useCallback(async () => {
    if (!fileId || !phase1Result || !previewObj) return;
    try {
      const name = file?.name || projectFileName || phase1Result.stem || "model.obj";
      setProjectFileName(name);
      const persisted: PersistedSession = {
        fileName: name,
        fileId,
        previewObj,
        phase1Result,
        scale,
        paper,
        minAreaM2,
        sheetConfig,
        pageMode: pdfPageMode,
        overrides: savedOverrides,
        wallWallDecisions: Array.from(savedWallWallDecisions.entries()),
        merges: savedMerges,
        splits: savedSplits,
        marks: savedMarks,
        userCuts: savedUserCuts,
      };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(persisted));
    } catch {
      // Storage full
    }
  }, [file, fileId, previewObj, phase1Result, projectFileName, scale, paper, pdfPageMode, minAreaM2, sheetConfig, savedOverrides, savedWallWallDecisions, savedMerges, savedSplits, savedMarks, savedUserCuts]);

  const applyRestoredState = useCallback((restored: RestoredProjectState) => {
    if (restored.projectFileName != null) setProjectFileName(restored.projectFileName);
    if (restored.minAreaM2 != null) setMinAreaM2(restored.minAreaM2);
    if (restored.savedMerges != null) setSavedMerges(restored.savedMerges);
    if (restored.savedSplits != null) setSavedSplits(restored.savedSplits);
    if (restored.savedOverrides != null) setSavedOverrides(restored.savedOverrides);
    if (restored.savedWallWallDecisions != null) {
      setSavedWallWallDecisions(restored.savedWallWallDecisions);
    }
    if (restored.savedMarks != null) setSavedMarks(restored.savedMarks);
    if (restored.savedUserCuts != null) setSavedUserCuts(restored.savedUserCuts);
    if (restored.scale != null) setScale(restored.scale);
    if (restored.paper != null) setPaper(restored.paper);
    if (restored.pdfPageMode != null) setPdfPageMode(restored.pdfPageMode);
    if (restored.sheetConfig != null) setSheetConfig(restored.sheetConfig);
  }, []);

  const resetProject = useCallback(() => {
    setFile(null);
    setProjectFileName(null);
    setFileId(null);
    setPreviewObj(null);
    setScale(100);
    setPaper("A4");
    setPdfPageMode("one_per_sheet");
    setMinAreaM2(1.0);
    setPhase1Result(null);
    setNestingData(null);
    setSavedOverrides([]);
    setSavedWallWallDecisions(new Map());
    setSavedMerges([]);
    setSavedSplits([]);
    setSavedMarks([]);
    setSavedUserCuts([]);
    setAssemblyGuideData(null);
    setSheetConfig({ ...DEFAULT_SHEET });
    sessionStorage.removeItem(SESSION_KEY);
  }, []);

  return (
    <ProjectContext.Provider
      value={{
        file, setFile,
        projectFileName,
        setProjectFileName,
        fileId, setFileId,
        previewObj, setPreviewObj,
        scale, setScale,
        paper, setPaper,
        pdfPageMode, setPdfPageMode,
        minAreaM2, setMinAreaM2,
        phase1Result, setPhase1Result,
        nestingData, setNestingData,
        sheetConfig, setSheetConfig,
        savedOverrides, setSavedOverrides,
        savedWallWallDecisions, setSavedWallWallDecisions,
        savedMerges, setSavedMerges,
        savedSplits, setSavedSplits,
        savedMarks, setSavedMarks,
        savedUserCuts, setSavedUserCuts,
        assemblyGuideData, setAssemblyGuideData,
        resetProject,
        persistSession,
        applyRestoredState,
        isLoadingSession
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
}

export function useProjectContext() {
  const context = useContext(ProjectContext);
  if (context === undefined) {
    throw new Error("useProjectContext must be used within a ProjectProvider");
  }
  return context;
}
