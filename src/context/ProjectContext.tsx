"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from "react";
import { parsePipeline, decomposePanels, nestDecomposedPanels, applyMerges } from "@/core/pipeline";
import type { Phase1Result, ClassificationOverride, NestingPreviewData } from "@/core/pipeline";
import { DEFAULT_SHEET } from "@/core/sheet-nester";
import type { PipelineOptions, SheetConfig } from "@/core/types";

interface PersistedSession {
  fileName: string;
  fileBase64: string;
  scale: number;
  paper: string;
  minAreaM2: number;
  sheetConfig: SheetConfig;
  overrides: ClassificationOverride[];
  wallWallDecisions: [number, number][];
  merges?: number[][];
}

const SESSION_KEY = "e2d_pending_session";

function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

interface ProjectContextType {
  file: File | null;
  setFile: (file: File | null) => void;
  scale: number;
  setScale: (scale: number) => void;
  paper: string;
  setPaper: (paper: string) => void;
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
  resetProject: () => void;
  persistSession: () => Promise<void>;
  isLoadingSession: boolean;
}

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [file, setFile] = useState<File | null>(null);
  const [scale, setScale] = useState(100);
  const [paper, setPaper] = useState("A4");
  const [minAreaM2, setMinAreaM2] = useState(1.0);
  const [phase1Result, setPhase1Result] = useState<Phase1Result | null>(null);
  const [nestingData, setNestingData] = useState<NestingPreviewData | null>(null);
  const [savedOverrides, setSavedOverrides] = useState<ClassificationOverride[]>([]);
  const [savedWallWallDecisions, setSavedWallWallDecisions] = useState<Map<number, number>>(new Map());
  const [savedMerges, setSavedMerges] = useState<number[][]>([]);
  const [sheetConfig, setSheetConfig] = useState<SheetConfig>({ ...DEFAULT_SHEET });
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
      const buffer = base64ToBuffer(parsed.fileBase64);
      const restoredFile = new File([buffer], parsed.fileName);
      
      setFile(restoredFile);
      setScale(parsed.scale);
      setPaper(parsed.paper);
      setMinAreaM2(parsed.minAreaM2);
      setSheetConfig(parsed.sheetConfig);
      setSavedOverrides(parsed.overrides);
      
      const restoredDecisions = new Map<number, number>(parsed.wallWallDecisions ?? []);
      setSavedWallWallDecisions(restoredDecisions);
      
      const restoredMerges = parsed.merges ?? [];
      setSavedMerges(restoredMerges);

      const p1 = parsePipeline(parsed.fileName, buffer);
      if (p1.faces.length > 0) {
        setPhase1Result(p1);
        
        // If we also had nesting configs, recalculate nesting
        const merged = restoredMerges.length > 0 ? applyMerges(p1, restoredMerges) : p1;
        const opts: PipelineOptions = {
          scaleDenom: parsed.scale,
          paper: parsed.paper,
          includeCuttingSheet: true,
          sheetConfig: parsed.sheetConfig,
          minAreaM2: parsed.minAreaM2,
        };
        const decomposed = decomposePanels(merged, opts, parsed.overrides, restoredDecisions);
        const nesting = nestDecomposedPanels(decomposed, parsed.sheetConfig, parsed.scale);
        setNestingData(nesting);
      } else {
        sessionStorage.removeItem(SESSION_KEY);
      }
    } catch {
      sessionStorage.removeItem(SESSION_KEY);
    }
    
    setIsLoadingSession(false);
  }, []);

  const persistSession = useCallback(async () => {
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      const persisted: PersistedSession = {
        fileName: file.name,
        fileBase64: bufferToBase64(buffer),
        scale,
        paper,
        minAreaM2,
        sheetConfig,
        overrides: savedOverrides,
        wallWallDecisions: Array.from(savedWallWallDecisions.entries()),
        merges: savedMerges,
      };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(persisted));
    } catch {
      // File too large for sessionStorage — silently skip persistence.
    }
  }, [file, scale, paper, minAreaM2, sheetConfig, savedOverrides, savedWallWallDecisions, savedMerges]);

  const resetProject = useCallback(() => {
    setFile(null);
    setScale(100);
    setPaper("A4");
    setMinAreaM2(1.0);
    setPhase1Result(null);
    setNestingData(null);
    setSavedOverrides([]);
    setSavedWallWallDecisions(new Map());
    setSavedMerges([]);
    setSheetConfig({ ...DEFAULT_SHEET });
    sessionStorage.removeItem(SESSION_KEY);
  }, []);

  return (
    <ProjectContext.Provider
      value={{
        file, setFile,
        scale, setScale,
        paper, setPaper,
        minAreaM2, setMinAreaM2,
        phase1Result, setPhase1Result,
        nestingData, setNestingData,
        sheetConfig, setSheetConfig,
        savedOverrides, setSavedOverrides,
        savedWallWallDecisions, setSavedWallWallDecisions,
        savedMerges, setSavedMerges,
        resetProject,
        persistSession,
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
