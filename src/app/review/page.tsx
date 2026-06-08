"use client";

import { useEffect, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useProjectContext } from "@/context/ProjectContext";
import ReviewScreen from "@/components/ReviewScreen";
import { reclassifyWithMinArea } from "@/core/pipeline";
import type { ClassificationOverride } from "@/core/pipeline";

export default function ReviewPage() {
  const router = useRouter();
  const { 
    phase1Result, 
    setPhase1Result,
    minAreaM2, 
    setMinAreaM2,
    savedOverrides, 
    setSavedOverrides,
    savedWallWallDecisions, 
    setSavedWallWallDecisions,
    savedMerges, 
    setSavedMerges,
    fileId,
    scale,
    paper,
    sheetConfig,
    isLoadingSession,
    resetProject
  } = useProjectContext();

  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    if (!isLoadingSession && !phase1Result) {
      router.replace("/");
    }
  }, [isLoadingSession, phase1Result, router]);

  const handleReviewConfirm = useCallback(async (
    overrides: ClassificationOverride[],
    wallWallDecisions: Map<number, number>,
    merges: number[][]
  ) => {
    if (!phase1Result || !fileId) return;

    setSavedOverrides(overrides);
    setSavedWallWallDecisions(wallWallDecisions);
    setSavedMerges(merges);
    setIsGenerating(true);

    try {
      // Just save state and move to payment. Generation happens after payment.
      router.push("/payment");
    } catch (err: unknown) {
      console.error(err);
      alert(err instanceof Error ? err.message : "Error desconocido al procesar.");
      setIsGenerating(false);
    }
  }, [phase1Result, fileId, setSavedOverrides, setSavedWallWallDecisions, setSavedMerges, router]);

  const handleReviewCancel = useCallback(() => {
    resetProject();
    router.replace("/");
  }, [resetProject, router]);

  const handleMinAreaChange = useCallback((newArea: number) => {
    setMinAreaM2(newArea);
    setPhase1Result(phase1Result ? reclassifyWithMinArea(phase1Result, newArea) : null);
  }, [setMinAreaM2, setPhase1Result, phase1Result]);

  if (isLoadingSession) return null;
  if (!phase1Result) return null;

  return (
    <ReviewScreen
      phase1={phase1Result}
      onConfirm={handleReviewConfirm}
      onCancel={handleReviewCancel}
      onAxisChange={setPhase1Result}
      minAreaM2={minAreaM2}
      onMinAreaChange={handleMinAreaChange}
      initialOverrides={savedOverrides}
      initialWallWallDecisions={savedWallWallDecisions}
      initialMerges={savedMerges}
      isGenerating={isGenerating}
    />
  );
}
