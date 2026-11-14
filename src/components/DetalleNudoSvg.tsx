"use client";

import type { DetalleNudo, EstadoVerificacion } from "@/core/verificacion";

/**
 * Dibujo 2D de un nudo (CONTRATO_verificacion v2 §2.2.1): el corte de las
 * placas por un plano perpendicular a la unión. No depende de la cámara 3D: es
 * lo que se lee de un vistazo — dónde se pisan dos placas y cuánto.
 *
 * Coordenadas `[a, b]` en metros de edificio con el origen en el nudo. El SVG
 * tiene el eje Y hacia abajo, así que `b` se invierte al dibujar (en un corte,
 * `b` apunta hacia arriba del edificio). Las medidas de las cotas vienen de la
 * medición exacta de la unión y se muestran tal cual: no se recalculan del
 * dibujo.
 */

const RELLENO: Record<EstadoVerificacion | "contexto", string> = {
  ok: "#22c55e",
  revisar: "#eab308",
  no_arma: "#ef4444",
  contexto: "#94a3b8",
};

export default function DetalleNudoSvg({
  detalle,
  escala,
}: {
  detalle: DetalleNudo;
  /** Denominador de la escala, para la nota de tamaño en plancha. */
  escala: number;
}) {
  const v = detalle.ventanaM;
  const t = (p: [number, number]) => [p[0], -p[1]] as const;
  const puntos = (pol: Array<[number, number]>) => pol.map((p) => t(p).join(",")).join(" ");
  const fuente = v * 0.075;
  const trazo = v * 0.006;
  const ladoPlanchaMm = ((2 * v * 1000) / Math.max(escala, 1)).toLocaleString("es-AR", {
    maximumFractionDigits: 0,
  });

  return (
    <figure className="m-0 mx-auto max-w-[240px]">
      <svg
        viewBox={`${-v} ${-v} ${2 * v} ${2 * v}`}
        className="w-full aspect-square rounded-lg bg-base-200/60 border border-base-300/40"
        role="img"
        aria-label={`Detalle en ${detalle.vista} del nudo`}
      >
        <defs>
          <pattern
            id="rayado-solape"
            patternUnits="userSpaceOnUse"
            width={v * 0.06}
            height={v * 0.06}
            patternTransform="rotate(45)"
          >
            <rect width={v * 0.06} height={v * 0.06} fill="#ef4444" fillOpacity={0.35} />
            <line x1={0} y1={0} x2={0} y2={v * 0.06} stroke="#b91c1c" strokeWidth={v * 0.02} />
          </pattern>
        </defs>

        {/* Ejes del nudo: orientan sin competir con las placas. */}
        <line x1={-v} y1={0} x2={v} y2={0} stroke="currentColor" strokeOpacity={0.08} strokeWidth={trazo} />
        <line x1={0} y1={-v} x2={0} y2={v} stroke="currentColor" strokeOpacity={0.08} strokeWidth={trazo} />

        {detalle.placas.map((p, i) => (
          <polygon
            key={`p-${i}`}
            points={puntos(p.poligono)}
            fill={RELLENO[p.estado]}
            fillOpacity={p.estado === "contexto" ? 0.35 : 0.55}
            stroke={RELLENO[p.estado]}
            strokeWidth={trazo}
          />
        ))}

        {detalle.solapes.map((s, i) => (
          <polygon
            key={`s-${i}`}
            points={puntos(s.poligono)}
            fill="url(#rayado-solape)"
            stroke="#b91c1c"
            strokeWidth={trazo * 1.5}
          />
        ))}

        {detalle.placas.map((p, i) => {
          const [x, y] = t(p.centro);
          return (
            <text
              key={`l-${i}`}
              x={x}
              y={y}
              fontSize={fuente}
              textAnchor="middle"
              dominantBaseline="central"
              fontFamily="ui-monospace, monospace"
              fontWeight={700}
              fill="currentColor"
              fillOpacity={p.estado === "contexto" ? 0.55 : 0.95}
            >
              {p.pieza}
            </text>
          );
        })}

        {detalle.cotas.map((c, i) => {
          const [x1, y1] = t(c.desde);
          const [x2, y2] = t(c.hasta);
          const punto = x1 === x2 && y1 === y2;
          const gx = (x1 + x2) / 2 + fuente * 0.6;
          const gy = (y1 + y2) / 2 - fuente * 0.9;
          return (
            <g key={`c-${i}`}>
              {!punto && (
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#111827" strokeWidth={trazo * 1.5} />
              )}
              <circle cx={x1} cy={y1} r={trazo * 2} fill="#111827" />
              {!punto && <circle cx={x2} cy={y2} r={trazo * 2} fill="#111827" />}
              <rect
                x={gx - fuente * 0.2}
                y={gy - fuente * 0.75}
                width={fuente * (c.texto.length * 0.62 + 0.4)}
                height={fuente * 1.1}
                rx={fuente * 0.25}
                fill="#111827"
                fillOpacity={0.85}
              />
              <text x={gx} y={gy} fontSize={fuente * 0.85} fill="#fff" fontWeight={600}>
                {c.texto}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-1 text-[10px] text-base-content/45">
        {detalle.vista === "planta" ? "Planta" : "Corte"} · ventana de {2 * v} m de edificio ({ladoPlanchaMm} mm de
        plancha) · rayado: material que ocupan dos placas a la vez
      </figcaption>
    </figure>
  );
}
