"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useProjectContext } from "@/context/ProjectContext";
import PaymentScreen from "@/components/PaymentScreen";
import {
  decomposePanels,
  nestDecomposedPanels,
  generateFromNesting,
} from "@/core/pipeline";
import type { PipelineOptions } from "@/core/types";

export default function PaymentPage() {
  const router = useRouter();
  const {
    file,
    phase1Result,
    savedOverrides,
    savedWallWallDecisions,
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
    if (!phase1Result || !file) return;

    setIsGenerating(true);
    setError("");

    try {
      const opts: PipelineOptions = {
        scaleDenom: scale,
        paper,
        includeCuttingSheet: true,
        sheetConfig,
        minAreaM2,
      };

      // Todo en el cliente: el trabajo pesado (parseo/clasificación) ya está en
      // phase1Result; acá solo se decompone, se nesteа y se serializa a DXF/PDF.
      const decomposed = decomposePanels(
        phase1Result,
        opts,
        savedOverrides,
        savedWallWallDecisions,
      );
      const nesting = nestDecomposedPanels(decomposed, sheetConfig, scale);
      const result = generateFromNesting(phase1Result, nesting, opts);

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

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const stem = file.name.replace(/\.[^.]+$/, "");
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${stem}_planos.zip`;
      a.click();
      URL.revokeObjectURL(url);

      resetProject();
      alert("¡Planos generados y descargados exitosamente!");
      router.push("/");
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Error desconocido al procesar.");
      setIsGenerating(false);
    }
  }, [
    phase1Result,
    file,
    scale,
    paper,
    minAreaM2,
    sheetConfig,
    savedOverrides,
    savedWallWallDecisions,
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
            <p className="font-medium text-base-content/80">Generando planos...</p>
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
