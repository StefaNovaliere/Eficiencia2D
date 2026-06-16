"use client";

import { useEffect, useCallback, useState } from "react";
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
    savedMarks,
    savedUserCuts,
    persistSession,
    isLoadingSession
  } = useProjectContext();

  const [isRecomputing, setIsRecomputing] = useState(false);

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

  // Recalcula el nesting fuera del frame actual para que el overlay
  // "Recalculando planchas…" alcance a pintarse antes del cálculo pesado.
  const recompute = useCallback(
    (newScale: number, newConfig: SheetConfig) => {
      if (!phase1Result) return;
      setIsRecomputing(true);
      setTimeout(() => {
        const merged = savedMerges.length > 0 ? applyMerges(phase1Result, savedMerges) : phase1Result;
        const opts: PipelineOptions = {
          scaleDenom: newScale,
          paper,
          includeCuttingSheet: true,
          sheetConfig: newConfig,
          minAreaM2,
        };
        const decomposed = decomposePanels(
          merged,
          opts,
          savedOverrides,
          savedWallWallDecisions,
          new Set(savedMarks),
          savedUserCuts,
        );
        const nesting = nestDecomposedPanels(decomposed, newConfig, newScale);
        setNestingData(nesting);
        setIsRecomputing(false);
      }, 30);
    },
    [phase1Result, savedOverrides, savedWallWallDecisions, savedMerges, savedMarks, savedUserCuts, paper, minAreaM2, setNestingData],
  );

  const handleSheetConfigChange = useCallback((newConfig: SheetConfig) => {
    setSheetConfig(newConfig);
    recompute(scale, newConfig);
  }, [recompute, scale, setSheetConfig]);

  const handleScaleChange = useCallback((newScale: number) => {
    setScale(newScale);
    recompute(newScale, sheetConfig);
  }, [recompute, sheetConfig, setScale]);

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
      isRecomputing={isRecomputing}
    />
  );
}
