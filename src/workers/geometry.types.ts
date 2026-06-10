// Protocolo de mensajes compartido entre el hilo principal (hook/UI) y el
// Web Worker de geometría (Pyodide). Es la única fuente de verdad para los
// tipos de mensajes; tanto `useGeometryWorker.ts` como `geometry.worker.ts`
// lo importan para mantener la comunicación type-safe.

/** Mensajes que el hilo principal envía al Worker. */
export type WorkerRequest = {
  type: "PROCESS_OBJ";
  payload: {
    /** Contenido crudo del archivo .obj cargado por el usuario. */
    objString: string;
    /** Nombre del archivo (opcional, para warnings/diagnóstico). */
    fileName?: string;
    /** Escala de importación seleccionada en la UI (opcional). */
    scale?: number;
  };
};

/** Mensajes que el Worker envía de vuelta al hilo principal. */
export type WorkerResponse =
  /** Pyodide + paquetes + motor.py cargados y listos para procesar. */
  | { type: "READY" }
  /** Etapa de progreso durante la inicialización o el procesamiento. */
  | { type: "PROGRESS"; stage: string }
  /** Resultado JSON ya parseado devuelto por motor.process_obj. */
  | { type: "RESULT"; payload: unknown }
  /** Error en la inicialización o el procesamiento. */
  | { type: "ERROR"; error: string };

/** Versión de Pyodide a cargar desde el CDN. Mantener alineada con el devDep. */
export const PYODIDE_VERSION = "0.29.4";

/**
 * URL base (indexURL) del bundle oficial de Pyodide en jsDelivr.
 * Para producción/offline conviene self-hostear en `public/pyodide/` y apuntar aquí.
 */
export const PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
