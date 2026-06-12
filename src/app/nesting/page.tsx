"use client";

import { useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useProjectContext } from "@/context/ProjectContext";
import NestingPreview from "@/components/NestingPreview";
import { decomposePanels, nestDecomposedPanels, applyMerges } from "@/core/pipeline";
import type { PipelineOptions, SheetConfig } from "@/core/types";

export default function NestingPage() {
  const router = useRouter();
  const { 
    nestingData, 
    setNestingData,
    phase1Result,
    scale,
    setScale,
    paper,
    minAreaM2,
    sheetConfig,
    setSheetConfig,
    savedOverrides,
    savedWallWallDecisions,
    savedMerges,
    persistSession,
    isLoadingSession
  } = useProjectContext();

  useEffect(() => {
    if (!isLoadingSession && !nestingData) {
      router.replace(phase1Result ? "/review" : "/");
    }
  }, [isLoadingSession, nestingData, phase1Result, router]);

  const handleNestingConfirm = useCallback(async () => {
    await persistSession();
    router.push("/payment");
  }, [persistSession, router]);

  const handleNestingBack = useCallback(() => {
    setNestingData(null);
    router.push("/review");
  }, [setNestingData, router]);

  const handleSheetConfigChange = useCallback((newConfig: SheetConfig) => {
    setSheetConfig(newConfig);
    if (!phase1Result) return;

    const merged = savedMerges.length > 0 ? applyMerges(phase1Result, savedMerges) : phase1Result;
    const opts: PipelineOptions = {
      scaleDenom: scale,
      paper,
      includeCuttingSheet: true,
      sheetConfig: newConfig,
      minAreaM2,
    };
    const decomposed = decomposePanels(merged, opts, savedOverrides, savedWallWallDecisions);
    const nesting = nestDecomposedPanels(decomposed, newConfig, scale);
    setNestingData(nesting);
  }, [phase1Result, savedOverrides, savedWallWallDecisions, savedMerges, scale, paper, minAreaM2, setSheetConfig, setNestingData]);

  const handleScaleChange = useCallback((newScale: number) => {
    setScale(newScale);
    if (!phase1Result) return;

    const merged = savedMerges.length > 0 ? applyMerges(phase1Result, savedMerges) : phase1Result;
    const opts: PipelineOptions = {
      scaleDenom: newScale,
      paper,
      includeCuttingSheet: true,
      sheetConfig,
      minAreaM2,
    };
    const decomposed = decomposePanels(merged, opts, savedOverrides, savedWallWallDecisions);
    const nesting = nestDecomposedPanels(decomposed, sheetConfig, newScale);
    setNestingData(nesting);
  }, [phase1Result, savedOverrides, savedWallWallDecisions, savedMerges, paper, sheetConfig, minAreaM2, setScale, setNestingData]);

  if (isLoadingSession) return null;
  if (!nestingData) return null;

  return (
    <NestingPreview
      nesting={nestingData}
      onConfirm={handleNestingConfirm}
      onBack={handleNestingBack}
      sheetConfig={sheetConfig}
      onSheetConfigChange={handleSheetConfigChange}
      scaleDenom={scale}
      onScaleChange={handleScaleChange}
    />
  );
}
