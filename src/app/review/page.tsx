"use client";

import { Suspense, useEffect, useCallback, useState, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useProjectContext } from "@/context/ProjectContext";
import { useAuth } from "@/context/AuthContext";
import ReviewScreen from "@/components/ReviewScreen";
import type { ClassificationOverride } from "@/core/pipeline";
import type { UserCut } from "@/core/user-cuts";
import {
  recomputeTopology,
  fetchNestingPreview,
  userCutsForApi,
  flexForApi,
  resolveOriginalFilename,
  type AssemblyPreviewRequest,
  type RecomputePayload,
  type SplitOperation,
} from "@/services/api";
import { buildAssemblyGuideFromTopology } from "@/core/assembly-guide-build";
import type { FaceCategory } from "@/core/group-classifier";
import { useProjectStateAutosave } from "@/hooks/useProjectStateAutosave";
import { buildReviewEditingPatch } from "@/services/project-state";

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
  const { token } = useAuth();
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
    savedFlex,
    fileId,
    projectFileName,
    scale,
    setScale,
    sheetConfig,
    paper,
    pdfPageMode,
    setNestingData,
    isLoadingSession,
    resetProject,
  } = useProjectContext();

  const [isGenerating, setIsGenerating] = useState(false);
  const [isRecomputing, setIsRecomputing] = useState(false);

  const { queuePatch } = useProjectStateAutosave({
    token,
    projectId: fileId,
    enabled: Boolean(token && fileId),
  });

  const saveGeometryState = useCallback(
    (patch: Partial<Pick<RecomputePayload, "axis" | "min_area_m2" | "merges" | "splits">>) => {
      if (!token || !fileId) return;
      queuePatch({
        ...(patch.axis != null ? { axis: patch.axis } : {}),
        ...(patch.min_area_m2 != null ? { min_area_m2: patch.min_area_m2 } : {}),
        ...(patch.merges != null ? { merges: patch.merges } : {}),
        ...(patch.splits != null ? { splits: patch.splits } : {}),
      });
    },
    [token, fileId, queuePatch],
  );

  const skipInitialEditingAutosave = useRef(true);

  const handleEditingStateChange = useCallback(
    (snapshot: Parameters<typeof buildReviewEditingPatch>[0]) => {
      if (skipInitialEditingAutosave.current) {
        skipInitialEditingAutosave.current = false;
        return;
      }
      const patch = buildReviewEditingPatch(snapshot);
      if (Object.keys(patch).length > 0) {
        queuePatch(patch);
      }
    },
    [queuePatch],
  );

  useEffect(() => {
    if (!isLoadingSession && !phase1Result) {
      router.replace("/home");
    }
  }, [isLoadingSession, phase1Result, router]);

  // Toda edición geométrica (eje, área, fusión, división) re-deriva la
  // topología en el backend, que es la fuente de verdad. El front sólo arma el
  // payload con el estado actual + el cambio puntual.
  const runRecompute = useCallback(
    async (next: Partial<Pick<RecomputePayload, "axis" | "min_area_m2" | "merges" | "splits">>) => {
      if (!fileId || !phase1Result) return;
      const originalFilename = resolveOriginalFilename(projectFileName, phase1Result.stem);
      const payload: RecomputePayload = {
        file_id: fileId,
        original_filename: originalFilename,
        axis: next.axis ?? phase1Result.appliedAxis,
        min_area_m2: next.min_area_m2 ?? minAreaM2,
        merges: next.merges ?? savedMerges,
        splits: next.splits ?? savedSplits.map((s): SplitOperation => ({ group_id: s.groupId, mode: s.mode })),
      };
      setIsRecomputing(true);
      try {
        const updated = await recomputeTopology(payload, token);
        setPhase1Result(updated);
        saveGeometryState({
          axis: payload.axis,
          min_area_m2: payload.min_area_m2,
          merges: payload.merges,
          splits: payload.splits,
        });
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
    [fileId, projectFileName, phase1Result, minAreaM2, savedMerges, savedSplits, setPhase1Result, token, saveGeometryState],
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
        const originalFilename = resolveOriginalFilename(projectFileName, phase1Result.stem);
        const nesting = await fetchNestingPreview({
          file_id: fileId,
          original_filename: originalFilename,
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
          paper,
          page_mode: pdfPageMode,
          user_cuts: userCutsForApi(userCuts),
          flex: flexForApi(savedFlex),
        }, token);
        setNestingData(nesting);
        if (token && fileId) {
          queuePatch({
            overrides: Object.fromEntries(
              overrides.map((o) => [String(o.groupId), o.newCategory]),
            ),
            wall_wall_decisions: decisionsToRecord(wallWallDecisions),
            marks,
            user_cuts: userCutsForApi(userCuts),
            scale_denom: scale,
            sheet_config: {
              width_m: sheetConfig.widthM,
              height_m: sheetConfig.heightM,
              gap_m: sheetConfig.gapM,
            },
            paper,
            page_mode: pdfPageMode,
          });
        }
        router.push("/nesting");
      } catch (err: unknown) {
        console.error(err);
        alert(err instanceof Error ? err.message : "Error al previsualizar el nesting.");
        setIsGenerating(false);
      }
    },
    [
      fileId,
      projectFileName,
      phase1Result,
      minAreaM2,
      savedMerges,
      savedSplits,
      savedFlex,
      sheetConfig,
      scale,
      paper,
      pdfPageMode,
      setSavedOverrides,
      setSavedWallWallDecisions,
      setSavedMarks,
      setSavedUserCuts,
      setNestingData,
      router,
      token,
      queuePatch,
    ],
  );

  const handleReviewCancel = useCallback(() => {
    resetProject();
    router.replace("/home");
  }, [resetProject, router]);

  // El instructivo se construye en el FRONT desde la topología (el backend no
  // tiene endpoint de preview; sólo genera la guía dentro del ZIP). La geometría
  // 3D la resuelve el lift: piezas de corte (#2) con placements+nesting, o la
  // geometría original por grupo (#1) como fallback.
  const handleRequestAssemblyPreview = useCallback(
    async (request: AssemblyPreviewRequest) => {
      if (!phase1Result) throw new Error("Proyecto no cargado");
      const overridesMap = new Map<number, FaceCategory>();
      for (const o of request.overrides) {
        overridesMap.set(o.groupId, o.newCategory as FaceCategory);
      }
      return buildAssemblyGuideFromTopology(phase1Result, { overrides: overridesMap });
    },
    [phase1Result],
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
      onPrintScaleChange={(nextScale) => {
        setScale(nextScale);
        if (token && fileId) queuePatch({ scale_denom: nextScale });
      }}
      onEditingStateChange={handleEditingStateChange}
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
