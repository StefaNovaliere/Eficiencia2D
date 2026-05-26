"use client";

import { useCallback, useRef, useState } from "react";
import { parsePipeline, decomposePanels, nestDecomposedPanels, generateFromNesting } from "@/core/pipeline";
import type { Phase1Result, ClassificationOverride, NestingPreviewData } from "@/core/pipeline";
import ReviewScreen from "./ReviewScreen";
import NestingPreview from "./NestingPreview";
import { DEFAULT_SHEET } from "@/core/sheet-nester";
import type { DecompositionMode, PipelineOptions, SheetConfig } from "@/core/types";

type Status = "idle" | "parsing" | "reviewing" | "nesting" | "generating" | "done" | "error";

export default function UploadForm() {
  const [file, setFile] = useState<File | null>(null);
  const [scale, setScale] = useState(100);
  const [paper, setPaper] = useState("A4");
  const [decompositionMode, setDecompositionMode] = useState<DecompositionMode>("simple");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [phase1Result, setPhase1Result] = useState<Phase1Result | null>(null);
  const [nestingData, setNestingData] = useState<NestingPreviewData | null>(null);
  const [savedOverrides, setSavedOverrides] = useState<ClassificationOverride[]>([]);
  const [sheetConfig, setSheetConfig] = useState<SheetConfig>(() => ({ ...DEFAULT_SHEET }));
  const dropRef = useRef<HTMLDivElement>(null);

  const accept = ".obj";

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

      // Phase 1: Parse + classify (CPU-bound).
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

  const handleReviewConfirm = async (overrides: ClassificationOverride[]) => {
    if (!phase1Result || !file) return;

    setSavedOverrides(overrides);

    try {
      const opts: PipelineOptions = {
        scaleDenom: scale,
        paper,
        includeCuttingSheet: true,
        decompositionMode,
        sheetConfig,
      };

      const decomposed = await new Promise<ReturnType<typeof decomposePanels>>(
        (resolve) => {
          setTimeout(() => resolve(decomposePanels(phase1Result, opts, overrides)), 50);
        },
      );

      const nesting = nestDecomposedPanels(decomposed, sheetConfig);
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
      decompositionMode,
      sheetConfig: newConfig,
    };
    const decomposed = decomposePanels(phase1Result, opts, savedOverrides);
    const nesting = nestDecomposedPanels(decomposed, newConfig);
    setNestingData(nesting);
  }, [phase1Result, savedOverrides, scale, paper, decompositionMode]);

  const handleNestingConfirm = async () => {
    if (!phase1Result || !file || !nestingData) return;

    setStatus("generating");

    try {
      const opts: PipelineOptions = {
        scaleDenom: scale,
        paper,
        includeCuttingSheet: true,
        decompositionMode,
        sheetConfig,
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

      setStatus("done");
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Error desconocido al procesar.",
      );
      setStatus("error");
    }
  };

  const handleNestingBack = useCallback(() => {
    setNestingData(null);
    setStatus("reviewing");
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
    setStatus("idle");
    setError("");
  };

  // Show nesting preview.
  if (status === "nesting" && nestingData) {
    return (
      <NestingPreview
        nesting={nestingData}
        onConfirm={handleNestingConfirm}
        onBack={handleNestingBack}
        sheetConfig={sheetConfig}
        onSheetConfigChange={handleSheetConfigChange}
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

        <div className="settings-row">
          <div className="setting-group" style={{ flex: 1 }}>
            <label className="setting-label">Modo de descomposicion</label>
            <select
              className="setting-select"
              value={decompositionMode}
              onChange={(e) => setDecompositionMode(e.target.value as DecompositionMode)}
            >
              <option value="simple">Simple — solo cara exterior de cada pared</option>
              <option value="detailed">Detallado — todas las caras y cantos</option>
            </select>
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
  );
}
