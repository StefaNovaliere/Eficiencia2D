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
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const dropRef = useRef<HTMLDivElement>(null);

  const accept = ".skp,.obj,.mtl";

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
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

    // .mtl files are material definitions — they don't contain geometry.
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext === "mtl") {
      setError("Los archivos .mtl solo contienen materiales, no geometría. Sube el archivo .obj correspondiente.");
      setStatus("error");
      return;
    }

    setStatus("uploading");
    setError("");

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("scale", String(scale));
      formData.append("paper", paper);
      formData.append("formats", formats.join(","));
      formData.append("include_plan", includePlan ? "true" : "false");
      formData.append("include_cutting_sheet", includeCuttingSheet ? "true" : "false");

      const res = await fetch(`${API_URL}/api/upload`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const detail = body?.detail ?? `Error del servidor (${res.status})`;
        throw new Error(detail);
      }

      // The backend returns a ZIP — trigger browser download.
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
        className="drop-zone"
        onDragOver={(e) => e.preventDefault()}
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
          <p className="file-name">
            {file.name} ({(file.size / 1e6).toFixed(1)} MB)
          </p>
        ) : (
          <>
            <p>
              Arrastra un archivo <strong>.skp</strong> o <strong>.obj</strong>{" "}
              aquí, o haz clic para buscar
            </p>
            <p className="hint-text">
              Los archivos .mtl no son necesarios — solo se usa la geometría del .obj
            </p>
          </>
        )}
      </div>

      {/* Options row */}
      <div className="options-row">
        <label>
          Escala
          <select
            value={scale}
            onChange={(e) => setScale(Number(e.target.value))}
          >
            <option value={50}>1:50</option>
            <option value={100}>1:100</option>
          </select>
        </label>

        <label>
          Papel
          <select
            value={paper}
            onChange={(e) => setPaper(e.target.value as "A3" | "A1")}
          >
            <option value="A3">A3</option>
            <option value="A1">A1</option>
          </select>
        </label>

        <fieldset className="format-group">
          <legend>Formatos</legend>
          <label>
            <input
              type="checkbox"
              checked={formats.includes("dxf")}
              onChange={() => toggleFormat("dxf")}
            />
            DXF
          </label>
          <label>
            <input
              type="checkbox"
              checked={formats.includes("pdf")}
              onChange={() => toggleFormat("pdf")}
            />
            PDF
          </label>
        </fieldset>

        <fieldset className="format-group">
          <legend>Extras</legend>
          <label>
            <input
              type="checkbox"
              checked={includePlan}
              onChange={() => setIncludePlan((prev) => !prev)}
            />
            Descomposición
          </label>
          <label>
            <input
              type="checkbox"
              checked={includeCuttingSheet}
              onChange={() => setIncludeCuttingSheet((prev) => !prev)}
            />
            Plancha de corte
          </label>
        </fieldset>
      </div>

      {/* Action button */}
      {status !== "done" ? (
        <button
          className="submit-btn"
          disabled={!file || formats.length === 0 || status === "uploading"}
          onClick={handleSubmit}
        >
          {status === "uploading" ? "Procesando..." : "Generar Planos"}
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
        <div className="results">
          <p className="results-summary">
            Archivo ZIP descargado con tus planos.
          </p>
        </div>
      )}

      {/* Error */}
      {status === "error" && <p className="error-msg">{error}</p>}
    </div>
  );
}
