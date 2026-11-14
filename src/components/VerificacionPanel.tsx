"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  HelpCircle,
  Layers,
  Minus,
  MoveHorizontal,
  XCircle,
  Zap,
} from "lucide-react";
import {
  claveNudo,
  claveProblema,
  medidaProblema,
  problemasSinNudo,
  titularVerificacion,
  type AccionProblema,
  type EstadoVerificacion,
  type NudoVerificacion,
  type ProblemaVerificacion,
  type Quien,
  type Verificacion,
} from "@/core/verificacion";
import { PRINT_SCALE_OPTIONS, formatPrintScaleRatio } from "@/core/print-scale";
import DetalleNudoSvg from "@/components/DetalleNudoSvg";

/**
 * Veredicto de la verificación del backend.
 *
 * v2 (CONTRATO_verificacion §8): un titular, la lista de NUDOS — lugares donde
 * algo falla — en tres bloques según quién lo arregla, una ficha por nudo con
 * su dibujo 2D, y los avisos de terminación aparte, plegados.
 * v1: la lista de problemas agrupados por causa.
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

const BLOQUES: Array<{ quien: Quien; titulo: string; ayuda: string }> = [
  { quien: "decidir", titulo: "Para decidir", ayuda: "Una decisión tuya cambia el resultado." },
  {
    quien: "escala",
    titulo: "Depende de la escala",
    ayuda: "Sale de cuánto edificio ocupa la placa a esta escala.",
  },
  {
    quien: "modelo",
    titulo: "Para corregir en el modelo",
    ayuda: "No encontramos un arreglo automático: conviene revisar el 3D en esa zona.",
  },
];

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
  /** Clave del nudo o problema abierto (`n:3`, `p:4`). */
  seleccion?: string | null;
  onSeleccionar?: (clave: string | null) => void;
  /** Una acción con `aplicar`: el caller la fusiona con la revisión y re-pide. */
  onAplicar?: (accion: AccionProblema) => void;
  /**
   * Cambio de escala sin valor (v2 `cambiar_escala` con `aplicar: null`, v1
   * `escala_mas_fina`): se ofrecen las dos escalas más finas.
   */
  onCambiarEscala?: (denominador: number) => void;
  /** Mientras se re-verifica: botones deshabilitados. */
  aplicando?: boolean;
  /** Sólo lo que no arma (paso de generación y 409). */
  soloNoArma?: boolean;
}

export default function VerificacionPanel({
  verificacion,
  seleccion = null,
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
  const esV2 = verificacion.version >= 2;
  const escalasMasFinas = PRINT_SCALE_OPTIONS.filter((d) => d < verificacion.escala)
    .slice(-2)
    .reverse();

  const accionesDe = (acciones: AccionProblema[], peorCm: number, piezas: string[]) => (
    <div className="flex flex-wrap gap-1.5">
      {acciones.map((a, i) => {
        if (a.aplicar) {
          return (
            <button
              key={i}
              type="button"
              disabled={aplicando || !onAplicar}
              onClick={() => onAplicar?.(a)}
              className="btn btn-xs btn-outline btn-primary"
            >
              {a.etiqueta}
            </button>
          );
        }
        if (a.tipo === "cambiar_escala" || a.tipo === "escala_mas_fina") {
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
        if (a.tipo === "revisar_modelo") {
          // Informativa: lo que necesita quien modela es la medida en edificio.
          return (
            <span key={i} className="text-[10px] text-base-content/50 px-1 py-0.5">
              {a.etiqueta}: {peorCm.toLocaleString("es-AR", { maximumFractionDigits: 1 })} cm en{" "}
              {piezas.join(", ")}
            </span>
          );
        }
        return null;
      })}
    </div>
  );

  const fila = (
    clave: string,
    item: { titulo: string; estado: EstadoVerificacion; peorMm: number; peorCmEdificio: number },
    tipo: string,
    ficha: React.ReactNode,
  ) => {
    const activo = clave === seleccion;
    return (
      <li key={clave}>
        <button
          type="button"
          onClick={() => onSeleccionar?.(activo ? null : clave)}
          className={`w-full text-left rounded-lg border px-2.5 py-1.5 transition-colors ${
            activo
              ? "border-primary/40 bg-base-100 ring-1 ring-primary/30"
              : "border-transparent hover:bg-base-100/70"
          }`}
        >
          <div className="flex items-start gap-2">
            <IconoTipo tipo={tipo} className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${ESTADO_TEXTO[item.estado]}`} />
            <span className="flex-1 text-[11px] leading-snug text-base-content/85">{item.titulo}</span>
            <span
              className="text-[10px] tabular-nums text-base-content/45 shrink-0"
              title="Milímetros de plancha · centímetros de edificio"
            >
              {medidaProblema(item)}
            </span>
          </div>
        </button>
        {activo && <div className="mx-2.5 mb-2 mt-1.5 space-y-2">{ficha}</div>}
      </li>
    );
  };

  const fichaNudo = (n: NudoVerificacion) => (
    <>
      {n.detalle && <DetalleNudoSvg detalle={n.detalle} escala={verificacion.escala} />}
      {n.quienTexto && <p className="text-[11px] leading-snug text-base-content/60">{n.quienTexto}</p>}
      {accionesDe(n.acciones, n.peorCmEdificio, n.piezas)}
    </>
  );

  const fichaProblema = (p: ProblemaVerificacion) => (
    <>
      {(p.quienTexto || p.detalle) && (
        <p className="text-[11px] leading-snug text-base-content/60">{p.quienTexto ?? p.detalle}</p>
      )}
      {p.detalle && p.quienTexto && (
        <p className="text-[11px] leading-snug text-base-content/45">{p.detalle}</p>
      )}
      {accionesDe(p.acciones, p.peorCmEdificio, p.piezas)}
    </>
  );

  const filtro = <T extends { estado: EstadoVerificacion }>(xs: T[]) =>
    soloNoArma ? xs.filter((x) => x.estado === "no_arma") : xs;

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

      <div className="max-h-[55vh] overflow-y-auto custom-scrollbar pb-2">
        {esV2 ? (
          <>
            {BLOQUES.map((b) => {
              const nudos = filtro(verificacion.nudos.filter((n) => n.quien === b.quien));
              const sueltos = filtro(problemasSinNudo(verificacion).filter((p) => p.quien === b.quien));
              if (nudos.length + sueltos.length === 0) return null;
              return (
                <section key={b.quien} className="px-2 pt-1">
                  <h4
                    className="px-1 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-base-content/50"
                    title={b.ayuda}
                  >
                    {b.titulo} <span className="font-normal">({nudos.length + sueltos.length})</span>
                  </h4>
                  <ul className="space-y-1">
                    {nudos.map((n) => fila(claveNudo(n.id), n, n.tipos[0] ?? "", fichaNudo(n)))}
                    {sueltos.map((p) => fila(claveProblema(p.id), p, p.tipo, fichaProblema(p)))}
                  </ul>
                </section>
              );
            })}

            {!soloNoArma && verificacion.terminaciones.length > 0 && (
              <details className="px-3 pt-2 group">
                <summary className="flex items-center gap-1 cursor-pointer list-none text-[11px] text-base-content/55">
                  <ChevronRight className="w-3 h-3 transition-transform group-open:rotate-90" />
                  Avisos de terminación: no impiden armar ({verificacion.terminaciones.length})
                </summary>
                <ul className="mt-1 space-y-0.5 pl-4">
                  {verificacion.terminaciones.map((t) => (
                    <li key={t.id} className="text-[11px] leading-snug text-base-content/55">
                      {t.titulo}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        ) : (
          <ul className="px-2 space-y-1">
            {filtro(verificacion.problemas).map((p) =>
              fila(claveProblema(p.id), p, p.tipo, fichaProblema(p)),
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
