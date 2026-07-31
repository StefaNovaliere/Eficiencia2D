"use client";

import { Suspense, useEffect, useCallback, useState, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useProjectContext } from "@/context/ProjectContext";
import { useAuth } from "@/context/AuthContext";
import ReviewScreen from "@/components/ReviewScreen";
import type { ClassificationOverride } from "@/core/pipeline";
import type { UserCut } from "@/core/user-cuts";
import type { GroupNote } from "@/core/group-notes";
import {
  recomputeTopology,
  fetchNestingPreview,
  userCutsForApi,
  groupNotesForApi,
  flexForApi,
  markLinesForApi,
  ribsForApi,
  columnsForApi,
  resolveOriginalFilename,
  overridesToRecord,
  buildRecomputePayload,
  categorySignature,
  type AssemblyPreviewRequest,
  type RecomputePayload,
  type SplitOperation,
} from "@/services/api";
import { buildAssemblyGuideFromTopology } from "@/core/assembly-guide-build";
import type { FaceCategory } from "@/core/group-classifier";
import { useProjectStateAutosave } from "@/hooks/useProjectStateAutosave";
import { buildReviewEditingPatch } from "@/services/project-state";
import { useSettings } from "@/context/SettingsContext";

function decisionsToRecord(decisions: Map<number, number>): Record<number, number> {
  const out: Record<number, number> = {};
  for (const [k, v] of decisions) out[k] = v;
  return out;
}

function ReviewPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { token } = useAuth();
  const { settings, updateSettings, isLoadingSettings } = useSettings();
  const openAssemblyInstructivo = searchParams.get("assembly") === "1";
  const {
    phase1Result,
    setPhase1Result,
    minAreaM2,
    setMinAreaM2,
    pinTools,
    setPinTools,
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
    savedNotes,
    setSavedNotes,
    savedFlex,
    savedMarkLines,
    setSavedMarkLines,
    savedRibs,
    savedColumns,
    fileId,
    projectFileName,
    scale,
    setScale,
    sheetConfig,
    paper,
    pdfPageMode,
    combineSheets,
    setNestingData,
    isLoadingSession,
    resetProject,
  } = useProjectContext();

  const [isGenerating, setIsGenerating] = useState(false);
  const [isRecomputing, setIsRecomputing] = useState(false);
  const [isSavingOnExit, setIsSavingOnExit] = useState(false);
  /** Evita pisar un cambio local con la hidratación tardía de settings. */
  const pinToolsHydratedRef = useRef(false);

  const { queuePatch, flushPatch, hasPendingChanges } = useProjectStateAutosave({
    token,
    projectId: fileId,
    enabled: Boolean(token && fileId),
  });

  // Preferencia de cuenta: fijar_herramientas vive en /api/settings/me.
  useEffect(() => {
    if (isLoadingSettings || pinToolsHydratedRef.current) return;
    if (!token) {
      pinToolsHydratedRef.current = true;
      return;
    }
    if (!settings) return;

    const raw = settings.preferencias_interfaz?.fijar_herramientas;
    if (typeof raw === "boolean") setPinTools(raw);
    pinToolsHydratedRef.current = true;
  }, [token, settings, isLoadingSettings, setPinTools]);

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

  const lastEditingPatchKey = useRef<string | null>(null);

  const handleEditingStateChange = useCallback(
    (snapshot: Parameters<typeof buildReviewEditingPatch>[0]) => {
      // Mantener el contexto al día (también al borrar).
      setSavedOverrides(snapshot.overrides);
      setSavedWallWallDecisions(snapshot.wallWallDecisions);
      setSavedMarks(snapshot.marks);
      setSavedUserCuts(snapshot.userCuts);
      setSavedNotes(snapshot.notes);
      setSavedMarkLines(snapshot.markLines);

      const fullPatch = buildReviewEditingPatch(snapshot);
      const patchKey = JSON.stringify(fullPatch);
      if (lastEditingPatchKey.current === patchKey) return;
      lastEditingPatchKey.current = patchKey;

      // Autosave periódico (debounce): útil si se corta la luz / se cierra la pestaña.
      queuePatch(fullPatch);
    },
    [
      queuePatch,
      setSavedOverrides,
      setSavedWallWallDecisions,
      setSavedMarks,
      setSavedUserCuts,
      setSavedNotes,
      setSavedMarkLines,
    ],
  );

  useEffect(() => {
    if (!isLoadingSession && !phase1Result) {
      router.replace("/home");
    }
  }, [isLoadingSession, phase1Result, router]);

  // Categorías que reflejan las etiquetas que tenemos ahora mismo. `null` hasta
  // la primera pasada, donde la topología recién cargada ya está al día.
  const labeledSignature = useRef<string | null>(null);
  // Descarta respuestas viejas: si el usuario sigue recategorizando mientras
  // vuelve un refresco, gana el último pedido.
  const labelRefreshSeq = useRef(0);

  // Toda edición geométrica (eje, área, fusión, división) re-deriva la
  // topología en el backend, que es la fuente de verdad. El front sólo arma el
  // payload con el estado actual + el cambio puntual.
  const runRecompute = useCallback(
    async (
      next: Partial<
        Pick<RecomputePayload, "axis" | "min_area_m2" | "merges" | "splits" | "overrides">
      >,
    ) => {
      if (!fileId || !phase1Result) return;
      const payload = buildRecomputePayload(
        {
          fileId,
          originalFilename: resolveOriginalFilename(projectFileName, phase1Result.stem),
          axis: phase1Result.appliedAxis,
          minAreaM2,
          merges: savedMerges,
          splits: savedSplits.map((s): SplitOperation => ({ group_id: s.groupId, mode: s.mode })),
          // Sin esto el backend arma el instructivo con la clasificación
          // automática y las recategorizaciones no se reflejan.
          overrides: overridesToRecord(savedOverrides),
        },
        next,
      );
      setIsRecomputing(true);
      try {
        const updated = await recomputeTopology(payload, token);
        // La topología vuelve con las etiquetas ya numeradas para estos overrides.
        labeledSignature.current = categorySignature(payload.overrides ?? {});
        labelRefreshSeq.current += 1; // invalida cualquier refresco en vuelo
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
    [fileId, projectFileName, phase1Result, minAreaM2, savedMerges, savedSplits, savedOverrides, setPhase1Result, token, saveGeometryState],
  );

  /**
   * Las etiquetas de pieza (A1/B2…) las numera el backend sobre los grupos NO
   * descartados. Recategorizar no dispara ningún recompute, así que la lista de
   * componentes y el visor se quedaban con la numeración vieja mientras la
   * plancha de corte salía con la nueva: los mismos paneles con dos nombres.
   *
   * Se refrescan pidiéndoselas al backend (nunca replicando su numeración acá),
   * con un respiro para no mandar un pedido por clic, y aplicando SÓLO las
   * etiquetas: la geometría no cambió y reemplazar la topología entera
   * reconstruiría la escena 3D al pedo.
   */
  useEffect(() => {
    if (!fileId || !phase1Result) return;

    const signature = categorySignature(overridesToRecord(savedOverrides));
    if (labeledSignature.current === null) {
      labeledSignature.current = signature; // la topología cargada ya está al día
      return;
    }
    if (labeledSignature.current === signature) return;

    const timer = setTimeout(() => {
      const seq = ++labelRefreshSeq.current;
      const payload = buildRecomputePayload({
        fileId,
        originalFilename: resolveOriginalFilename(projectFileName, phase1Result.stem),
        axis: phase1Result.appliedAxis,
        minAreaM2,
        merges: savedMerges,
        splits: savedSplits.map((s): SplitOperation => ({ group_id: s.groupId, mode: s.mode })),
        overrides: overridesToRecord(savedOverrides),
      });

      void recomputeTopology(payload, token)
        .then((updated) => {
          if (seq !== labelRefreshSeq.current) return; // quedó vieja
          labeledSignature.current = signature;
          setPhase1Result({ ...phase1Result, panelIdByGroup: updated.panelIdByGroup });
        })
        .catch((err: unknown) => {
          // Sin etiquetas nuevas se siguen viendo las anteriores: molesto, pero
          // no rompe la revisión. Se reintenta al próximo cambio de categoría.
          console.error("No se pudieron actualizar las etiquetas de pieza", err);
        });
    }, 700);

    return () => clearTimeout(timer);
  }, [
    savedOverrides,
    fileId,
    phase1Result,
    projectFileName,
    minAreaM2,
    savedMerges,
    savedSplits,
    token,
    setPhase1Result,
  ]);

  const handleRotateAxis = useCallback(() => {
    if (!phase1Result) return;
    const newAxis = phase1Result.appliedAxis === "Y" ? "Z" : "Y";
    setSavedOverrides([]);
    // `savedOverrides` sigue teniendo el valor viejo en este render (setState es
    // asincrónico): hay que mandar el vacío explícito, no dejar que lo resuelva
    // el default de runRecompute.
    void runRecompute({ axis: newAxis, overrides: {} });
  }, [phase1Result, runRecompute, setSavedOverrides]);

  const handleMinAreaChange = useCallback(
    (newArea: number) => {
      setMinAreaM2(newArea);
      setSavedOverrides([]);
      void runRecompute({ min_area_m2: newArea, overrides: {} });
    },
    [setMinAreaM2, runRecompute, setSavedOverrides],
  );

  const handlePinToolsChange = useCallback(
    (pin: boolean) => {
      setPinTools(pin);
      pinToolsHydratedRef.current = true;

      // Preferencia de usuario (configuración de cuenta).
      if (token) {
        void updateSettings({
          preferencias_interfaz: {
            ...(settings?.preferencias_interfaz ?? {}),
            fijar_herramientas: pin,
          },
        }).catch(() => {
          /* El toggle ya reflejó el cambio local. */
        });
      }

      // También al estado del proyecto, por si el backend lo usa en estado.json.
      if (token && fileId) queuePatch({ pin_tools: pin });
    },
    [setPinTools, token, fileId, queuePatch, updateSettings, settings?.preferencias_interfaz],
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
      notes: GroupNote[],
    ) => {
      if (!phase1Result || !fileId) return;

      setSavedOverrides(overrides);
      setSavedWallWallDecisions(wallWallDecisions);
      setSavedMarks(marks);
      setSavedUserCuts(userCuts);
      setSavedNotes(notes);
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
          combine_sheets: combineSheets,
          user_cuts: userCutsForApi(userCuts),
          flex: flexForApi(savedFlex),
          mark_lines: markLinesForApi(savedMarkLines),
          ribs: ribsForApi(savedRibs),
          columns: columnsForApi(savedColumns),
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
            notes: groupNotesForApi(notes),
            mark_lines: markLinesForApi(savedMarkLines),
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
      savedMarkLines,
      savedRibs,
      savedColumns,
      sheetConfig,
      scale,
      paper,
      pdfPageMode,
      combineSheets,
      setSavedOverrides,
      setSavedWallWallDecisions,
      setSavedMarks,
      setSavedUserCuts,
      setSavedNotes,
      setNestingData,
      router,
      token,
      queuePatch,
    ],
  );

  const handleReviewCancel = useCallback(
    async (snapshot: Parameters<typeof buildReviewEditingPatch>[0]) => {
      if (isSavingOnExit) return;
      setIsSavingOnExit(true);

      // Sincronizar contexto + encolar el snapshot actual (incluye borrados).
      setSavedOverrides(snapshot.overrides);
      setSavedWallWallDecisions(snapshot.wallWallDecisions);
      setSavedMarks(snapshot.marks);
      setSavedUserCuts(snapshot.userCuts);
      setSavedNotes(snapshot.notes);
      setSavedMarkLines(snapshot.markLines);

      const patch = buildReviewEditingPatch(snapshot);
      lastEditingPatchKey.current = JSON.stringify(patch);
      queuePatch(patch);

      try {
        // Si hay cambios encolados (o un PATCH en curso), esperar a que terminen.
        if (hasPendingChanges()) {
          await flushPatch();
        }
        resetProject();
        router.replace("/home");
      } catch (err) {
        console.error(err);
        alert(
          err instanceof Error
            ? `No se pudieron guardar los cambios: ${err.message}`
            : "No se pudieron guardar los cambios. Revisá la conexión e intentá de nuevo.",
        );
      } finally {
        setIsSavingOnExit(false);
      }
    },
    [
      isSavingOnExit,
      hasPendingChanges,
      queuePatch,
      flushPatch,
      resetProject,
      router,
      setSavedOverrides,
      setSavedWallWallDecisions,
      setSavedMarks,
      setSavedUserCuts,
      setSavedNotes,
      setSavedMarkLines,
    ],
  );

  // El instructivo usa la misma geometría que nesting/impresión: al abrirlo
  // refrescamos `/api/nesting-preview` con las wall_wall_decisions actuales
  // (quién cede / quién manda) y después lifteamos esos contornos a 3D.
  const handleRequestAssemblyPreview = useCallback(
    async (request: AssemblyPreviewRequest) => {
      if (!phase1Result) throw new Error("Proyecto no cargado");
      const overridesMap = new Map<number, FaceCategory>();
      for (const o of request.overrides) {
        overridesMap.set(o.groupId, o.newCategory as FaceCategory);
      }

      if (fileId) {
        try {
          const originalFilename = resolveOriginalFilename(
            projectFileName,
            phase1Result.stem,
          );
          const nesting = await fetchNestingPreview(
            {
              file_id: fileId,
              original_filename: originalFilename,
              axis: phase1Result.appliedAxis,
              min_area_m2: minAreaM2,
              merges: savedMerges,
              splits: savedSplits.map(
                (s): SplitOperation => ({ group_id: s.groupId, mode: s.mode }),
              ),
              overrides: overridesToRecord(request.overrides),
              wall_wall_decisions: decisionsToRecord(request.wallWallDecisions),
              marks: request.marks,
              sheet_config: {
                width_m: sheetConfig.widthM,
                height_m: sheetConfig.heightM,
                gap_m: sheetConfig.gapM,
              },
              scale_denom: scale,
              paper,
              page_mode: pdfPageMode,
              user_cuts: userCutsForApi(request.userCuts),
              flex: flexForApi(savedFlex),
              mark_lines: markLinesForApi(savedMarkLines),
              ribs: ribsForApi(savedRibs),
              columns: columnsForApi(savedColumns),
            },
            token,
          );
          setNestingData(nesting);
          // El área de material del nesting (contorno menos aberturas) en vez
          // de la suma de caras de la malla, que cuenta las dos pieles de un
          // sólido y hacía ver piezas parecidas con m² muy distintos.
          const areaByGroupId = new Map<number, number>();
          for (const [groupId, pl] of nesting.nestingPlacements ?? []) {
            if (pl.areaM2 > 0) areaByGroupId.set(groupId, pl.areaM2);
          }
          if (areaByGroupId.size > 0) {
            return buildAssemblyGuideFromTopology(phase1Result, {
              overrides: overridesMap,
              areaByGroupId,
            });
          }
        } catch (err) {
          console.warn(
            "[instructivo] no se pudo refrescar nesting-preview; se usa geometría de fallback.",
            err,
          );
        }
      }

      return buildAssemblyGuideFromTopology(phase1Result, { overrides: overridesMap });
    },
    [
      phase1Result,
      fileId,
      projectFileName,
      minAreaM2,
      savedMerges,
      savedSplits,
      savedFlex,
      savedMarkLines,
      savedRibs,
      savedColumns,
      sheetConfig,
      scale,
      paper,
      pdfPageMode,
      setNestingData,
      token,
    ],
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
      pinTools={pinTools}
      onPinToolsChange={handlePinToolsChange}
      initialOverrides={savedOverrides}
      initialWallWallDecisions={savedWallWallDecisions}
      initialMarks={savedMarks}
      initialUserCuts={savedUserCuts}
      initialNotes={savedNotes}
      isRecomputing={isRecomputing}
      isGenerating={isGenerating}
      isSavingOnExit={isSavingOnExit}
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
