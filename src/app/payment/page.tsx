"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useProjectContext } from "@/context/ProjectContext";
import PaymentScreen from "@/components/PaymentScreen";
import { generateFromNesting } from "@/core/pipeline";
import type { PipelineOptions } from "@/core/types";

export default function PaymentPage() {
  const router = useRouter();
  const { 
    file,
    phase1Result, 
    nestingData, 
    scale, 
    paper, 
    sheetConfig, 
    minAreaM2,
    isLoadingSession,
    resetProject
  } = useProjectContext();
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isLoadingSession && (!phase1Result || !nestingData)) {
      router.replace("/");
    }
  }, [isLoadingSession, phase1Result, nestingData, router]);

  const proceedToGeneration = useCallback(async () => {
    if (!phase1Result || !file || !nestingData) return;

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

      const result = await new Promise<ReturnType<typeof generateFromNesting>>(
        (resolve) => {
          setTimeout(() => resolve(generateFromNesting(phase1Result, nestingData, opts)), 50);
        },
      );

      if (result.files.length === 0) {
        const msg =
          result.warnings.length > 0
            ? result.warnings.join(" ")
            : "No se generaron archivos. Verificá que el modelo contenga geometría válida.";
        throw new Error(msg);
      }

      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();

      for (const f of result.files) {
        zip.file(f.name, f.blob);
      }

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
  }, [phase1Result, file, nestingData, scale, paper, sheetConfig, minAreaM2, resetProject, router]);

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

  const handlePaymentError = useCallback((msg: string) => {
    setError(msg);
  }, []);

  const handlePaymentCancel = useCallback(() => {
    router.push("/nesting");
  }, [router]);

  const handleBypassSuccess = useCallback(() => {
    proceedToGeneration();
  }, [proceedToGeneration]);

  if (isLoadingSession) return null;
  if (!phase1Result || !nestingData) return null;

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
