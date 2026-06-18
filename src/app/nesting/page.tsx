"use client";

import { useEffect, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useProjectContext } from "@/context/ProjectContext";
import NestingPreview from "@/components/NestingPreview";
import { fetchNestingPreview, type SplitOperation } from "@/services/api";
import type { SheetConfig } from "@/core/types";

function overridesToRecord(
  overrides: { groupId: number; newCategory: string }[],
): Record<number, string> {
  const out: Record<number, string> = {};
  for (const o of overrides) out[o.groupId] = o.newCategory;
  return out;
}

function decisionsToRecord(decisions: Map<number, number>): Record<number, number> {
  const out: Record<number, number> = {};
  for (const [k, v] of decisions) out[k] = v;
  return out;
}

export default function NestingPage() {
  const router = useRouter();
  const {
    nestingData,
    setNestingData,
    phase1Result,
    scale,
    setScale,
    minAreaM2,
    sheetConfig,
    setSheetConfig,
    savedOverrides,
    savedWallWallDecisions,
    savedMerges,
    savedSplits,
    savedMarks,
    fileId,
    persistSession,
    isLoadingSession,
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

  // El nesting lo calcula el backend; el front sólo le pide el layout con la
  // nueva escala / configuración de plancha.
  const recompute = useCallback(
    async (newScale: number, newConfig: SheetConfig) => {
      if (!phase1Result || !fileId) return;
      setIsRecomputing(true);
      try {
        const nesting = await fetchNestingPreview({
          file_id: fileId,
          axis: phase1Result.appliedAxis,
          min_area_m2: minAreaM2,
          merges: savedMerges,
          splits: savedSplits.map((s): SplitOperation => ({ group_id: s.groupId, mode: s.mode })),
          overrides: overridesToRecord(savedOverrides),
          wall_wall_decisions: decisionsToRecord(savedWallWallDecisions),
          marks: savedMarks,
          sheet_config: {
            width_m: newConfig.widthM,
            height_m: newConfig.heightM,
            gap_m: newConfig.gapM,
          },
          scale_denom: newScale,
        });
        setNestingData(nesting);
      } catch (err: unknown) {
        console.error(err);
        alert(err instanceof Error ? err.message : "No se pudo recalcular el nesting.");
      } finally {
        setIsRecomputing(false);
      }
    },
    [phase1Result, fileId, minAreaM2, savedMerges, savedSplits, savedOverrides, savedWallWallDecisions, savedMarks, setNestingData],
  );

  const handleSheetConfigChange = useCallback((newConfig: SheetConfig) => {
    setSheetConfig(newConfig);
    void recompute(scale, newConfig);
  }, [recompute, scale, setSheetConfig]);

  const handleScaleChange = useCallback((newScale: number) => {
    setScale(newScale);
    void recompute(newScale, sheetConfig);
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
