"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { CASA_EXPLODE_SVG, CASA_VIEWBOX } from "./casaExplodeSvg";

/**
 * Sección sticky con tres fases encadenadas al scroll:
 *
 *  1. EXPLODE (p 0 → 0.40): crossfade de la capa armada (#assembled) a las piezas
 *     separables; cada pieza se separa por su vector (data-dx/dy) con painter's dinámico.
 *  2. VUELO/NEST (p 0.40 → 1): cada pieza vuela escalonada por un arco (con giro y traza
 *     de polvo neón) hacia su plancha de corte y, al aterrizar, se convierte en panel(es)
 *     vector 2D planos. Pisos/losas → P1; paredes + carpinterías → P2.
 *
 * Importante: el .obj agrupa las paredes de cada piso como UNA caja (ground_wall /
 * upper_wall). En una plancha real cada pared es un componente aparte, así que esas
 * piezas-caja se descomponen en varios paneles (frente, contrafrente, 2 laterales)
 * agrupados juntos. Las losas y carpinterías sí son un único panel.
 *
 * El layout se escala para entrar completo en pantallas de laptop (ver CSS).
 */

interface LocalPanel {
  ox: number;
  oy: number;
  w: number;
  h: number;
  el: SVGGElement;
}

interface PieceRef {
  el: SVGGElement;
  panels: LocalPanel[];
  dust: SVGCircleElement[];
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
  // super-celda destino (centro = blanco del vuelo) + parámetros de vuelo
  scCx: number;
  scCy: number;
  isoK: number; // escala de la pieza iso para encajar en su super-celda
  ctrlX: number;
  ctrlY: number;
  startT: number;
  spin: number;
}

interface Plancha {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}

const SVG_NS = "http://www.w3.org/2000/svg";

// Dos planchas en coords del viewBox (1600 × 1442), corridas a la derecha para no pisar
// la columna de copy (fija a la izquierda en desktop).
const P1: Plancha = { x: 320, y: 470, w: 470, h: 820, label: "P1 · pisos" };
const P2: Plancha = { x: 840, y: 235, w: 690, h: 1095, label: "P2 · muros" };

const PAD = 32; // margen interno de la plancha
const LABEL_GAP = 52; // reserva arriba para el rótulo
const GAP = 9; // separación entre paneles (≈ 3 mm en escala del dibujo)

// Una pieza-caja de paredes se descompone en 4 paneles: frente, contrafrente, 2 laterales.
const WALL_PANELS = [
  { w: 372, h: 226 },
  { w: 372, h: 226 },
  { w: 256, h: 226 },
  { w: 256, h: 226 },
];

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
const EXPLODE_END = 0.4; // fin de la separación; el vuelo ocupa [0.40, 1]
const STAGGER_SPAN = 0.5; // dispersión de arranques del vuelo (en pNest)
const FLIGHT_DUR = 0.46; // duración del vuelo de cada pieza (en pNest)
const N_DUST = 7;
const TAIL_STEP = 0.052;

const ease = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Pisos/losas horizontales → P1; el resto (paredes + carpinterías) → P2. */
const isFloor = (name: string): boolean => /slab|foundation|step|canopy/.test(name);
const isWallBox = (name: string): boolean => /wall/.test(name);

/** Layout local (raw) de los paneles que produce una pieza. Paredes → 2×2; resto → 1. */
function buildPanels(p: PieceRef): { scW: number; scH: number; local: { ox: number; oy: number; w: number; h: number }[] } {
  if (isWallBox(p.name)) {
    const cols = 2;
    const cellW = Math.max(...WALL_PANELS.map((w) => w.w));
    const cellH = Math.max(...WALL_PANELS.map((w) => w.h));
    const scW = cols * cellW + GAP * (cols - 1);
    const scH = 2 * cellH + GAP;
    const local = WALL_PANELS.map((pan, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      return {
        ox: c * (cellW + GAP) + (cellW - pan.w) / 2,
        oy: r * (cellH + GAP) + (cellH - pan.h) / 2,
        w: pan.w,
        h: pan.h,
      };
    });
    return { scW, scH, local };
  }
  return { scW: p.bw, scH: p.bh, local: [{ ox: 0, oy: 0, w: p.bw, h: p.bh }] };
}

/**
 * Empaquetado por estantes (shelf packing) de super-celdas: ordena por alto desc y baja
 * la escala global hasta que entra en el área útil. Conserva proporciones reales.
 */
function packShelf(
  items: { w: number; h: number; ref: PieceRef }[],
  innerW: number,
  innerH: number,
): { k: number; placed: { ref: PieceRef; x: number; y: number; w: number; h: number }[] } {
  const sorted = [...items].sort((a, b) => b.h - a.h);
  for (let k = 1; k > 0.04; k *= 0.94) {
    const placed: { ref: PieceRef; x: number; y: number; w: number; h: number }[] = [];
    let x = 0;
    let y = 0;
    let rowH = 0;
    let ok = true;
    for (const it of sorted) {
      const w = it.w * k;
      const h = it.h * k;
      if (w > innerW) {
        ok = false;
        break;
      }
      if (x + w > innerW) {
        x = 0;
        y += rowH + GAP;
        rowH = 0;
      }
      if (y + h > innerH) {
        ok = false;
        break;
      }
      placed.push({ ref: it.ref, x, y, w, h });
      x += w + GAP;
      rowH = Math.max(rowH, h);
    }
    if (ok) return { k, placed };
  }
  return { k: 0.05, placed: [] };
}

/** Posición del centroide a lo largo del arco de vuelo (Bézier cuadrática). */
function bezier(t: number, p0: number, c: number, p1: number): number {
  const u = 1 - t;
  return u * u * p0 + 2 * u * t * c + t * t * p1;
}

export default function CasaExplode() {
  const sectionRef = useRef<HTMLElement>(null);
  const svgHostRef = useRef<HTMLDivElement>(null);
  const legendRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const host = svgHostRef.current;
    const section = sectionRef.current;
    if (!host || !section) return;

    // Inyección imperativa: el SVG vive fuera de la reconciliación de React.
    host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${CASA_VIEWBOX}" role="img" aria-label="Casa que se descompone y vuela a planchas de corte">${CASA_EXPLODE_SVG}</svg>`;

    const svgEl = host.querySelector("svg");
    if (!svgEl) return;
    const assembled = svgEl.querySelector<SVGGElement>("#assembled");

    const pieces: PieceRef[] = [
      ...svgEl.querySelectorAll<SVGGElement>('[id^="piece-"]'),
    ].map((el) => {
      const b = el.getBBox();
      return {
        el,
        panels: [],
        dust: [],
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
        scCx: 0,
        scCy: 0,
        isoK: 1,
        ctrlX: 0,
        ctrlY: 0,
        startT: 0,
        spin: 0,
      };
    });

    // Capas: planchas (fondo) -> paneles 2D -> polvo -> piezas iso (frente).
    const planchasG = document.createElementNS(SVG_NS, "g");
    planchasG.setAttribute("id", "planchas");
    planchasG.style.opacity = "0";
    const panelsG = document.createElementNS(SVG_NS, "g");
    panelsG.setAttribute("id", "panels");
    const dustG = document.createElementNS(SVG_NS, "g");
    dustG.setAttribute("id", "dust");

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
      label.setAttribute("x", String(pl.x + 28));
      label.setAttribute("y", String(pl.y + 46));
      label.textContent = pl.label;
      planchasG.appendChild(label);
    }

    const mkPanel = (px: number, py: number, pw: number, ph: number): SVGGElement => {
      const g = document.createElementNS(SVG_NS, "g");
      g.setAttribute("class", "panel");
      g.style.opacity = "0";
      const outer = document.createElementNS(SVG_NS, "rect");
      outer.setAttribute("class", "panel-outer");
      outer.setAttribute("x", String(px));
      outer.setAttribute("y", String(py));
      outer.setAttribute("width", String(pw));
      outer.setAttribute("height", String(ph));
      g.appendChild(outer);
      const off = Math.min(pw, ph) * 0.12;
      if (off > 3) {
        const inset = document.createElementNS(SVG_NS, "rect");
        inset.setAttribute("class", "panel-inset");
        inset.setAttribute("x", String(px + off));
        inset.setAttribute("y", String(py + off));
        inset.setAttribute("width", String(pw - off * 2));
        inset.setAttribute("height", String(ph - off * 2));
        g.appendChild(inset);
      }
      panelsG.appendChild(g);
      return g;
    };

    // Empaquetar cada grupo (por super-celdas) y crear paneles + pool de polvo.
    const assignGroup = (list: PieceRef[], pl: Plancha) => {
      const innerX = pl.x + PAD;
      const innerY = pl.y + PAD + LABEL_GAP;
      const innerW = pl.w - PAD * 2;
      const innerH = pl.h - PAD * 2 - LABEL_GAP;
      const specs = new Map(list.map((ref) => [ref, buildPanels(ref)]));
      const { k, placed } = packShelf(
        list.map((ref) => ({ w: specs.get(ref)!.scW, h: specs.get(ref)!.scH, ref })),
        innerW,
        innerH,
      );
      for (const pp of placed) {
        const spec = specs.get(pp.ref)!;
        const x0 = innerX + pp.x;
        const y0 = innerY + pp.y;
        pp.ref.scCx = x0 + pp.w / 2;
        pp.ref.scCy = y0 + pp.h / 2;
        pp.ref.isoK = Math.min(pp.w / pp.ref.bw, pp.h / pp.ref.bh);
        for (const lp of spec.local) {
          const ax = x0 + lp.ox * k;
          const ay = y0 + lp.oy * k;
          const el = mkPanel(ax, ay, lp.w * k, lp.h * k);
          pp.ref.panels.push({ ox: lp.ox, oy: lp.oy, w: lp.w, h: lp.h, el });
        }
        for (let j = 0; j < N_DUST; j++) {
          const c = document.createElementNS(SVG_NS, "circle");
          c.setAttribute("class", "dust");
          c.setAttribute("r", "0");
          c.style.opacity = "0";
          dustG.appendChild(c);
          pp.ref.dust.push(c);
        }
      }
    };
    assignGroup(pieces.filter((p) => isFloor(p.name)), P1);
    assignGroup(pieces.filter((p) => !isFloor(p.name)), P2);

    // Parámetros de vuelo: arranque escalonado (orden de aterrizaje arriba→abajo) + arco + giro.
    const ranked = [...pieces].sort((a, b) => a.scCy - b.scCy || a.scCx - b.scCx);
    ranked.forEach((g, i) => {
      g.startT = (i / Math.max(1, ranked.length - 1)) * STAGGER_SPAN;
      const p0x = g.cx + g.dx;
      const p0y = g.cy + g.dy;
      const mx = (p0x + g.scCx) / 2;
      const my = (p0y + g.scCy) / 2;
      const dx = g.scCx - p0x;
      const dy = g.scCy - p0y;
      const dist = Math.hypot(dx, dy) || 1;
      const side = i % 2 === 0 ? 1 : -1;
      g.ctrlX = mx + (-dy / dist) * dist * 0.28 * side;
      g.ctrlY = my + (dx / dist) * dist * 0.28 * side - dist * 0.12;
      g.spin = side * (12 + ((i * 17) % 16)) * (Math.PI / 180);
    });

    svgEl.insertBefore(dustG, svgEl.firstChild);
    svgEl.insertBefore(panelsG, dustG);
    svgEl.insertBefore(planchasG, panelsG);

    const legendItems = legendRef.current
      ? [...legendRef.current.querySelectorAll("li")]
      : [];

    let lastKey = "";

    const render = (p: number) => {
      const eExp = ease(clamp01(p / EXPLODE_END));
      const pNest = clamp01((p - EXPLODE_END) / (1 - EXPLODE_END));
      const fade = Math.min(1, p / FADE);

      if (assembled) assembled.style.opacity = String(1 - fade);
      planchasG.style.opacity = String(clamp01(pNest / 0.12));

      for (const g of pieces) {
        if (pNest <= 0) {
          // Fase explode: separar y profundidad real.
          g.el.style.opacity = String(fade);
          g.el.setAttribute("transform", `translate(${g.dx * eExp},${g.dy * eExp})`);
          for (const pan of g.panels) pan.el.style.opacity = "0";
          for (const c of g.dust) c.style.opacity = "0";
          g.depth = g.d0 + g.dr * eExp;
          continue;
        }
        // Fase vuelo/nest: arco + giro + crossfade a panel(es) 2D.
        const fp = clamp01((pNest - g.startT) / FLIGHT_DUR);
        const ef = ease(fp);
        const p0x = g.cx + g.dx;
        const p0y = g.cy + g.dy;
        const bx = bezier(ef, p0x, g.ctrlX, g.scCx);
        const by = bezier(ef, p0y, g.ctrlY, g.scCy);
        const s = lerp(1, g.isoK, ef);
        const ang = (g.spin * Math.sin(ef * Math.PI) * 180) / Math.PI;
        g.el.setAttribute(
          "transform",
          `translate(${bx},${by}) rotate(${ang}) scale(${s}) translate(${-g.cx},${-g.cy})`,
        );
        const panelOp = clamp01((fp - 0.72) / 0.28);
        g.el.style.opacity = String(fade * (1 - clamp01((fp - 0.82) / 0.18)));
        for (const pan of g.panels) pan.el.style.opacity = String(panelOp);

        // Polvo neón: cola muestreada sobre el arco, detrás de la pieza.
        const flying = clamp01(fp / 0.08) * clamp01((1 - fp) / 0.12);
        for (let j = 0; j < g.dust.length; j++) {
          const tj = ef - (j + 1) * TAIL_STEP;
          const c = g.dust[j];
          if (tj <= 0 || flying <= 0) {
            c.style.opacity = "0";
            continue;
          }
          const dxx = g.scCx - p0x;
          const dyy = g.scCy - p0y;
          const dl = Math.hypot(dxx, dyy) || 1;
          const jit = (((j * 53 + 7) % 11) - 5) * 2.2;
          c.setAttribute("cx", String(bezier(tj, p0x, g.ctrlX, g.scCx) + (-dyy / dl) * jit));
          c.setAttribute("cy", String(bezier(tj, p0y, g.ctrlY, g.scCy) + (dxx / dl) * jit));
          c.setAttribute("r", String((1 - j / g.dust.length) * 7 + 1.5));
          c.style.opacity = String(flying * (1 - j / g.dust.length) * 0.6);
        }
      }

      // painter's dinámico solo durante el explode; congelado en el vuelo (evita parpadeo).
      if (pNest <= 0) {
        const sorted = [...pieces].sort((a, b) => a.depth - b.depth);
        const key = sorted.map((g) => g.name).join(",");
        if (key !== lastKey) {
          for (const g of sorted) svgEl.appendChild(g.el);
          lastKey = key;
        }
      }
      if (assembled && fade < 1) svgEl.appendChild(assembled);

      legendItems.forEach((li, i) =>
        li.classList.toggle("on", clamp01(p / EXPLODE_END) >= (i / legendItems.length) * 0.9),
      );
    };

    gsap.registerPlugin(ScrollTrigger);
    const ctx = gsap.context(() => {
      ScrollTrigger.create({
        trigger: section,
        start: "top top",
        end: "+=400%",
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
          Deslizá para descomponer el modelo: cada parte se separa, vuela a su plancha y se
          acomoda como panel de corte. Los pisos van a una, las paredes y carpinterías a otra.
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
