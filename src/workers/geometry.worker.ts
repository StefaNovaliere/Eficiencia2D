/// <reference lib="webworker" />
//
// Web Worker de geometría: aloja Pyodide (Python sobre WebAssembly) y ejecuta
// el motor geométrico (public/py/motor.py) fuera del hilo principal, para no
// congelar la UI de Next.js al procesar archivos .obj pesados.
//
// La inicialización de Pyodide es perezosa y "singleton": la primera vez que
// se necesita (al recibir PROCESS_OBJ, o llamada explícitamente al arrancar)
// se descarga el runtime + paquetes científicos + el motor, y las llamadas
// posteriores reutilizan la misma instancia.

import type { PyodideInterface } from "pyodide";
import {
  PYODIDE_INDEX_URL,
  type WorkerRequest,
  type WorkerResponse,
} from "./geometry.types";

// `self` en un Worker dedicado.
const ctx = self as unknown as DedicatedWorkerGlobalScope;

// `loadPyodide` se inyecta en el scope global del Worker al hacer importScripts
// del glue oficial de Pyodide. No existe en los tipos del DOM, así que lo
// declaramos manualmente.
declare function loadPyodide(options?: {
  indexURL?: string;
}): Promise<PyodideInterface>;

/** Envío tipado de mensajes hacia el hilo principal. */
function post(message: WorkerResponse): void {
  ctx.postMessage(message);
}

let pyodidePromise: Promise<PyodideInterface> | null = null;

/**
 * Inicializa Pyodide una sola vez: carga el runtime desde el CDN, los paquetes
 * científicos compilados (numpy/scipy/shapely → arrastra geos) y registra el
 * motor de Python. Devuelve la instancia lista para usar.
 */
function ensurePyodide(): Promise<PyodideInterface> {
  if (pyodidePromise) return pyodidePromise;

  pyodidePromise = (async () => {
    post({ type: "PROGRESS", stage: "Cargando runtime de Python (Pyodide)…" });
    // Worker clásico → importScripts disponible. Carga el glue JS de Pyodide.
    ctx.importScripts(`${PYODIDE_INDEX_URL}pyodide.js`);

    const pyodide = await loadPyodide({ indexURL: PYODIDE_INDEX_URL });

    post({ type: "PROGRESS", stage: "Cargando paquetes científicos (numpy/scipy/shapely)…" });
    await pyodide.loadPackage(["numpy", "scipy", "shapely"]);

    post({ type: "PROGRESS", stage: "Inicializando motor geométrico…" });
    // Cargamos el código del motor desde public/py y lo ejecutamos para
    // registrar `process_obj` en el namespace global de Python.
    const res = await fetch("/py/motor.py");
    if (!res.ok) {
      throw new Error(`No se pudo cargar /py/motor.py (HTTP ${res.status}).`);
    }
    const motorCode = await res.text();
    pyodide.runPython(motorCode);

    return pyodide;
  })();

  // Si falla, permitimos reintentar en la próxima llamada.
  pyodidePromise.catch(() => {
    pyodidePromise = null;
  });

  return pyodidePromise;
}

/** Procesa un string .obj a través del motor de Python y devuelve JSON parseado. */
async function processObj(objString: string): Promise<unknown> {
  const pyodide = await ensurePyodide();
  post({ type: "PROGRESS", stage: "Procesando geometría…" });

  const fn = pyodide.globals.get("process_obj");
  try {
    // motor.process_obj devuelve un string JSON.
    const jsonStr = fn(objString) as string;
    return JSON.parse(jsonStr);
  } finally {
    // Liberar el proxy de la función de Python para evitar fugas de memoria.
    fn?.destroy?.();
  }
}

ctx.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  switch (msg.type) {
    case "PROCESS_OBJ": {
      try {
        const result = await processObj(msg.payload.objString);
        post({ type: "RESULT", payload: result });
      } catch (err) {
        post({ type: "ERROR", error: err instanceof Error ? err.message : String(err) });
      }
      break;
    }
    default: {
      // Mensaje desconocido: lo ignoramos de forma segura.
      break;
    }
  }
};

// Arrancar la carga de Pyodide en cuanto se crea el Worker, de modo que para
// cuando el usuario suba un archivo el runtime ya esté (o casi) listo.
ensurePyodide()
  .then(() => post({ type: "READY" }))
  .catch((err) =>
    post({ type: "ERROR", error: err instanceof Error ? err.message : String(err) }),
  );
