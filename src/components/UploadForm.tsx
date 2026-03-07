"use client";

import { useCallback, useRef, useState } from "react";
import { runPipeline } from "@/core/pipeline";
import type { PipelineOptions } from "@/core/types";

type Status = "idle" | "processing" | "done" | "error";

export default function UploadForm() {
  const [file, setFile] = useState<File | null>(null);
  const [scale, setScale] = useState(100);
  const [paper, setPaper] = useState("A4");
  const [includeCuttingSheet, setIncludeCuttingSheet] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [dragActive, setDragActive] = useState(false);
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

    setStatus("processing");
    setError("");

    try {
      const buffer = await file.arrayBuffer();

      const opts: PipelineOptions = {
        scaleDenom: scale,
        paper,
        includeCuttingSheet,
      };

      // Run pipeline (synchronous, CPU-bound).
      // Use setTimeout to let the UI update before heavy computation.
      const result = await new Promise<ReturnType<typeof runPipeline>>(
        (resolve) => {
          setTimeout(() => {
            resolve(runPipeline(file.name, buffer, opts));
          }, 50);
        },
      );

      if (result.files.length === 0) {
        const msg =
          result.warnings.length > 0
            ? result.warnings.join(" ")
            : "No se generaron archivos. Verificá que el modelo contenga geometría válida.";
        throw new Error(msg);
      }

      // Create ZIP and download.
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

  const reset = () => {
    setFile(null);
    setStatus("idle");
    setError("");
  };

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
          <label className="setting-check">
            <input
              type="checkbox"
              checked={includeCuttingSheet}
              onChange={(e) => setIncludeCuttingSheet(e.target.checked)}
            />
            Plancha de Corte
          </label>
        </div>
      </div>

      {/* Action button */}
      {status !== "done" ? (
        <button
          className="submit-btn"
          disabled={!file || status === "processing"}
          onClick={handleSubmit}
        >
          {status === "processing" ? (
            <>
              <span className="spinner" />
              Procesando...
            </>
          ) : (
            "Generar Planos"
          )}
        </button>
      ) : (
        <button className="submit-btn reset-btn" onClick={reset}>
          Procesar otro archivo
        </button>
      )}

      {/* Processing indicator */}
      {status === "processing" && (
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
