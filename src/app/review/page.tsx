"use client";

import { Suspense, useEffect, useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useProjectContext } from "@/context/ProjectContext";
import ReviewScreen from "@/components/ReviewScreen";
import type { ClassificationOverride } from "@/core/pipeline";
import type { UserCut } from "@/core/user-cuts";
import {
  recomputeTopology,
  fetchNestingPreview,
  fetchAssemblyPreview,
  userCutsForApi,
  type AssemblyPreviewRequest,
  type RecomputePayload,
  type SplitOperation,
} from "@/services/api";

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

function ReviewPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const openAssemblyInstructivo = searchParams.get("assembly") === "1";
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
    savedSplits,
    setSavedSplits,
    savedMarks,
    setSavedMarks,
    savedUserCuts,
    setSavedUserCuts,
    fileId,
    scale,
    setScale,
    sheetConfig,
    setNestingData,
    isLoadingSession,
    resetProject,
  } = useProjectContext();

  const [isGenerating, setIsGenerating] = useState(false);
  const [isRecomputing, setIsRecomputing] = useState(false);

  useEffect(() => {
    if (!isLoadingSession && !phase1Result) {
      router.replace("/");
    }
  }, [isLoadingSession, phase1Result, router]);

  // Toda edición geométrica (eje, área, fusión, división) re-deriva la
  // topología en el backend, que es la fuente de verdad. El front sólo arma el
  // payload con el estado actual + el cambio puntual.
  const runRecompute = useCallback(
    async (next: Partial<Pick<RecomputePayload, "axis" | "min_area_m2" | "merges" | "splits">>) => {
      if (!fileId || !phase1Result) return;
      const payload: RecomputePayload = {
        file_id: fileId,
        axis: next.axis ?? phase1Result.appliedAxis,
        min_area_m2: next.min_area_m2 ?? minAreaM2,
        merges: next.merges ?? savedMerges,
        splits: next.splits ?? savedSplits.map((s): SplitOperation => ({ group_id: s.groupId, mode: s.mode })),
      };
      setIsRecomputing(true);
      try {
        const updated = await recomputeTopology(payload);
        setPhase1Result(updated);
      } catch (err: unknown) {
        console.error(err);
        alert(
          err instanceof Error
            ? `No se pudo recalcular en el servidor: ${err.message}`
            : "No se pudo recalcular en el servidor.",
        );
      } finally {
        setIsRecomputing(false);
      }
    },
    [fileId, phase1Result, minAreaM2, savedMerges, savedSplits, setPhase1Result],
  );

  const handleRotateAxis = useCallback(() => {
    if (!phase1Result) return;
    const newAxis = phase1Result.appliedAxis === "Y" ? "Z" : "Y";
    setSavedOverrides([]);
    void runRecompute({ axis: newAxis });
  }, [phase1Result, runRecompute, setSavedOverrides]);

  const handleMinAreaChange = useCallback(
    (newArea: number) => {
      setMinAreaM2(newArea);
      setSavedOverrides([]);
      void runRecompute({ min_area_m2: newArea });
    },
    [setMinAreaM2, runRecompute, setSavedOverrides],
  );

  const handleAddMerge = useCallback(
    (cluster: number[]) => {
      const next = [...savedMerges, cluster];
      setSavedMerges(next);
      void runRecompute({ merges: next });
    },
    [savedMerges, setSavedMerges, runRecompute],
  );

  const handleRemoveMerge = useCallback(
    (index: number) => {
      const next = savedMerges.filter((_, i) => i !== index);
      setSavedMerges(next);
      void runRecompute({ merges: next });
    },
    [savedMerges, setSavedMerges, runRecompute],
  );

  const handleReplaceMerges = useCallback(
    (next: number[][]) => {
      setSavedMerges(next);
      void runRecompute({ merges: next });
    },
    [setSavedMerges, runRecompute],
  );

  const handleAddSplit = useCallback(
    (groupId: number, mode: "components" | "panels") => {
      const next = [...savedSplits, { groupId, mode }];
      setSavedSplits(next);
      void runRecompute({ splits: next.map((s): SplitOperation => ({ group_id: s.groupId, mode: s.mode })) });
    },
    [savedSplits, setSavedSplits, runRecompute],
  );

  const handleReviewConfirm = useCallback(
    async (
      overrides: ClassificationOverride[],
      wallWallDecisions: Map<number, number>,
      marks: number[],
      userCuts: UserCut[],
    ) => {
      if (!phase1Result || !fileId) return;

      setSavedOverrides(overrides);
      setSavedWallWallDecisions(wallWallDecisions);
      setSavedMarks(marks);
      setSavedUserCuts(userCuts);
      setIsGenerating(true);

      try {
        const nesting = await fetchNestingPreview({
          file_id: fileId,
          axis: phase1Result.appliedAxis,
          min_area_m2: minAreaM2,
          merges: savedMerges,
          splits: savedSplits.map((s): SplitOperation => ({ group_id: s.groupId, mode: s.mode })),
          overrides: overridesToRecord(overrides),
          wall_wall_decisions: decisionsToRecord(wallWallDecisions),
          marks,
          sheet_config: {
            width_m: sheetConfig.widthM,
            height_m: sheetConfig.heightM,
            gap_m: sheetConfig.gapM,
          },
          scale_denom: scale,
          user_cuts: userCutsForApi(userCuts),
        });
        setNestingData(nesting);
        router.push("/nesting");
      } catch (err: unknown) {
        console.error(err);
        alert(err instanceof Error ? err.message : "Error al previsualizar el nesting.");
        setIsGenerating(false);
      }
    },
    [
      fileId,
      phase1Result,
      minAreaM2,
      savedMerges,
      savedSplits,
      sheetConfig,
      scale,
      setSavedOverrides,
      setSavedWallWallDecisions,
      setSavedMarks,
      setSavedUserCuts,
      setNestingData,
      router,
    ],
  );

  const handleReviewCancel = useCallback(() => {
    resetProject();
    router.replace("/");
  }, [resetProject, router]);

  const handleRequestAssemblyPreview = useCallback(
    async (request: AssemblyPreviewRequest) => {
      if (!phase1Result || !fileId) throw new Error("Proyecto no cargado");
      return fetchAssemblyPreview({
        file_id: fileId,
        axis: phase1Result.appliedAxis,
        min_area_m2: minAreaM2,
        merges: savedMerges,
        splits: savedSplits.map((s): SplitOperation => ({ group_id: s.groupId, mode: s.mode })),
        overrides: overridesToRecord(request.overrides),
        wall_wall_decisions: decisionsToRecord(request.wallWallDecisions),
        marks: request.marks,
        user_cuts: userCutsForApi(request.userCuts),
      });
    },
    [fileId, phase1Result, minAreaM2, savedMerges, savedSplits],
  );

  if (isLoadingSession) return null;
  if (!phase1Result) return null;

  return (
    <ReviewScreen
      phase1={phase1Result}
      merges={savedMerges}
      onConfirm={handleReviewConfirm}
      onCancel={handleReviewCancel}
      onRotateAxis={handleRotateAxis}
      onAddMerge={handleAddMerge}
      onRemoveMerge={handleRemoveMerge}
      onReplaceMerges={handleReplaceMerges}
      onAddSplit={handleAddSplit}
      minAreaM2={minAreaM2}
      onMinAreaChange={handleMinAreaChange}
      initialOverrides={savedOverrides}
      initialWallWallDecisions={savedWallWallDecisions}
      initialMarks={savedMarks}
      initialUserCuts={savedUserCuts}
      isRecomputing={isRecomputing}
      isGenerating={isGenerating}
      onPrintScaleChange={setScale}
      onRequestAssemblyPreview={handleRequestAssemblyPreview}
      openAssemblyInstructivo={openAssemblyInstructivo}
    />
  );
}

export default function ReviewPage() {
  return (
    <Suspense fallback={null}>
      <ReviewPageContent />
    </Suspense>
  );
}
