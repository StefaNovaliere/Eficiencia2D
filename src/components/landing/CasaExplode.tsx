"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { CASA_EXPLODE_SVG, CASA_VIEWBOX } from "./casaExplodeSvg";

/**
 * Sección sticky con tres fases encadenadas al scroll:
 *
 *  1. EXPLODE  (p 0 → 0.45): crossfade de la capa armada (#assembled) a las piezas
 *     separables (#piece-*); cada pieza se desplaza por su vector (data-dx/dy) y se
 *     reordena por profundidad real (painter's dinámico) para mantener la oclusión.
 *  2. NEST     (p 0.45 → 0.85): migración literal — cada pieza viaja y se acomoda
 *     dentro de su plancha de corte. Pisos/losas → P1; paredes + carpinterías → P2.
 *  3. SETTLE   (p 0.85 → 1): las planchas quedan armadas y el pin se suelta hacia
 *     la sección "Recorrido".
 *
 * Los colores crema/tinta del SVG se sobrescriben por CSS (.casa-explode) para el tema.
 */

interface PieceRef {
  el: SVGGElement;
  dx: number;
  dy: number;
  d0: number;
  dr: number;
  name: string;
  depth: number;
  // bbox en coords del viewBox (sin transform propio)
  cx: number;
  cy: number;
  bw: number;
  bh: number;
  // destino en su plancha
  slotCx: number;
  slotCy: number;
  sTarget: number;
}

interface Plancha {
  x: number;
  y: number;
  w: number;
  h: number;
  cols: number;
  rows: number;
  label: string;
}

const SVG_NS = "http://www.w3.org/2000/svg";

// Dos planchas en coords del viewBox (1600 × 1442). Corridas a la derecha para no
// pisar la columna de copy (fija a la izquierda en desktop).
const P1: Plancha = { x: 330, y: 470, w: 500, h: 800, cols: 2, rows: 3, label: "P1 · pisos" };
const P2: Plancha = { x: 890, y: 405, w: 600, h: 920, cols: 3, rows: 4, label: "P2 · muros" };

const LEGEND = [
  "cimiento",
  "planta baja",
  "entrepiso",
  "planta alta",
  "techo",
  "carpinterías",
  "balcón",
  "acceso",
];

const FADE = 0.1; // tramo del crossfade armado -> piezas
const EXPLODE_END = 0.45; // fin de la separación
const NEST_END = 0.85; // fin de la migración a planchas

const ease = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Pisos/losas horizontales → P1; el resto (paredes + carpinterías) → P2. */
const isFloor = (name: string): boolean => /slab|foundation|step|canopy/.test(name);

/** Reparte una lista de piezas en la grilla de su plancha (row-major) y fija slot+escala. */
function assignGrid(list: PieceRef[], pl: Plancha): void {
  const padOuter = 34;
  const labelGap = 44; // reserva arriba para el rótulo
  const gap = 26;
  const cellW = (pl.w - padOuter * 2 - gap * (pl.cols - 1)) / pl.cols;
  const cellH = (pl.h - padOuter * 2 - labelGap - gap * (pl.rows - 1)) / pl.rows;
  const innerPad = 14;
  list.forEach((pc, i) => {
    const col = i % pl.cols;
    const row = Math.floor(i / pl.cols);
    const cellX = pl.x + padOuter + col * (cellW + gap);
    const cellY = pl.y + padOuter + labelGap + row * (cellH + gap);
    pc.slotCx = cellX + cellW / 2;
    pc.slotCy = cellY + cellH / 2;
    const fit = Math.min((cellW - innerPad * 2) / pc.bw, (cellH - innerPad * 2) / pc.bh);
    pc.sTarget = Math.min(Math.max(fit, 0.05), 1.25);
  });
}

export default function CasaExplode() {
  const sectionRef = useRef<HTMLElement>(null);
  const svgHostRef = useRef<HTMLDivElement>(null);
  const legendRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const host = svgHostRef.current;
    const section = sectionRef.current;
    if (!host || !section) return;

    // Inyección imperativa: el SVG vive fuera de la reconciliación de React, así los
    // re-render del padre no recrean/desconectan el subárbol que manipulamos por frame.
    host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${CASA_VIEWBOX}" role="img" aria-label="Casa que se descompone y migra a planchas de corte">${CASA_EXPLODE_SVG}</svg>`;

    const svgEl = host.querySelector("svg");
    if (!svgEl) return;
    const assembled = svgEl.querySelector<SVGGElement>("#assembled");

    const pieces: PieceRef[] = [
      ...svgEl.querySelectorAll<SVGGElement>('[id^="piece-"]'),
    ].map((el) => {
      const b = el.getBBox();
      return {
        el,
        dx: parseFloat(el.dataset.dx || "0"),
        dy: parseFloat(el.dataset.dy || "0"),
        d0: parseFloat(el.dataset.d0 || "0"),
        dr: parseFloat(el.dataset.dr || "0"),
        name: el.dataset.piece || el.id,
        depth: 0,
        cx: b.x + b.width / 2,
        cy: b.y + b.height / 2,
        bw: b.width || 1,
        bh: b.height || 1,
        slotCx: 0,
        slotCy: 0,
        sTarget: 1,
      };
    });

    // Slots: pisos en P1, todo lo demás en P2 (preservando orden de aparición).
    assignGrid(pieces.filter((p) => isFloor(p.name)), P1);
    assignGrid(pieces.filter((p) => !isFloor(p.name)), P2);

    // Capa de planchas (contorno punteado + rótulo), detrás de las piezas.
    const planchasG = document.createElementNS(SVG_NS, "g");
    planchasG.setAttribute("id", "planchas");
    planchasG.style.opacity = "0";
    for (const pl of [P1, P2]) {
      const rect = document.createElementNS(SVG_NS, "rect");
      rect.setAttribute("class", "plancha");
      rect.setAttribute("x", String(pl.x));
      rect.setAttribute("y", String(pl.y));
      rect.setAttribute("width", String(pl.w));
      rect.setAttribute("height", String(pl.h));
      rect.setAttribute("rx", "10");
      planchasG.appendChild(rect);
      const label = document.createElementNS(SVG_NS, "text");
      label.setAttribute("class", "plancha-label");
      label.setAttribute("x", String(pl.x + 30));
      label.setAttribute("y", String(pl.y + 44));
      label.textContent = pl.label;
      planchasG.appendChild(label);
    }
    svgEl.insertBefore(planchasG, svgEl.firstChild);

    const legendItems = legendRef.current
      ? [...legendRef.current.querySelectorAll("li")]
      : [];

    let lastKey = "";

    const render = (p: number) => {
      const eExp = ease(clamp01(p / EXPLODE_END));
      const pNest = clamp01((p - EXPLODE_END) / (NEST_END - EXPLODE_END));
      const eNest = ease(pNest);
      const fade = Math.min(1, p / FADE);

      // crossfade armado -> piezas, y aparición de planchas en la fase de nest
      if (assembled) assembled.style.opacity = String(1 - fade);
      planchasG.style.opacity = String(eNest);

      for (const g of pieces) {
        g.el.style.opacity = String(fade);
        // posición explotada del centroide y migración al slot de su plancha
        const exCx = g.cx + g.dx * eExp;
        const exCy = g.cy + g.dy * eExp;
        const tcx = lerp(exCx, g.slotCx, eNest);
        const tcy = lerp(exCy, g.slotCy, eNest);
        const s = lerp(1, g.sTarget, eNest);
        // escala sobre el origen + translate que reubica el centroide a (tcx,tcy)
        g.el.setAttribute(
          "transform",
          `translate(${tcx - s * g.cx},${tcy - s * g.cy}) scale(${s})`,
        );
        g.depth = g.d0 + g.dr * eExp;
      }

      // painter's dinámico solo durante el explode; congelado en el nest (evita parpadeo)
      if (pNest === 0) {
        const sorted = [...pieces].sort((a, b) => a.depth - b.depth);
        const key = sorted.map((g) => g.name).join(",");
        if (key !== lastKey) {
          for (const g of sorted) svgEl.appendChild(g.el);
          lastKey = key;
        }
      }
      if (assembled && fade < 1) svgEl.appendChild(assembled);

      // leyenda: se completa al terminar el explode
      legendItems.forEach((li, i) =>
        li.classList.toggle("on", clamp01(p / EXPLODE_END) >= (i / legendItems.length) * 0.9),
      );
    };

    gsap.registerPlugin(ScrollTrigger);
    const ctx = gsap.context(() => {
      ScrollTrigger.create({
        trigger: section,
        start: "top top",
        end: "+=380%",
        pin: true,
        scrub: 0.4,
        onUpdate: (self) => render(self.progress),
      });
    }, section);

    render(0);

    return () => {
      ctx.revert();
      host.innerHTML = "";
    };
  }, []);

  return (
    <section ref={sectionRef} className="casa-explode-section">
      <div className="casa-explode-copy">
        <p className="casa-explode-kicker">de la casa a la plancha</p>
        <h2 className="casa-explode-title">
          Una casa,
          <br />
          pieza por pieza.
        </h2>
        <p className="casa-explode-lead">
          Deslizá para descomponer el modelo: cada parte se separa y después viaja a su
          plancha de corte. Los pisos van a una, las paredes y carpinterías a otra.
        </p>
        <ul ref={legendRef} className="casa-explode-legend">
          {LEGEND.map((label) => (
            <li key={label}>
              <span className="casa-explode-dot" />
              {label}
            </li>
          ))}
        </ul>
      </div>

      <div className="casa-explode-stage">
        {/* El SVG se inyecta imperativamente en el efecto (ver useEffect). */}
        <div ref={svgHostRef} className="casa-explode" aria-hidden />
      </div>

      <div className="casa-explode-hint">
        <span className="animate-pulse">deslizá</span>
        <span className="casa-explode-hint-arrow">↓</span>
      </div>
    </section>
  );
}
