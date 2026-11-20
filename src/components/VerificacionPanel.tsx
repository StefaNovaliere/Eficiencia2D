"use client";

import { useState } from "react";
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
  claveHueco,
  claveNudo,
  claveProblema,
  medidaProblema,
  problemasSinNudo,
  titularVerificacion,
  tituloHueco,
  type AccionProblema,
  type EfectoAccion,
  type EfectosVerificacion,
  type EstadoVerificacion,
  type HuecoVerificacion,
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
  /**
   * Una acción con `aplicar`: el caller la fusiona con la revisión y re-pide.
   * `clave` e `indice` identifican el botón, para marcarlo mientras recalcula.
   * Un cambio de escala sin valor (`cambiar_escala` con `aplicar: null`, v1
   * `escala_mas_fina`) se ofrece con las dos escalas más finas y llega acá como
   * una acción con `scale_denom`: así pasa por el mismo antes/después.
   */
  onAplicar?: (accion: AccionProblema, clave: string, indice: number) => void;
  /**
   * El botón que se tocó y está recalculando (§3.1). Mientras haya uno, los
   * demás se deshabilitan y la cabecera lo dice: gris sin explicación parece
   * trabado.
   */
  enCurso?: { clave: string; indice: number } | null;
  /**
   * Efecto previsto de cada acción, por `accion.id` (§3.2): el botón dice qué
   * va a pasar antes de tocarlo. Se va completando; sin entrada, el botón
   * funciona igual.
   */
  efectos?: EfectosVerificacion | null;
  /** Sólo lo que no arma (paso de generación y 409). */
  soloNoArma?: boolean;
}

const EFECTO_TEXTO: Record<EfectoAccion["resultado"], string> = {
  mejora: "text-success",
  igual: "text-base-content/45",
  empeora: "text-error",
  desconocido: "text-base-content/45",
};

export default function VerificacionPanel({
  verificacion,
  seleccion = null,
  onSeleccionar,
  onAplicar,
  enCurso = null,
  efectos = null,
  soloNoArma = false,
}: VerificacionPanelProps) {
  const aplicando = enCurso !== null;
  // Plegados (§2.6: en un modelo grande son ~100). Se abren solos si lo
  // seleccionado es un hueco, por ejemplo al volver a encontrarlo tras una acción.
  const [verHuecos, setVerHuecos] = useState(false);
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

  const marcaEnCurso = (
    <span className="inline-flex items-center gap-1">
      <span className="loading loading-spinner loading-xs" />
      Recalculando…
    </span>
  );

  /** El id de la única acción con efecto "mejora" entre las de un lugar, si es una sola. */
  const unicaQueMejora = (acciones: AccionProblema[]): string | null => {
    const mejoran = acciones.filter(
      (a) => a.id && efectos?.efectos.get(a.id)?.resultado === "mejora",
    );
    return mejoran.length === 1 ? (mejoran[0].id ?? null) : null;
  };

  const accionesDe = (
    clave: string,
    acciones: AccionProblema[],
    peorCm: number,
    piezas: string[],
  ) => (
    <div className="flex flex-wrap items-start gap-1.5">
      {acciones.map((a, i) => {
        const tocado = enCurso?.clave === clave && enCurso.indice === i;
        if (a.aplicar) {
          const efecto = a.id ? efectos?.efectos.get(a.id) : undefined;
          // Se está calculando: el backend prevé las acciones "para decidir",
          // no los cambios de escala.
          const previendo =
            !efecto && !!a.id && !!efectos && !efectos.listo && !a.aplicar.scale_denom;
          // Si una sola acción de este lugar mejora, es la que conviene: se destaca.
          const destacar = efecto?.resultado === "mejora" && unicaQueMejora(acciones) === a.id;
          return (
            <span key={i} className="flex flex-col items-start gap-0.5 max-w-full">
              <button
                type="button"
                disabled={aplicando || !onAplicar}
                onClick={() => onAplicar?.(a, clave, i)}
                className={`btn btn-xs btn-primary ${destacar ? "" : "btn-outline"} ${
                  // Atenuado, no deshabilitado: la decisión sigue siendo de la persona.
                  efecto?.resultado === "empeora" ? "opacity-50" : ""
                }`}
              >
                {tocado ? marcaEnCurso : a.etiqueta}
              </button>
              {efecto?.texto ? (
                <span className={`px-1 text-[10px] leading-tight ${EFECTO_TEXTO[efecto.resultado]}`}>
                  {efecto.texto}
                </span>
              ) : previendo ? (
                <span
                  className="px-1 text-[10px] leading-tight text-base-content/35"
                  title="Calculando qué pasa si se aplica. El botón funciona igual."
                >
                  <span className="loading loading-dots loading-xs align-middle" />
                </span>
              ) : null}
            </span>
          );
        }
        if (a.tipo === "cambiar_escala" || a.tipo === "escala_mas_fina") {
          if (!onAplicar || escalasMasFinas.length === 0) return null;
          return (
            <span key={i} className="flex flex-wrap items-center gap-1">
              <span className="text-[10px] text-base-content/50">{a.etiqueta}:</span>
              {tocado ? (
                <span className="btn btn-xs btn-ghost btn-disabled">{marcaEnCurso}</span>
              ) : (
                escalasMasFinas.map((d) => (
                  <button
                    key={d}
                    type="button"
                    disabled={aplicando}
                    onClick={() =>
                      onAplicar(
                        {
                          tipo: "cambiar_escala",
                          etiqueta: `Probar a ${formatPrintScaleRatio(d)}`,
                          aplicar: { scale_denom: d },
                        },
                        clave,
                        i,
                      )
                    }
                    className="btn btn-xs btn-ghost"
                  >
                    {formatPrintScaleRatio(d)}
                  </button>
                ))
              )}
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
    item: { titulo: string; estado: EstadoVerificacion | null; peorMm: number; peorCmEdificio: number },
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
            <IconoTipo
              tipo={tipo}
              className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${item.estado ? ESTADO_TEXTO[item.estado] : "text-info"}`}
            />
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

  const fichaNudo = (n: NudoVerificacion, clave: string) => (
    <>
      {n.detalle && <DetalleNudoSvg detalle={n.detalle} escala={verificacion.escala} />}
      {n.quienTexto && <p className="text-[11px] leading-snug text-base-content/60">{n.quienTexto}</p>}
      {accionesDe(clave, n.acciones, n.peorCmEdificio, n.piezas)}
    </>
  );

  // Sin acciones: un hueco se arregla en el modelo (§2.6).
  const fichaHueco = (h: HuecoVerificacion) => (
    <>
      <p className="text-[11px] leading-snug text-base-content/75">{h.texto}</p>
      <p className="text-[11px] leading-snug text-base-content/55">{h.pregunta}</p>
    </>
  );

  const fichaProblema = (p: ProblemaVerificacion, clave: string) => (
    <>
      {(p.quienTexto || p.detalle) && (
        <p className="text-[11px] leading-snug text-base-content/60">{p.quienTexto ?? p.detalle}</p>
      )}
      {p.detalle && p.quienTexto && (
        <p className="text-[11px] leading-snug text-base-content/45">{p.detalle}</p>
      )}
      {accionesDe(clave, p.acciones, p.peorCmEdificio, p.piezas)}
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
          {aplicando && (
            <p className="text-[11px] text-primary flex items-center gap-1">
              <span className="loading loading-spinner loading-xs" />
              Recalculando la verificación… puede tardar unos segundos.
            </p>
          )}
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
                    {nudos.map((n) =>
                      fila(claveNudo(n.id), n, n.tipos[0] ?? "", fichaNudo(n, claveNudo(n.id))),
                    )}
                    {sueltos.map((p) =>
                      fila(claveProblema(p.id), p, p.tipo, fichaProblema(p, claveProblema(p.id))),
                    )}
                  </ul>
                </section>
              );
            })}

            {!soloNoArma && verificacion.huecos.length > 0 && (
              <section className="px-2 pt-2">
                <button
                  type="button"
                  aria-expanded={verHuecos || seleccion?.startsWith("h:")}
                  onClick={() => setVerHuecos((v) => !v)}
                  className="w-full flex items-center gap-1 px-1 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-base-content/50"
                >
                  <ChevronRight
                    className={`w-3 h-3 transition-transform ${
                      verHuecos || seleccion?.startsWith("h:") ? "rotate-90" : ""
                    }`}
                  />
                  Huecos que quedan en la maqueta{" "}
                  <span className="font-normal">({verificacion.huecos.length})</span>
                </button>
                {(verHuecos || seleccion?.startsWith("h:")) && (
                  <>
                    <p className="px-1 pb-1 text-[11px] leading-snug text-base-content/50">
                      Puede ser diseño (un vano, una junta) o un error del modelo. Revisalos antes de
                      cortar.
                    </p>
                    <ul className="space-y-1">
                      {verificacion.huecos.map((h) =>
                        fila(
                          claveHueco(h.id),
                          {
                            titulo: tituloHueco(h),
                            estado: null,
                            peorMm: h.medidaMm,
                            peorCmEdificio: h.medidaCmEdificio,
                          },
                          "luz",
                          fichaHueco(h),
                        ),
                      )}
                    </ul>
                  </>
                )}
              </section>
            )}

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
              fila(claveProblema(p.id), p, p.tipo, fichaProblema(p, claveProblema(p.id))),
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
