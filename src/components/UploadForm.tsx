"use client";

import { useCallback, useRef, useState } from "react";

type Status = "idle" | "uploading" | "done" | "error";

const RAW_API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";
const API_URL =
  RAW_API_URL && !/^https?:\/\//.test(RAW_API_URL)
    ? `https://${RAW_API_URL}`
    : RAW_API_URL;

export default function UploadForm() {
  const [file, setFile] = useState<File | null>(null);
  const [scale, setScale] = useState(100);
  const [paper, setPaper] = useState<"A3" | "A1">("A3");
  const [formats, setFormats] = useState<("dxf" | "pdf")[]>(["dxf", "pdf"]);
  const [includePlan, setIncludePlan] = useState(false);
  const [includeCuttingSheet, setIncludeCuttingSheet] = useState(false);
  const [includeFloorPlans, setIncludeFloorPlans] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  const accept = ".skp,.obj,.mtl";

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

  const toggleFormat = (fmt: "dxf" | "pdf") => {
    setFormats((prev) =>
      prev.includes(fmt) ? prev.filter((f) => f !== fmt) : [...prev, fmt],
    );
  };

  const handleSubmit = async () => {
    if (!file || formats.length === 0) return;

    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext === "mtl") {
      setError("Los archivos .mtl solo contienen materiales, no geometría. Sube el archivo .obj correspondiente.");
      setStatus("error");
      return;
    }

    setStatus("uploading");
    setError("");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("scale", String(scale));
      formData.append("paper", paper);
      formData.append("formats", formats.join(","));
      formData.append("include_plan", includePlan ? "true" : "false");
      formData.append("include_cutting_sheet", includeCuttingSheet ? "true" : "false");
      formData.append("include_floor_plans", includeFloorPlans ? "true" : "false");

      const res = await fetch(`${API_URL}/api/upload`, {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const detail = body?.detail ?? `Error del servidor (${res.status})`;
        throw new Error(detail);
      }

      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition");
      const filenameMatch = disposition?.match(/filename="?([^"]+)"?/);
      const zipName = filenameMatch?.[1] ?? `${file.name.replace(/\.[^.]+$/, "")}_planos.zip`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = zipName;
      a.click();
      URL.revokeObjectURL(url);

      setStatus("done");
    } catch (err: unknown) {
      clearTimeout(timeout);
      if (err instanceof DOMException && err.name === "AbortError") {
        setError(
          "El servidor tardó demasiado (más de 5 minutos). " +
          "Intenta simplificar el modelo en SketchUp eliminando muebles y detalles internos.",
        );
      } else if (err instanceof TypeError && err.message === "Failed to fetch") {
        setError(
          "Error de conexión con el servidor. El archivo puede ser demasiado " +
          "grande para procesar. Intenta con un modelo más simple o inténtalo de nuevo.",
        );
      } else {
        setError(
          err instanceof Error ? err.message : "Error desconocido al procesar.",
        );
      }
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
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
            <p className="drop-text">
              Arrastra tu archivo aquí o <span className="drop-link">buscalo</span>
            </p>
            <p className="drop-hint">.skp o .obj</p>
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
              <option value={50}>1:50</option>
              <option value={100}>1:100</option>
            </select>
          </div>

          <div className="setting-group">
            <label className="setting-label">Papel</label>
            <select
              className="setting-select"
              value={paper}
              onChange={(e) => setPaper(e.target.value as "A3" | "A1")}
            >
              <option value="A3">A3</option>
              <option value="A1">A1</option>
            </select>
          </div>

          <div className="setting-group">
            <label className="setting-label">Formato</label>
            <div className="chip-row">
              <button
                type="button"
                className={`chip ${formats.includes("dxf") ? "chip--active" : ""}`}
                onClick={() => toggleFormat("dxf")}
              >
                DXF
              </button>
              <button
                type="button"
                className={`chip ${formats.includes("pdf") ? "chip--active" : ""}`}
                onClick={() => toggleFormat("pdf")}
              >
                PDF
              </button>
            </div>
          </div>
        </div>

        <div className="extras-row">
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={includePlan}
              onChange={() => setIncludePlan((prev) => !prev)}
            />
            <span className="toggle-text">Descomposición</span>
          </label>
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={includeCuttingSheet}
              onChange={() => setIncludeCuttingSheet((prev) => !prev)}
            />
            <span className="toggle-text">Plancha de corte</span>
          </label>
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={includeFloorPlans}
              onChange={() => setIncludeFloorPlans((prev) => !prev)}
            />
            <span className="toggle-text">Plantas de piso</span>
          </label>
        </div>
      </div>

      {/* Action button */}
      {status !== "done" ? (
        <button
          className="submit-btn"
          disabled={!file || formats.length === 0 || status === "uploading"}
          onClick={handleSubmit}
        >
          {status === "uploading" ? (
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
      {status === "uploading" && (
        <div className="progress-bar">
          <div className="progress-fill progress-indeterminate" />
        </div>
      )}

      {/* Success */}
      {status === "done" && (
        <div className="success-msg">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          ZIP descargado con tus planos.
        </div>
      )}

      {/* Error */}
      {status === "error" && <p className="error-msg">{error}</p>}
    </div>
  );
}
