"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parsePipeline, decomposePanels, nestDecomposedPanels, generateFromNesting, reclassifyWithMinArea } from "@/core/pipeline";
import type { Phase1Result, ClassificationOverride, NestingPreviewData } from "@/core/pipeline";
import ReviewScreen from "./ReviewScreen";
import NestingPreview from "./NestingPreview";
import PaymentScreen from "./PaymentScreen";
import DemoButton from "./DemoButton";
import { DEFAULT_SHEET } from "@/core/sheet-nester";
import type { PipelineOptions, SheetConfig } from "@/core/types";

type Status = "idle" | "parsing" | "reviewing" | "nesting" | "paying" | "generating" | "done" | "error";

// Persisted session state — saved when entering payment so user can resume
// after navigating away (e.g. browser back from Mercado Pago redirect).
const SESSION_KEY = "e2d_pending_session";

interface PersistedSession {
  fileName: string;
  fileBase64: string;
  scale: number;
  paper: string;
  minAreaM2: number;
  sheetConfig: SheetConfig;
  overrides: ClassificationOverride[];
  /** Wall-wall yield decisions serialized as [jointIndex, yieldGroupId] pairs. */
  wallWallDecisions: [number, number][];
}

function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export default function UploadForm() {
  const [file, setFile] = useState<File | null>(null);
  const [scale, setScale] = useState(100);
  const [paper, setPaper] = useState("A4");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [minAreaM2, setMinAreaM2] = useState(1.0);
  const [phase1Result, setPhase1Result] = useState<Phase1Result | null>(null);
  const [nestingData, setNestingData] = useState<NestingPreviewData | null>(null);
  const [savedOverrides, setSavedOverrides] = useState<ClassificationOverride[]>([]);
  const [savedWallWallDecisions, setSavedWallWallDecisions] = useState<Map<number, number>>(() => new Map());
  const [sheetConfig, setSheetConfig] = useState<SheetConfig>(() => ({ ...DEFAULT_SHEET }));
  const [paymentBypass, setPaymentBypass] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  const accept = ".obj";

  // Check localStorage for bypass key on mount.
  useEffect(() => {
    const stored = localStorage.getItem("e2d_bypass");
    if (stored) setPaymentBypass(true);
  }, []);

  // Restore session if user navigated away during payment (e.g. MP redirect).
  useEffect(() => {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return;

    let parsed: PersistedSession;
    try {
      parsed = JSON.parse(raw);
    } catch {
      sessionStorage.removeItem(SESSION_KEY);
      return;
    }

    try {
      const buffer = base64ToBuffer(parsed.fileBase64);
      const restoredFile = new File([buffer], parsed.fileName);
      setFile(restoredFile);
      setScale(parsed.scale);
      setPaper(parsed.paper);
      setMinAreaM2(parsed.minAreaM2);
      setSheetConfig(parsed.sheetConfig);
      setSavedOverrides(parsed.overrides);
      const restoredDecisions = new Map<number, number>(parsed.wallWallDecisions ?? []);
      setSavedWallWallDecisions(restoredDecisions);

      const p1 = parsePipeline(parsed.fileName, buffer);
      if (p1.faces.length === 0) {
        sessionStorage.removeItem(SESSION_KEY);
        return;
      }
      setPhase1Result(p1);

      const opts: PipelineOptions = {
        scaleDenom: parsed.scale,
        paper: parsed.paper,
        includeCuttingSheet: true,
        sheetConfig: parsed.sheetConfig,
        minAreaM2: parsed.minAreaM2,
      };
      const decomposed = decomposePanels(p1, opts, parsed.overrides, restoredDecisions);
      const nesting = nestDecomposedPanels(decomposed, parsed.sheetConfig, parsed.scale);
      setNestingData(nesting);
      setStatus("nesting");
    } catch {
      sessionStorage.removeItem(SESSION_KEY);
    }
  }, []);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const f = e.dataTransfer.files[0];
    if (f) setFile(f);
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (f) setFile(f);
    },
    [],
  );

  const handleLoadDemo = async () => {
    setStatus("parsing");
    setError("");
    try {
      const res = await fetch("/demo/demo.obj");
      if (!res.ok) {
        throw new Error(
          "El archivo de demo todavía no está disponible. Probá subir tu propio .obj.",
        );
      }
      const buffer = await res.arrayBuffer();
      const demoFile = new File([buffer], "demo.obj", { type: "model/obj" });
      setFile(demoFile);

      const p1 = parsePipeline("demo.obj", buffer);
      if (p1.faces.length === 0) {
        throw new Error("El archivo de demo no contiene geometría válida.");
      }
      setPhase1Result(p1);
      setStatus("reviewing");
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Error al cargar el demo.",
      );
      setStatus("error");
    }
  };

  const handleSubmit = async () => {
    if (!file) return;

    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext === "mtl") {
      setError(
        "Los archivos .mtl solo contienen materiales, no geometría. Subí el archivo .obj correspondiente.",
      );
      setStatus("error");
      return;
    }

    setStatus("parsing");
    setError("");

    try {
      const buffer = await file.arrayBuffer();

      const p1 = await new Promise<Phase1Result>((resolve) => {
        setTimeout(() => {
          resolve(parsePipeline(file.name, buffer));
        }, 50);
      });

      if (p1.faces.length === 0) {
        const msg =
          p1.warnings.length > 0
            ? p1.warnings.join(" ")
            : "No se encontraron caras en el archivo.";
        throw new Error(msg);
      }

      setPhase1Result(p1);
      setStatus("reviewing");
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Error desconocido al procesar.",
      );
      setStatus("error");
    }
  };

  const handleReviewConfirm = async (
    overrides: ClassificationOverride[],
    wallWallDecisions: Map<number, number>,
  ) => {
    if (!phase1Result || !file) return;

    setSavedOverrides(overrides);
    setSavedWallWallDecisions(wallWallDecisions);

    try {
      const opts: PipelineOptions = {
        scaleDenom: scale,
        paper,
        includeCuttingSheet: true,
        sheetConfig,
        minAreaM2,
      };

      const decomposed = await new Promise<ReturnType<typeof decomposePanels>>(
        (resolve) => {
          setTimeout(() => resolve(decomposePanels(phase1Result, opts, overrides, wallWallDecisions)), 50);
        },
      );

      const nesting = nestDecomposedPanels(decomposed, sheetConfig, scale);
      setNestingData(nesting);
      setStatus("nesting");
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Error desconocido al procesar.",
      );
      setStatus("error");
    }
  };

  const handleSheetConfigChange = useCallback((newConfig: SheetConfig) => {
    setSheetConfig(newConfig);
    if (!phase1Result) return;

    const opts: PipelineOptions = {
      scaleDenom: scale,
      paper,
      includeCuttingSheet: true,
      sheetConfig: newConfig,
      minAreaM2,
    };
    const decomposed = decomposePanels(phase1Result, opts, savedOverrides, savedWallWallDecisions);
    const nesting = nestDecomposedPanels(decomposed, newConfig, scale);
    setNestingData(nesting);
  }, [phase1Result, savedOverrides, savedWallWallDecisions, scale, paper, minAreaM2]);

  const handleScaleChange = useCallback((newScale: number) => {
    setScale(newScale);
    if (!phase1Result) return;

    const opts: PipelineOptions = {
      scaleDenom: newScale,
      paper,
      includeCuttingSheet: true,
      sheetConfig,
      minAreaM2,
    };
    const decomposed = decomposePanels(phase1Result, opts, savedOverrides, savedWallWallDecisions);
    const nesting = nestDecomposedPanels(decomposed, sheetConfig, newScale);
    setNestingData(nesting);
  }, [phase1Result, savedOverrides, savedWallWallDecisions, paper, sheetConfig, minAreaM2]);

  // ─── Generation logic (called after payment or bypass) ───

  const proceedToGeneration = useCallback(async () => {
    if (!phase1Result || !file || !nestingData) return;

    setStatus("generating");

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

      sessionStorage.removeItem(SESSION_KEY);
      setStatus("done");
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Error desconocido al procesar.",
      );
      setStatus("error");
    }
  }, [phase1Result, file, nestingData, scale, paper, sheetConfig, minAreaM2]);

  // ─── Nesting confirm → payment gate or bypass ───

  const persistSession = useCallback(async () => {
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      const persisted: PersistedSession = {
        fileName: file.name,
        fileBase64: bufferToBase64(buffer),
        scale,
        paper,
        minAreaM2,
        sheetConfig,
        overrides: savedOverrides,
        wallWallDecisions: Array.from(savedWallWallDecisions.entries()),
      };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(persisted));
    } catch {
      // File too large for sessionStorage — silently skip persistence.
    }
  }, [file, scale, paper, minAreaM2, sheetConfig, savedOverrides, savedWallWallDecisions]);

  const clearSession = useCallback(() => {
    sessionStorage.removeItem(SESSION_KEY);
  }, []);

  const handleNestingConfirm = useCallback(async () => {
    if (!phase1Result || !file || !nestingData) return;

    if (paymentBypass) {
      const key = localStorage.getItem("e2d_bypass");
      if (key) {
        try {
          const res = await fetch("/api/mp/bypass", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key }),
          });
          const data = await res.json();
          if (data.valid) {
            await proceedToGeneration();
            return;
          }
        } catch { /* fall through to payment */ }
        localStorage.removeItem("e2d_bypass");
        setPaymentBypass(false);
      }
    }

    await persistSession();
    setStatus("paying");
  }, [phase1Result, file, nestingData, paymentBypass, proceedToGeneration, persistSession]);

  // ─── Payment callbacks ───

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
        setStatus("error");
      }
    } catch {
      setError("Error al verificar el pago.");
      setStatus("error");
    }
  }, [proceedToGeneration]);

  const handlePaymentError = useCallback((msg: string) => {
    setError(msg);
    setStatus("error");
  }, []);

  const handlePaymentCancel = useCallback(() => {
    setStatus("nesting");
  }, []);

  const handleBypassSuccess = useCallback(() => {
    setPaymentBypass(true);
    proceedToGeneration();
  }, [proceedToGeneration]);

  // ─── Other handlers ───

  const handleNestingBack = useCallback(() => {
    setNestingData(null);
    setStatus("reviewing");
  }, []);

  const handleMinAreaChange = useCallback((newArea: number) => {
    setMinAreaM2(newArea);
    setPhase1Result((prev) => (prev ? reclassifyWithMinArea(prev, newArea) : prev));
  }, []);

  const handleReviewCancel = () => {
    setPhase1Result(null);
    setStatus("idle");
  };

  const reset = () => {
    setFile(null);
    setPhase1Result(null);
    setNestingData(null);
    setSavedOverrides([]);
    setSavedWallWallDecisions(new Map());
    setStatus("idle");
    setError("");
    clearSession();
  };

  // ─── Render by status ───

  // Show payment screen.
  if (status === "paying") {
    return (
      <PaymentScreen
        onPaymentApproved={handlePaymentApproved}
        onPaymentError={handlePaymentError}
        onCancel={handlePaymentCancel}
        onBypassSuccess={handleBypassSuccess}
      />
    );
  }

  // Show nesting preview.
  if (status === "nesting" && nestingData) {
    return (
      <NestingPreview
        nesting={nestingData}
        onConfirm={handleNestingConfirm}
        onBack={handleNestingBack}
        sheetConfig={sheetConfig}
        onSheetConfigChange={handleSheetConfigChange}
        scaleDenom={scale}
        onScaleChange={handleScaleChange}
      />
    );
  }

  // Show review screen when in review mode.
  if (status === "reviewing" && phase1Result) {
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
      />
    );
  }

  // Show generating overlay.
  if (status === "generating") {
    return (
      <div className="upload-card">
        <div className="generating-overlay">
          <span className="spinner" />
          <p>Generando planos...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {status === "idle" && <DemoButton onClick={handleLoadDemo} />}
      <div className="upload-card">
      {/* Drop zone */}
      <div
        ref={dropRef}
        className={`drop-zone ${dragActive ? "drop-zone--active" : ""} ${file ? "drop-zone--has-file" : ""}`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={() => document.getElementById("file-input")?.click()}
      >
        <input
          id="file-input"
          type="file"
          accept={accept}
          hidden
          onChange={handleFileChange}
        />
        {file ? (
          <div className="file-info">
            <span className="file-icon">&#x1F4C4;</span>
            <div>
              <p className="file-name">{file.name}</p>
              <p className="file-size">{(file.size / 1e6).toFixed(1)} MB</p>
            </div>
          </div>
        ) : (
          <div className="drop-content">
            <div className="drop-icon">
              <svg
                width="40"
                height="40"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
            <p className="drop-text">
              Arrastra tu archivo aquí o{" "}
              <span className="drop-link">buscalo</span>
            </p>
            <p className="drop-hint">.obj</p>
          </div>
        )}
      </div>

      {/* Settings */}
      <div className="settings">
        <div className="settings-row">
          <div className="setting-group">
            <label className="setting-label">Escala</label>
            <select
              className="setting-select"
              value={scale}
              onChange={(e) => setScale(Number(e.target.value))}
            >
              <option value={20}>1:20</option>
              <option value={25}>1:25</option>
              <option value={50}>1:50</option>
              <option value={75}>1:75</option>
              <option value={100}>1:100</option>
              <option value={125}>1:125</option>
              <option value={150}>1:150</option>
              <option value={200}>1:200</option>
              <option value={250}>1:250</option>
              <option value={500}>1:500</option>
            </select>
          </div>

          <div className="setting-group">
            <label className="setting-label">Papel</label>
            <select
              className="setting-select"
              value={paper}
              onChange={(e) => setPaper(e.target.value)}
            >
              <option value="A4">A4</option>
              <option value="A3">A3</option>
              <option value="A1">A1</option>
            </select>
          </div>

          <div className="setting-group">
            <label className="setting-label">Formato de salida</label>
            <div className="chip-row">
              <span className="chip chip--active">DXF + PDF</span>
            </div>
          </div>
        </div>


      </div>

      {/* Action button */}
      {status !== "done" ? (
        <button
          className="submit-btn"
          disabled={!file || status === "parsing"}
          onClick={handleSubmit}
        >
          {status === "parsing" ? (
            <>
              <span className="spinner" />
              Analizando modelo...
            </>
          ) : (
            "Analizar Modelo"
          )}
        </button>
      ) : (
        <button className="submit-btn reset-btn" onClick={reset}>
          Procesar otro archivo
        </button>
      )}

      {/* Processing indicator */}
      {status === "parsing" && (
        <div className="progress-bar">
          <div className="progress-fill progress-indeterminate" />
        </div>
      )}

      {/* Success */}
      {status === "done" && (
        <div className="success-msg">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
          ZIP descargado con tus planos (DXF + PDF).
        </div>
      )}

      {/* Error */}
      {status === "error" && <p className="error-msg">{error}</p>}
      </div>
    </>
  );
}
