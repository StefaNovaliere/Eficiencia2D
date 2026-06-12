"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useProjectContext } from "@/context/ProjectContext";
import PaymentScreen from "@/components/PaymentScreen";
import {
  decomposePanels,
  nestDecomposedPanels,
  generateFromNesting,
  applyMerges,
} from "@/core/pipeline";
import type { PipelineOptions } from "@/core/types";
import type { Phase1Result, ClassificationOverride } from "@/core/pipeline";
import {
  base64ToBlob,
  generateProjectFiles,
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

async function generateClientSideZip(
  phase1Result: Phase1Result,
  opts: PipelineOptions,
  savedOverrides: ClassificationOverride[],
  savedWallWallDecisions: Map<number, number>,
  savedMerges: number[][],
): Promise<Blob> {
  const merged =
    savedMerges.length > 0
      ? applyMerges(phase1Result, savedMerges)
      : phase1Result;
  const decomposed = decomposePanels(
    merged,
    opts,
    savedOverrides,
    savedWallWallDecisions,
  );
  const nesting = nestDecomposedPanels(
    decomposed,
    opts.sheetConfig!,
    opts.scaleDenom,
  );
  const result = generateFromNesting(merged, nesting, opts);

  if (result.files.length === 0) {
    throw new Error(
      result.warnings.length > 0
        ? result.warnings.join(" ")
        : "No se generaron archivos. Verificá que el modelo tenga geometría válida.",
    );
  }

  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  for (const f of result.files) zip.file(f.name, f.blob);
  return zip.generateAsync({ type: "blob" });
}

export default function PaymentPage() {
  const router = useRouter();
  const {
    file,
    fileId,
    projectFileName,
    phase1Result,
    savedOverrides,
    savedWallWallDecisions,
    savedMerges,
    scale,
    paper,
    minAreaM2,
    sheetConfig,
    isLoadingSession,
    resetProject,
  } = useProjectContext();

  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isLoadingSession && !phase1Result) {
      router.replace("/");
    }
  }, [isLoadingSession, phase1Result, router]);

  const proceedToGeneration = useCallback(async () => {
    if (!phase1Result || !fileId) return;

    setIsGenerating(true);
    setError("");

    const opts: PipelineOptions = {
      scaleDenom: scale,
      paper,
      includeCuttingSheet: true,
      sheetConfig,
      minAreaM2,
    };

    const stem =
      file?.name.replace(/\.[^.]+$/, "") ??
      projectFileName?.replace(/\.[^.]+$/, "") ??
      phase1Result.stem;

    try {
      const backendRes = await generateProjectFiles({
        file_id: fileId,
        original_filename: file?.name ?? projectFileName ?? "model.obj",
        scale_denom: scale,
        paper,
        min_area_m2: minAreaM2,
        sheet_config: {
          width_m: sheetConfig.widthM,
          height_m: sheetConfig.heightM,
          gap_m: sheetConfig.gapM,
        },
        overrides: overridesToRecord(savedOverrides),
        wall_wall_decisions: decisionsToRecord(savedWallWallDecisions),
        merges: savedMerges,
      });

      let zipBlob: Blob;
      if (backendRes.zip_base64) {
        zipBlob = base64ToBlob(backendRes.zip_base64);
      } else {
        throw new Error("El backend no devolvió el archivo ZIP.");
      }

      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = backendRes.zip_filename ?? `${stem}_planos.zip`;
      a.click();
      URL.revokeObjectURL(url);

      resetProject();
      alert("¡Planos generados y descargados exitosamente!");
      router.push("/");
    } catch (backendErr) {
      console.warn("Generación en backend falló, usando cliente:", backendErr);
      try {
        const zipBlob = await generateClientSideZip(
          phase1Result,
          opts,
          savedOverrides,
          savedWallWallDecisions,
          savedMerges,
        );
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${stem}_planos.zip`;
        a.click();
        URL.revokeObjectURL(url);

        resetProject();
        alert("¡Planos generados (modo local) y descargados!");
        router.push("/");
      } catch (clientErr: unknown) {
        console.error(clientErr);
        setError(
          clientErr instanceof Error
            ? clientErr.message
            : "Error desconocido al procesar.",
        );
        setIsGenerating(false);
      }
    }
  }, [
    phase1Result,
    file,
    fileId,
    projectFileName,
    scale,
    paper,
    minAreaM2,
    sheetConfig,
    savedOverrides,
    savedWallWallDecisions,
    savedMerges,
    resetProject,
    router,
  ]);

  const handlePaymentApproved = useCallback(async (paymentId: string) => {
    try {
      const res = await fetch("/api/mp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentId }),
      });
      const data = await res.json();
      if (data.verified) {
        await proceedToGeneration();
      } else {
        setError(`Pago no verificado (estado: ${data.status ?? "desconocido"}). Intentá de nuevo.`);
      }
    } catch {
      setError("Error al verificar el pago.");
    }
  }, [proceedToGeneration]);

  const handlePaymentError = useCallback((msg: string) => setError(msg), []);
  const handlePaymentCancel = useCallback(() => router.push("/review"), [router]);
  const handleBypassSuccess = useCallback(() => proceedToGeneration(), [proceedToGeneration]);

  if (isLoadingSession) return null;
  if (!phase1Result) return null;

  if (isGenerating) {
    return (
      <div className="flex flex-col min-h-screen items-center justify-center p-4">
        <div className="card bg-base-100 shadow-2xl border border-base-200 w-full max-w-md">
          <div className="card-body items-center justify-center py-20 gap-4">
            <span className="loading loading-spinner loading-lg text-primary" />
            <p className="font-medium text-base-content/80">Generando planos en el servidor...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen items-center justify-center p-4">
      {error && (
        <div className="alert alert-error shadow-lg mb-6 max-w-md w-full">
          <span>{error}</span>
        </div>
      )}
      <PaymentScreen
        onPaymentApproved={handlePaymentApproved}
        onPaymentError={handlePaymentError}
        onCancel={handlePaymentCancel}
        onBypassSuccess={handleBypassSuccess}
      />
    </div>
  );
}
