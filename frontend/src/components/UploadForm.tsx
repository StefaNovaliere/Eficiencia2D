"use client";

import { useCallback, useRef, useState } from "react";
import { uploadSkp, type UploadOptions } from "@/lib/api";

type Status = "idle" | "uploading" | "processing" | "done" | "error";

export default function UploadForm() {
  const [file, setFile] = useState<File | null>(null);
  const [scale, setScale] = useState(100);
  const [paper, setPaper] = useState("A3");
  const [formats, setFormats] = useState<string[]>(["dxf", "pdf"]);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [downloadName, setDownloadName] = useState("");
  const dropRef = useRef<HTMLDivElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f && f.name.endsWith(".skp")) setFile(f);
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) setFile(f);
  }, []);

  const toggleFormat = (fmt: string) => {
    setFormats((prev) =>
      prev.includes(fmt) ? prev.filter((f) => f !== fmt) : [...prev, fmt]
    );
  };

  const handleSubmit = async () => {
    if (!file || formats.length === 0) return;

    setStatus("uploading");
    setProgress(0);
    setError("");
    setDownloadUrl("");

    try {
      const blob = await uploadSkp({
        file,
        scale,
        paper,
        formats,
        onProgress: (pct) => {
          setProgress(pct);
          if (pct >= 100) setStatus("processing");
        },
      });

      const url = URL.createObjectURL(blob);
      const stem = file.name.replace(/\.skp$/i, "");
      setDownloadUrl(url);
      setDownloadName(`${stem}_plans.zip`);
      setStatus("done");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setStatus("error");
    }
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
          accept=".skp"
          hidden
          onChange={handleFileChange}
        />
        {file ? (
          <p className="file-name">{file.name} ({(file.size / 1e6).toFixed(1)} MB)</p>
        ) : (
          <p>Drop a <strong>.skp</strong> file here or click to browse</p>
        )}
      </div>

      {/* Options row */}
      <div className="options-row">
        <label>
          Scale
          <select value={scale} onChange={(e) => setScale(Number(e.target.value))}>
            <option value={50}>1:50</option>
            <option value={100}>1:100</option>
          </select>
        </label>

        <label>
          Paper
          <select value={paper} onChange={(e) => setPaper(e.target.value)}>
            <option value="A3">A3</option>
            <option value="A1">A1</option>
          </select>
        </label>

        <fieldset className="format-group">
          <legend>Formats</legend>
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
      </div>

      {/* Action */}
      <button
        className="submit-btn"
        disabled={!file || formats.length === 0 || status === "uploading" || status === "processing"}
        onClick={handleSubmit}
      >
        {status === "uploading"
          ? `Uploading... ${progress}%`
          : status === "processing"
            ? "Processing..."
            : "Generate Plans"}
      </button>

      {/* Progress bar */}
      {(status === "uploading" || status === "processing") && (
        <div className="progress-bar">
          <div
            className="progress-fill"
            style={{ width: status === "processing" ? "100%" : `${progress}%` }}
          />
        </div>
      )}

      {/* Result */}
      {status === "done" && downloadUrl && (
        <a className="download-link" href={downloadUrl} download={downloadName}>
          Download {downloadName}
        </a>
      )}

      {/* Error */}
      {status === "error" && <p className="error-msg">{error}</p>}
    </div>
  );
}
