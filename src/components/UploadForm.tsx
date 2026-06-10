"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Phase1Result } from "@/core/pipeline";
import DemoButton from "./DemoButton";
import { useProjectContext } from "@/context/ProjectContext";
import { useGeometryWorker } from "@/hooks/useGeometryWorker";

/** Resultado que devuelve motor.process_obj (Python/Pyodide) vía el Worker. */
type MotorResult =
  | { ok: true; phase1: Phase1Result }
  | { ok: false; error: string; trace?: string };

export default function UploadForm() {
  const router = useRouter();
  const {
    file,
    setFile,
    scale,
    setScale,
    setPhase1Result,
    persistSession,
  } = useProjectContext();

  const [isParsing, setIsParsing] = useState(false);
  const [error, setError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);
  // Evita navegar dos veces si el resultado dispara el efecto más de una vez.
  const navigatedRef = useRef(false);

  // Motor geométrico portado a Python, ejecutándose en Pyodide (WebAssembly)
  // dentro de un Web Worker. Reemplaza al antiguo parsePipeline en TS.
  const {
    isReady: isWorkerReady,
    isProcessing,
    stage: workerStage,
    error: workerError,
    result: workerResult,
    processObj,
  } = useGeometryWorker<MotorResult>();

  const accept = ".obj";

  // Cuando el motor de Python devuelve el Phase1Result, lo guardamos en el
  // contexto y navegamos a la pantalla de revisión.
  useEffect(() => {
    if (!workerResult || navigatedRef.current) return;

    if (!workerResult.ok) {
      setError(workerResult.error || "El motor geométrico no pudo procesar el archivo.");
      setIsParsing(false);
      return;
    }

    const p1 = workerResult.phase1;
    if (!p1 || p1.faces.length === 0) {
      const msg =
        p1 && p1.warnings.length > 0
          ? p1.warnings.join(" ")
          : "No se encontró geometría válida en el archivo.";
      setError(msg);
      setIsParsing(false);
      return;
    }

    navigatedRef.current = true;
    setPhase1Result(p1);
    // Persistimos antes de navegar para que un refresh en /review funcione.
    void persistSession().finally(() => router.push("/review"));
  }, [workerResult, setPhase1Result, persistSession, router]);

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
  }, [setFile]);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (f) setFile(f);
    },
    [setFile]
  );

  const runWorker = useCallback(
    (objString: string, fileName: string) => {
      navigatedRef.current = false;
      setError("");
      setIsParsing(true);
      processObj(objString, { fileName, scale });
    },
    [processObj, scale],
  );

  const handleLoadDemo = async () => {
    setError("");
    try {
      const res = await fetch("/demo/demo.obj");
      if (!res.ok) {
        throw new Error(
          "El archivo de demo todavía no está disponible. Probá subir tu propio .obj.",
        );
      }
      const text = await res.text();
      const buffer = new TextEncoder().encode(text).buffer;
      setFile(new File([buffer], "demo.obj", { type: "model/obj" }));
      runWorker(text, "demo.obj");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error al cargar el demo.");
    }
  };

  const handleSubmit = async () => {
    if (!file) return;

    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext === "mtl") {
      setError(
        "Los archivos .mtl solo contienen materiales, no geometría. Subí el archivo .obj correspondiente.",
      );
      return;
    }

    try {
      const text = await file.text();
      runWorker(text, file.name);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Error desconocido al leer el archivo.",
      );
    }
  };

  if (isParsing || isProcessing) {
    return (
      <div className="card bg-base-100 shadow-2xl border border-base-200 w-full">
        <div className="card-body items-center justify-center py-20 gap-4">
          <span className="loading loading-spinner loading-lg text-primary" />
          <p className="font-medium text-base-content/80">
            {workerStage ?? "Procesando geometría..."}
          </p>
          <p className="text-xs text-base-content/50">Cálculo en Python (WebAssembly), sin bloquear la interfaz.</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <DemoButton onClick={handleLoadDemo} />
      <div className="card bg-base-100 shadow-2xl border border-base-200 w-full relative">
        <div className="card-body p-6 md:p-8">
          {/* Drop zone */}
          <div
            ref={dropRef}
            className={`relative w-full border-2 border-dashed rounded-2xl p-8 text-center transition-colors cursor-pointer ${
              dragActive
                ? "border-primary bg-primary/5"
                : file
                ? "border-solid border-base-300 bg-base-200/20"
                : "border-base-300 hover:border-primary/50 hover:bg-base-200/50"
            }`}
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
              <div className="flex items-center gap-4 text-left p-4 bg-base-200 rounded-xl">
                <span className="text-4xl">&#x1F4C4;</span>
                <div>
                  <p className="font-bold text-base-content break-all">{file.name}</p>
                  <p className="text-sm text-base-content/60">{(file.size / 1e6).toFixed(1)} MB</p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-2">
                <div className="text-base-content/40 mb-2">
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
                <p className="font-medium text-base-content">
                  Arrastra tu archivo aquí o{" "}
                  <span className="text-primary font-bold hover:underline">buscalo</span>
                </p>
                <p className="text-sm text-base-content/50">.obj</p>
              </div>
            )}
          </div>

          {/* Settings */}
          <div className="mt-6 bg-base-200/50 rounded-xl p-5 md:p-6">
            <div className="grid grid-cols-1 gap-5">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-semibold text-base-content/80">Escala de importación</label>
                <select
                  className="select select-bordered select-sm w-full bg-base-100"
                  value={scale}
                  onChange={(e) => setScale(Number(e.target.value))}
                >
                  <option value={20}>1:20</option>
                  <option value={25}>1:25</option>
                  <option value={50}>1:50</option>
                  <option value={75}>1:75</option>
                  <option value={100}>1:100 (Centimetros)</option>
                </select>
                <p className="text-xs text-base-content/60 leading-relaxed mt-1">
                  Ej: Si tu modelo está dibujado en centímetros, elegí 1:100.
                </p>
              </div>
            </div>
          </div>

          {(error || workerError) && (
            <div className="alert alert-error shadow-sm mt-6 rounded-xl">
              <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              <span>{error || workerError}</span>
            </div>
          )}

          {/* Estado del motor geométrico (Pyodide / WebAssembly en el Worker) */}
          <div className="mt-4 flex items-center justify-center gap-2 text-xs text-base-content/60">
            {isWorkerReady ? (
              <>
                <span className="inline-block h-2 w-2 rounded-full bg-success" />
                <span>Motor geométrico (Python) listo</span>
              </>
            ) : (
              <>
                <span className="loading loading-spinner loading-xs" />
                <span>{workerStage ?? "Inicializando motor geométrico…"}</span>
              </>
            )}
          </div>

          <div className="mt-8 flex justify-center">
            <button
              className="btn btn-primary btn-wide shadow-lg shadow-primary/20"
              disabled={!file || isParsing || isProcessing || !isWorkerReady}
              onClick={handleSubmit}
            >
              {!isWorkerReady ? (
                <>
                  <span className="loading loading-spinner" /> Inicializando motor…
                </>
              ) : (
                "Continuar →"
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
