"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useProjectContext } from "@/context/ProjectContext";
import PaymentScreen from "@/components/PaymentScreen";
import { generateProjectFiles } from "@/services/api";

export default function PaymentPage() {
  const router = useRouter();
  const { 
    file,
    fileId,
    savedOverrides,
    savedWallWallDecisions,
    phase1Result, 
    scale, 
    paper, 
    minAreaM2,
    isLoadingSession,
    resetProject
  } = useProjectContext();
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isLoadingSession && !phase1Result) {
      router.replace("/");
    }
  }, [isLoadingSession, phase1Result, router]);

  const proceedToGeneration = useCallback(async () => {
    if (!fileId || !file) return;

    setIsGenerating(true);
    setError("");

    try {
      const payload = {
        file_id: fileId,
        original_filename: file.name,
        scale_denom: scale,
        paper,
        overrides: Object.fromEntries(savedOverrides.map(o => [o.groupId, o.newCategory])),
        wall_wall_decisions: Object.fromEntries(savedWallWallDecisions.entries())
      };

      const result = await generateProjectFiles(payload);

      resetProject();
      alert(`¡${result.message} Los archivos generados pronto estarán disponibles para descarga directa.`);
      router.push("/");
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Error desconocido al procesar.");
      setIsGenerating(false);
    }
  }, [fileId, file, scale, paper, savedOverrides, savedWallWallDecisions, resetProject, router]);

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
    router.push("/review");
  }, [router]);

  const handleBypassSuccess = useCallback(() => {
    proceedToGeneration();
  }, [proceedToGeneration]);

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
