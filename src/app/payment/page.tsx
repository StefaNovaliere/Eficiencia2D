"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { BookOpen } from "lucide-react";
import { useProjectContext } from "@/context/ProjectContext";
import { useAuth } from "@/context/AuthContext";
import PaymentScreen from "@/components/PaymentScreen";
import {
  base64ToBlob,
  generateProjectFiles,
  userCutsForApi,
  type SplitOperation,
} from "@/services/api";
import { extractAssemblyGuideFromZip } from "@/core/assembly-guide";

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

export default function PaymentPage() {
  const router = useRouter();
  const { token } = useAuth();
  const {
    file,
    fileId,
    projectFileName,
    phase1Result,
    savedOverrides,
    savedWallWallDecisions,
    savedMerges,
    savedSplits,
    savedMarks,
    savedUserCuts,
    scale,
    paper,
    pdfPageMode,
    minAreaM2,
    sheetConfig,
    isLoadingSession,
    resetProject,
    setAssemblyGuideData,
  } = useProjectContext();

  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState("");
  const [guidePdfMissing, setGuidePdfMissing] = useState(false);
  // ZIP generado y listo para (re)descargar. Reemplaza el window.alert de éxito.
  const [download, setDownload] = useState<{ url: string; name: string } | null>(null);

  useEffect(() => {
    if (!isLoadingSession && !phase1Result) {
      router.replace("/home");
    }
  }, [isLoadingSession, phase1Result, router]);

  // Liberar el blob al desmontar para no filtrar memoria.
  useEffect(() => {
    return () => {
      if (download) URL.revokeObjectURL(download.url);
    };
  }, [download]);

  // Dispara la descarga y muestra el estado de éxito en pantalla (sin
  // window.alert), conservando el blob para permitir "Descargar de nuevo".
  const triggerDownload = useCallback((blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setDownload({ url, name });
    setIsGenerating(false);
  }, []);

  const handleFinish = useCallback(() => {
    if (download) URL.revokeObjectURL(download.url);
    resetProject();
    router.push("/home");
  }, [download, resetProject, router]);

  const handleGoToAssembly = useCallback(() => {
    router.push("/review?assembly=1");
  }, [router]);

  const proceedToGeneration = useCallback(async () => {
    if (!phase1Result || !fileId) return;

    setIsGenerating(true);
    setError("");
    setGuidePdfMissing(false);

    const stem =
      file?.name.replace(/\.[^.]+$/, "") ??
      projectFileName?.replace(/\.[^.]+$/, "") ??
      phase1Result.stem;

    try {
      const backendRes = await generateProjectFiles({
        file_id: fileId,
        original_filename: file?.name ?? projectFileName ?? "model.obj",
        axis: phase1Result.appliedAxis,
        scale_denom: scale,
        paper,
        page_mode: pdfPageMode,
        min_area_m2: minAreaM2,
        sheet_config: {
          width_m: sheetConfig.widthM,
          height_m: sheetConfig.heightM,
          gap_m: sheetConfig.gapM,
        },
        overrides: overridesToRecord(savedOverrides),
        wall_wall_decisions: decisionsToRecord(savedWallWallDecisions),
        merges: savedMerges,
        splits: savedSplits.map((s): SplitOperation => ({ group_id: s.groupId, mode: s.mode })),
        marks: savedMarks,
        user_cuts: userCutsForApi(savedUserCuts),
      }, token);

      if (!backendRes.zip_base64) {
        throw new Error("El backend no devolvió el archivo ZIP.");
      }

      const hasAssemblyGuide = backendRes.generated_files.some((name) =>
        name.toLowerCase().includes("guia_ensamble"),
      );
      setGuidePdfMissing(!hasAssemblyGuide);

      const guideJson = await extractAssemblyGuideFromZip(backendRes.zip_base64);
      setAssemblyGuideData(guideJson);

      triggerDownload(
        base64ToBlob(backendRes.zip_base64),
        backendRes.zip_filename ?? `${stem}_planos.zip`,
      );
    } catch (backendErr: unknown) {
      console.error(backendErr);
      setError(
        backendErr instanceof Error
          ? backendErr.message
          : "Error al generar los planos en el servidor.",
      );
      setIsGenerating(false);
    }
  }, [
    phase1Result,
    file,
    fileId,
    projectFileName,
    scale,
    paper,
    pdfPageMode,
    minAreaM2,
    sheetConfig,
    savedOverrides,
    savedWallWallDecisions,
    savedMerges,
    savedSplits,
    savedMarks,
    savedUserCuts,
    triggerDownload,
    setAssemblyGuideData,
    token,
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

  if (download) {
    return (
      <div className="flex flex-col min-h-screen items-center justify-center p-4">
        <div className="card bg-base-100 shadow-2xl border border-base-200 w-full max-w-md">
          <div className="card-body items-center text-center gap-3 py-12">
            <div className="text-success text-5xl">✓</div>
            <h2 className="text-2xl font-bold">¡Listo! Tus planos se descargaron</h2>
            <p className="text-base-content/70">
              Si la descarga no comenzó, podés volver a bajarla. También podés ver
              el instructivo interactivo de ensamble.
            </p>
            {guidePdfMissing && (
              <div className="alert alert-warning text-sm text-left w-full">
                <span>
                  El ZIP no incluye <strong>guia_ensamble.pdf</strong>. La guía falló
                  al generarse — revisá los logs del servidor o usá el instructivo
                  interactivo.
                </span>
              </div>
            )}
            <button
              type="button"
              className="btn btn-primary w-full gap-2 mt-2"
              onClick={handleGoToAssembly}
            >
              <BookOpen size={18} />
              Ver instructivo de ensamble
            </button>
            <div className="flex flex-col sm:flex-row gap-2 w-full">
              <a
                href={download.url}
                download={download.name}
                className="btn btn-outline flex-1"
              >
                Descargar de nuevo
              </a>
              <button type="button" className="btn btn-ghost flex-1" onClick={handleFinish}>
                Volver al inicio
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

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
