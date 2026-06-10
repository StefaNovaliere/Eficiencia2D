"use client";

// Hook que gestiona el ciclo de vida del Web Worker de geometría (Pyodide)
// desde la UI. Crea el Worker al montar, escucha sus mensajes y expone estados
// claros para que componentes como UploadForm controlen el flujo:
//   - isReady:      Pyodide + paquetes + motor cargados y listos.
//   - isProcessing: hay un .obj calculándose en el Worker.
//   - result:       último JSON devuelto por el motor de Python.
//   - error:        último error de inicialización o procesamiento.
//   - stage:        mensaje de progreso de la etapa actual (UX).

import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkerRequest, WorkerResponse } from "@/workers/geometry.types";

export interface UseGeometryWorker<T = unknown> {
  /** Pyodide y el motor están listos para procesar. */
  isReady: boolean;
  /** Hay un archivo procesándose actualmente. */
  isProcessing: boolean;
  /** Último resultado JSON devuelto por el motor de Python. */
  result: T | null;
  /** Último mensaje de error (inicialización o procesamiento). */
  error: string | null;
  /** Etapa de progreso actual (carga de runtime, paquetes, cálculo…). */
  stage: string | null;
  /** Envía el string crudo de un .obj al Worker para procesarlo. */
  processObj: (objString: string, opts?: { fileName?: string; scale?: number }) => void;
}

export function useGeometryWorker<T = unknown>(): UseGeometryWorker<T> {
  const workerRef = useRef<Worker | null>(null);

  const [isReady, setIsReady] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);

  useEffect(() => {
    // El Worker solo existe en el navegador. El patrón new URL(..., import.meta.url)
    // permite que webpack (Next.js) detecte y empaquete el Worker correctamente.
    const worker = new Worker(
      new URL("../workers/geometry.worker.ts", import.meta.url),
    );
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      switch (msg.type) {
        case "READY":
          setIsReady(true);
          setStage(null);
          break;
        case "PROGRESS":
          setStage(msg.stage);
          break;
        case "RESULT":
          setResult(msg.payload as T);
          setIsProcessing(false);
          setStage(null);
          break;
        case "ERROR":
          setError(msg.error);
          setIsProcessing(false);
          setStage(null);
          break;
      }
    };

    worker.onerror = (event) => {
      setError(event.message || "Error desconocido en el Worker de geometría.");
      setIsProcessing(false);
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const processObj = useCallback(
    (objString: string, opts?: { fileName?: string; scale?: number }) => {
      const worker = workerRef.current;
      if (!worker) return;

      setError(null);
      setResult(null);
      setIsProcessing(true);

      const request: WorkerRequest = {
        type: "PROCESS_OBJ",
        payload: { objString, fileName: opts?.fileName, scale: opts?.scale },
      };
      worker.postMessage(request);
    },
    [],
  );

  return { isReady, isProcessing, result, error, stage, processObj };
}
