"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { CASA_EXPLODE_SVG, CASA_VIEWBOX } from "./casaExplodeSvg";

/**
 * Sección sticky que "explota" el SVG de la casa al scrollear. Porta el runtime
 * vanilla de `casa_moderna_landing.html` al patrón GSAP ScrollTrigger del landing:
 *
 *  - crossfade de la capa armada (#assembled, oclusión correcta) hacia las piezas
 *    separables (#piece-*),
 *  - cada pieza se desplaza por su vector 2D (data-dx/dy),
 *  - painter's dinámico: las piezas se reordenan en el DOM por profundidad real
 *    (d0 + dr*e) en cada frame para mantener la oclusión.
 *
 * Los colores crema/tinta del SVG se sobrescriben por CSS (.casa-explode) para
 * adaptarlo al tema neón.
 */

interface PieceRef {
  el: SVGGElement;
  dx: number;
  dy: number;
  d0: number;
  dr: number;
  name: string;
  depth: number;
}

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

const FADE = 0.1; // tramo de scroll para el crossfade armado -> piezas
const ease = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export default function CasaExplode() {
  const sectionRef = useRef<HTMLElement>(null);
  const svgHostRef = useRef<HTMLDivElement>(null);
  const legendRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const host = svgHostRef.current;
    const section = sectionRef.current;
    if (!host || !section) return;

    // Inyectamos el SVG de forma imperativa (no via dangerouslySetInnerHTML) para
    // que viva fuera de la reconciliación de React: así los re-render del padre no
    // recrean/desconectan el subárbol mientras lo manipulamos por frame.
    host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${CASA_VIEWBOX}" role="img" aria-label="Casa descompuesta pieza por pieza">${CASA_EXPLODE_SVG}</svg>`;

    const svgEl = host.querySelector("svg");
    if (!svgEl) return;
    const assembled = svgEl.querySelector<SVGGElement>("#assembled");
    const pieces: PieceRef[] = [
      ...svgEl.querySelectorAll<SVGGElement>('[id^="piece-"]'),
    ].map((el) => ({
      el,
      dx: parseFloat(el.dataset.dx || "0"),
      dy: parseFloat(el.dataset.dy || "0"),
      d0: parseFloat(el.dataset.d0 || "0"),
      dr: parseFloat(el.dataset.dr || "0"),
      name: el.dataset.piece || el.id,
      depth: 0,
    }));
    const legendItems = legendRef.current
      ? [...legendRef.current.querySelectorAll("li")]
      : [];

    let lastKey = "";

    const render = (p: number) => {
      const e = ease(p);
      // crossfade: capa armada (oclusión correcta) -> piezas (separables)
      const fade = Math.min(1, p / FADE);
      if (assembled) assembled.style.opacity = String(1 - fade);
      // 1) explode: desplazar cada pieza y calcular su profundidad actual
      for (const g of pieces) {
        g.el.style.opacity = String(fade);
        g.el.setAttribute("transform", `translate(${g.dx * e},${g.dy * e})`);
        g.depth = g.d0 + g.dr * e;
      }
      // 2) painter's dinámico: reordenar <g> por profundidad (lejos -> cerca)
      const sorted = [...pieces].sort((a, b) => a.depth - b.depth);
      const key = sorted.map((g) => g.name).join(",");
      if (key !== lastKey) {
        for (const g of sorted) svgEl.appendChild(g.el);
        lastKey = key;
      }
      // mantener la capa armada arriba mientras sea visible
      if (assembled && fade < 1) svgEl.appendChild(assembled);
      // 3) leyenda con stagger
      legendItems.forEach((li, i) =>
        li.classList.toggle("on", p >= (i / legendItems.length) * 0.9),
      );
    };

    gsap.registerPlugin(ScrollTrigger);
    const ctx = gsap.context(() => {
      ScrollTrigger.create({
        trigger: section,
        start: "top top",
        end: "+=300%",
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
        <p className="casa-explode-kicker">así se arma</p>
        <h2 className="casa-explode-title">
          Una casa,
          <br />
          pieza por pieza.
        </h2>
        <p className="casa-explode-lead">
          Deslizá para descomponer el modelo. Cada parte se proyecta desde el .obj
          con eliminación de líneas ocultas; el orden de profundidad se recalcula en
          cada frame.
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
