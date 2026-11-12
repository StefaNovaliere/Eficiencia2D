"use client";

import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  HelpCircle,
  Layers,
  Minus,
  MoveHorizontal,
  XCircle,
  Zap,
} from "lucide-react";
import {
  medidaProblema,
  titularVerificacion,
  type AccionProblema,
  type EstadoVerificacion,
  type ProblemaVerificacion,
  type Verificacion,
} from "@/core/verificacion";
import { PRINT_SCALE_OPTIONS, formatPrintScaleRatio } from "@/core/print-scale";

/**
 * Veredicto de la verificación del backend: un titular y la lista corta de
 * problemas agrupados, cada uno con sus acciones. Reemplaza a la lista de
 * `assembly_warnings`, que salía de un chequeo sobre el modelo.
 *
 * `verificacion === null` es "no se pudo verificar": gris, nunca verde.
 */

const ESTADO_TEXTO: Record<EstadoVerificacion, string> = {
  ok: "text-success",
  revisar: "text-warning",
  no_arma: "text-error",
};

const ESTADO_FONDO: Record<EstadoVerificacion, string> = {
  ok: "bg-success/5",
  revisar: "bg-warning/5",
  no_arma: "bg-error/5",
};

function IconoTipo({ tipo, className }: { tipo: string; className: string }) {
  switch (tipo) {
    case "choque":
      return <Zap className={className} />;
    case "luz":
      return <MoveHorizontal className={className} />;
    case "superpuestas":
      return <Layers className={className} />;
    case "pieza_fina":
      return <Minus className={className} />;
    case "sin_cubrir":
      return <CircleDashed className={className} />;
    default:
      return <AlertTriangle className={className} />;
  }
}

export interface VerificacionPanelProps {
  verificacion: Verificacion | null;
  problemaActivoId?: number | null;
  onSeleccionar?: (id: number | null) => void;
  /** Una acción con `aplicar`: el caller la fusiona con la revisión y re-pide. */
  onAplicar?: (accion: AccionProblema, problema: ProblemaVerificacion) => void;
  /**
   * `escala_mas_fina`: cambiar a una escala más fina (denominador menor: la
   * placa de 3 mm ocupa menos edificio). Se ofrecen las dos siguientes.
   */
  onCambiarEscala?: (denominador: number) => void;
  /** Mientras se aplica una acción (re-pedido en curso): botones deshabilitados. */
  aplicando?: boolean;
  /** Sólo los problemas que no arman (paso de generación). */
  soloNoArma?: boolean;
}

export default function VerificacionPanel({
  verificacion,
  problemaActivoId = null,
  onSeleccionar,
  onAplicar,
  onCambiarEscala,
  aplicando = false,
  soloNoArma = false,
}: VerificacionPanelProps) {
  if (verificacion === null) {
    return (
      <div className="flex items-start gap-2 px-3 py-2 border-b border-base-300/30 bg-base-200/40">
        <HelpCircle className="w-3.5 h-3.5 text-base-content/50 shrink-0 mt-0.5" />
        <span className="text-xs leading-snug">
          <b className="font-medium text-base-content/70">No se pudo verificar la maqueta.</b>{" "}
          <span className="text-base-content/50">
            Las piezas se muestran, pero nadie comprobó que encajen.
          </span>
        </span>
      </div>
    );
  }

  const { veredicto } = verificacion;
  const estadoTitular: EstadoVerificacion = veredicto === "listo" ? "ok" : veredicto;
  const escalasMasFinas = PRINT_SCALE_OPTIONS.filter((d) => d < verificacion.escala)
    .slice(-2)
    .reverse();
  const problemas = soloNoArma
    ? verificacion.problemas.filter((p) => p.estado === "no_arma")
    : verificacion.problemas;

  return (
    <div className={`border-b border-base-300/30 ${ESTADO_FONDO[estadoTitular]}`}>
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-2">
        {veredicto === "listo" ? (
          <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
        ) : veredicto === "revisar" ? (
          <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
        ) : (
          <XCircle className="w-4 h-4 text-error shrink-0" />
        )}
        <div className="min-w-0">
          <p className={`text-xs font-semibold ${ESTADO_TEXTO[estadoTitular]}`}>
            {titularVerificacion(verificacion)}
          </p>
          <p className="text-[11px] text-base-content/50">
            {veredicto === "listo"
              ? "Todas las uniones encajan."
              : veredicto === "revisar"
                ? "Arma, pero hay uniones para mirar."
                : "Hay uniones que no arman: las piezas se pisan o no se tocan."}
          </p>
        </div>
      </div>

      {problemas.length > 0 && (
        <ul className="px-2 pb-2 space-y-1 max-h-[45vh] overflow-y-auto custom-scrollbar">
          {problemas.map((p) => {
            const activo = p.id === problemaActivoId;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onSeleccionar?.(activo ? null : p.id)}
                  className={`w-full text-left rounded-lg border px-2.5 py-1.5 transition-colors ${
                    activo
                      ? "border-primary/40 bg-base-100 ring-1 ring-primary/30"
                      : "border-transparent hover:bg-base-100/70"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <IconoTipo
                      tipo={p.tipo}
                      className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${ESTADO_TEXTO[p.estado]}`}
                    />
                    <span className="flex-1 text-[11px] leading-snug text-base-content/85">
                      {p.titulo}
                    </span>
                    <span
                      className="text-[10px] tabular-nums text-base-content/45 shrink-0"
                      title="Milímetros de plancha · centímetros de edificio"
                    >
                      {medidaProblema(p)}
                    </span>
                  </div>
                </button>

                {activo && (
                  <div className="mx-2.5 mb-1.5 mt-1 space-y-1.5">
                    {p.detalle && (
                      <p className="text-[11px] leading-snug text-base-content/60">{p.detalle}</p>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      {p.acciones.map((a, i) => {
                        const informativa = a.aplicar === null;
                        if (informativa && a.tipo === "revisar_modelo") {
                          // Ya está resaltado en el visor: el dato que necesita
                          // quien modela es la medida en el edificio.
                          return (
                            <span
                              key={i}
                              className="text-[10px] text-base-content/50 px-1 py-0.5"
                            >
                              {a.etiqueta}: {p.peorCmEdificio.toLocaleString("es-AR", {
                                maximumFractionDigits: 1,
                              })}{" "}
                              cm en {p.piezas.join(", ")}
                            </span>
                          );
                        }
                        if (informativa && a.tipo === "escala_mas_fina") {
                          if (!onCambiarEscala || escalasMasFinas.length === 0) return null;
                          return (
                            <span key={i} className="flex flex-wrap items-center gap-1">
                              <span className="text-[10px] text-base-content/50">{a.etiqueta}:</span>
                              {escalasMasFinas.map((d) => (
                                <button
                                  key={d}
                                  type="button"
                                  disabled={aplicando}
                                  onClick={() => onCambiarEscala(d)}
                                  className="btn btn-xs btn-ghost"
                                >
                                  {formatPrintScaleRatio(d)}
                                </button>
                              ))}
                            </span>
                          );
                        }
                        if (informativa) return null;
                        return (
                          <button
                            key={i}
                            type="button"
                            disabled={aplicando || !onAplicar}
                            onClick={() => onAplicar?.(a, p)}
                            className="btn btn-xs btn-outline btn-primary"
                          >
                            {a.etiqueta}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
