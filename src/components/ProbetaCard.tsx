"use client";

import { useState } from "react";
import { Ruler } from "lucide-react";
import { base64ToBlob, fetchProbeta, type ProbetaResponse } from "@/services/api";

/**
 * Probeta de calibración (CONTRATO_verificacion.md §6): tres piezas en una
 * plancha de 12 × 8 cm para medir la placa y el láser ANTES de cortar la
 * maqueta. No depende del modelo. Las instrucciones del backend se muestran
 * tal cual: son las que explican cómo leer el resultado.
 */
export default function ProbetaCard({ token }: { token?: string | null }) {
  const [probeta, setProbeta] = useState<ProbetaResponse | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");

  const descargar = async () => {
    setCargando(true);
    setError("");
    try {
      const p = probeta ?? (await fetchProbeta({}, token));
      setProbeta(p);
      const url = URL.createObjectURL(base64ToBlob(p.zipBase64));
      const a = document.createElement("a");
      a.href = url;
      a.download = p.zipFilename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo descargar la probeta.");
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="rounded-xl border border-base-300/60 bg-base-100 px-4 py-3 text-sm">
      <div className="flex items-start gap-3">
        <Ruler className="w-4 h-4 text-primary shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="font-medium">¿Primera vez con esta placa o esta máquina?</p>
          <p className="text-xs text-base-content/60 mt-0.5">
            Cortá primero la probeta de calibración: 12 × 8 cm, tres piezas para ver qué
            ranura entra justa y cuánto material quita el láser.
          </p>
          <button
            type="button"
            className="btn btn-xs btn-outline mt-2"
            onClick={() => void descargar()}
            disabled={cargando}
          >
            {cargando ? "Preparando…" : probeta ? "Descargar de nuevo" : "Descargar probeta"}
          </button>
          {error && <p className="text-xs text-error mt-1.5">{error}</p>}
          {probeta && (
            <div className="mt-3 space-y-2">
              <ol className="list-decimal pl-4 space-y-1 text-xs text-base-content/75">
                {probeta.instrucciones.pasos.map((paso, i) => (
                  <li key={i}>{paso}</li>
                ))}
              </ol>
              {probeta.instrucciones.lectura && (
                <p className="text-xs text-base-content/60 border-l-2 border-primary/30 pl-2">
                  {probeta.instrucciones.lectura}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
