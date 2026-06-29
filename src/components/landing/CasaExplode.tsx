"use client";

import { memo, useLayoutEffect, useRef } from "react";
import Link from "next/link";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ArrowRight } from "lucide-react";
import { CASA_EXPLODE_SVG, CASA_VIEWBOX } from "./casaExplodeSvg";

/**
 * Sección sticky con tres fases encadenadas al scroll:
 *
 *  1. EXPLODE (p 0 → 0.40): crossfade de la capa armada (#assembled) a las piezas
 *     separables; cada pieza se separa por su vector (data-dx/dy) con painter's dinámico.
 *  2. VUELO/NEST (p 0.40 → 1): cada componente vuela escalonado por un arco (con giro y
 *     traza de polvo neón) hacia su plancha de corte y queda como panel vector 2D plano.
 *     Pisos/losas → P1; paredes + carpinterías → P2.
 *
 * Importante: el .obj agrupa las paredes de cada piso como UNA caja (ground_wall /
 * upper_wall). En una plancha real cada pared es un componente aparte, así que al empezar
 * el vuelo esa caja se ABRE en 4 paneles (frente, contrafrente, 2 laterales) y CADA UNO
 * vuela individualmente a su lugar. Las losas y carpinterías son un único panel.
 *
 * El layout se escala para entrar completo en pantallas de laptop (ver CSS).
 */

interface FlatPanel {
  el: SVGGElement;
  // centro del slot final (coords del viewBox)
  pcx: number;
  pcy: number;
  // vuelo propio (solo paneles de pared)
  fly: boolean;
  originX: number;
  originY: number;
  ctrlX: number;
  ctrlY: number;
  startT: number;
  spin: number;
  dust: SVGCircleElement[];
}

interface PieceRef {
  el: SVGGElement;
  panels: FlatPanel[];
  dust: SVGCircleElement[];
  wall: boolean;
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
  // vuelo de la pieza iso (no-pared): centro destino + parámetros
  scCx: number;
  scCy: number;
  isoK: number;
  originX: number;
  originY: number;
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

// Beats de texto sincronizados con la animación (estilo anime.js). `start` es el
// progreso del pin donde el panel pasa a estar activo.
const BEATS = [
  {
    start: 0,
    step: "01 · modelo",
    title: "Tu casa, en 3D",
    body: "Subís el .obj y trabajás sobre el modelo real: lo medís, lo revisás y marcás cómo se va a cortar.",
  },
  {
    start: 0.12,
    step: "02 · componentes",
    title: "Cada parte, identificada",
    body: "El modelo se descompone pieza por pieza. Hasta las paredes de cada piso se reparten una por una.",
  },
  {
    start: 0.42,
    step: "03 · anidado",
    title: "Vuelan a la plancha",
    body: "Cada componente se acomoda solo en la lámina de corte, agrupado por tipo y aprovechando el material.",
  },
  {
    start: 0.78,
    step: "04 · a cortar",
    title: "Planchas listas",
    body: "Exportás el PDF de corte y, si querés, el instructivo te guía el armado en 3D.",
  },
];

const INTRO_PORTION = 0.11; // primer tramo del scroll: hero integrado, animación en pausa

const FADE = 0.1; // tramo del crossfade armado -> piezas
const EXPLODE_END = 0.4; // fin de la separación; el vuelo ocupa [0.40, 1]
const STAGGER_SPAN = 0.46; // dispersión de arranques del vuelo (en pNest)
const FLIGHT_DUR = 0.46; // duración del vuelo de cada componente (en pNest)
const WALL_FAN_R = 150; // radio del abanico al abrirse las 4 paredes
const N_DUST = 6;
const TAIL_STEP = 0.055;

const ease = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const SVG_MARKUP = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${CASA_VIEWBOX}" role="img" aria-label="Casa que se descompone y vuela a planchas de corte">${CASA_EXPLODE_SVG}</svg>`;

/** Pisos/losas horizontales → P1; el resto (paredes + carpinterías) → P2. */
const isFloor = (name: string): boolean => /slab|foundation|step|canopy/.test(name);
const isWallBox = (name: string): boolean => /wall/.test(name);

/** Layout local (raw) de los paneles que produce una pieza. Paredes → 2×2; resto → 1. */
function buildPanels(p: PieceRef): { scW: number; scH: number; local: { ox: number; oy: number; w: number; h: number }[] } {
  if (p.wall) {
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

/** Empaquetado por estantes (shelf packing) de super-celdas, conservando proporciones. */
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

/** Posición a lo largo del arco de vuelo (Bézier cuadrática). */
function bezier(t: number, p0: number, c: number, p1: number): number {
  const u = 1 - t;
  return u * u * p0 + 2 * u * t * c + t * t * p1;
}

function mountSvgLayers(
  svgEl: SVGSVGElement,
  planchasG: SVGGElement,
  panelsG: SVGGElement,
  dustG: SVGGElement,
) {
  if (
    !svgEl.isConnected ||
    (planchasG.parentNode === svgEl &&
      panelsG.parentNode === svgEl &&
      dustG.parentNode === svgEl)
  ) {
    return;
  }
  svgEl.insertBefore(planchasG, svgEl.firstChild);
  if (panelsG.parentNode !== svgEl) {
    svgEl.insertBefore(panelsG, planchasG.nextSibling);
  }
  if (dustG.parentNode !== svgEl) {
    svgEl.insertBefore(dustG, panelsG.nextSibling);
  }
}

function CasaExplode() {
  const sectionRef = useRef<HTMLElement>(null);
  const pinRef = useRef<HTMLDivElement>(null);
  const svgHostRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const introRef = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLDivElement>(null);
  const tubeFillRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const host = svgHostRef.current;
    const section = sectionRef.current;
    const pin = pinRef.current;
    if (!host || !section || !pin) return;

    let disposed = false;
    const isLive = () =>
      !disposed && host.isConnected && section.isConnected && pin.isConnected;

    const svgEl = host.querySelector("svg");
    if (!svgEl) return;
    const assembled = svgEl.querySelector<SVGGElement>("#assembled");

    const pieces: PieceRef[] = [
      ...svgEl.querySelectorAll<SVGGElement>('[id^="piece-"]'),
    ].map((el) => {
      const b = el.getBBox();
      const name = el.dataset.piece || el.id;
      return {
        el,
        panels: [],
        dust: [],
        wall: isWallBox(name),
        dx: parseFloat(el.dataset.dx || "0"),
        dy: parseFloat(el.dataset.dy || "0"),
        d0: parseFloat(el.dataset.d0 || "0"),
        dr: parseFloat(el.dataset.dr || "0"),
        name,
        depth: 0,
        cx: b.x + b.width / 2,
        cy: b.y + b.height / 2,
        bw: b.width || 1,
        bh: b.height || 1,
        scCx: 0,
        scCy: 0,
        isoK: 1,
        originX: 0,
        originY: 0,
        ctrlX: 0,
        ctrlY: 0,
        startT: 0,
        spin: 0,
      };
    });

    const piecesG = document.createElementNS(SVG_NS, "g");
    piecesG.setAttribute("id", "pieces-layer");
    for (const p of pieces) {
      if (p.el.parentNode === svgEl) {
        piecesG.appendChild(p.el);
      }
    }
    if (piecesG.childNodes.length > 0) {
      svgEl.appendChild(piecesG);
    }

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

    const mkDust = (n: number): SVGCircleElement[] => {
      const arr: SVGCircleElement[] = [];
      for (let j = 0; j < n; j++) {
        const c = document.createElementNS(SVG_NS, "circle");
        c.setAttribute("class", "dust");
        c.setAttribute("r", "0");
        c.style.opacity = "0";
        dustG.appendChild(c);
        arr.push(c);
      }
      return arr;
    };

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

    // Empaquetar cada grupo (por super-celdas) y crear paneles.
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
          const aw = lp.w * k;
          const ah = lp.h * k;
          const el = mkPanel(ax, ay, aw, ah);
          pp.ref.panels.push({
            el,
            pcx: ax + aw / 2,
            pcy: ay + ah / 2,
            fly: pp.ref.wall,
            originX: 0,
            originY: 0,
            ctrlX: 0,
            ctrlY: 0,
            startT: 0,
            spin: 0,
            dust: pp.ref.wall ? mkDust(N_DUST) : [],
          });
        }
        // La pieza iso (no-pared) usa su propio pool de polvo para el vuelo.
        if (!pp.ref.wall) pp.ref.dust = mkDust(N_DUST);
      }
    };
    assignGroup(pieces.filter((p) => isFloor(p.name)), P1);
    assignGroup(pieces.filter((p) => !isFloor(p.name)), P2);

    // Lista de "voladores": piezas iso (no-pared) + cada panel de pared, por separado.
    interface Flyer {
      wall: boolean;
      piece: PieceRef;
      panel: FlatPanel | null;
      idx: number;
      tx: number;
      ty: number;
    }
    const flyers: Flyer[] = [];
    for (const p of pieces) {
      if (p.wall) {
        p.panels.forEach((pan, idx) =>
          flyers.push({ wall: true, piece: p, panel: pan, idx, tx: pan.pcx, ty: pan.pcy }),
        );
      } else {
        flyers.push({ wall: false, piece: p, panel: null, idx: 0, tx: p.scCx, ty: p.scCy });
      }
    }
    // Las paredes vuelan primero (se ve la separación temprano), luego el resto arriba→abajo.
    flyers.sort((a, b) => {
      const aw = a.wall ? 0 : 1;
      const bw = b.wall ? 0 : 1;
      if (aw !== bw) return aw - bw;
      return a.ty - b.ty || a.tx - b.tx;
    });
    const NF = flyers.length;
    flyers.forEach((f, i) => {
      const startT = (i / Math.max(1, NF - 1)) * STAGGER_SPAN;
      const side = i % 2 === 0 ? 1 : -1;
      let ox: number;
      let oy: number;
      if (f.wall && f.panel) {
        // Origen en abanico alrededor del centroide explotado de la caja.
        const bcx = f.piece.cx + f.piece.dx;
        const bcy = f.piece.cy + f.piece.dy;
        const a = (f.idx / WALL_PANELS.length) * Math.PI * 2 + 0.7;
        ox = bcx + Math.cos(a) * WALL_FAN_R;
        oy = bcy + Math.sin(a) * WALL_FAN_R * 0.72;
      } else {
        ox = f.piece.cx + f.piece.dx;
        oy = f.piece.cy + f.piece.dy;
      }
      const mx = (ox + f.tx) / 2;
      const my = (oy + f.ty) / 2;
      const dx = f.tx - ox;
      const dy = f.ty - oy;
      const dist = Math.hypot(dx, dy) || 1;
      const ctrlX = mx + (-dy / dist) * dist * 0.28 * side;
      const ctrlY = my + (dx / dist) * dist * 0.28 * side - dist * 0.12;
      const spin = side * (12 + ((i * 17) % 16)) * (Math.PI / 180);
      const store = f.wall && f.panel ? f.panel : f.piece;
      store.originX = ox;
      store.originY = oy;
      store.ctrlX = ctrlX;
      store.ctrlY = ctrlY;
      store.startT = startT;
      store.spin = spin;
    });

    mountSvgLayers(svgEl, planchasG, panelsG, dustG);

    const panelEls = copyRef.current
      ? [...copyRef.current.querySelectorAll<HTMLElement>(".casa-explode-panel")]
      : [];
    const tubeFill = tubeFillRef.current;

    let lastKey = "";

    const reorderPieces = (sorted: PieceRef[]) => {
      if (!piecesG.isConnected) return;
      for (const g of sorted) {
        if (g.el.parentNode === piecesG) {
          piecesG.appendChild(g.el);
        }
      }
    };

    const moveAssembledToFront = () => {
      if (assembled?.isConnected && assembled.parentNode === svgEl) {
        svgEl.appendChild(assembled);
      }
    };

    // Cola de polvo neón muestreada sobre un arco.
    const renderDust = (
      dust: SVGCircleElement[],
      ef: number,
      flying: number,
      ox: number,
      oy: number,
      cx: number,
      cy: number,
      tx: number,
      ty: number,
    ) => {
      const dxx = tx - ox;
      const dyy = ty - oy;
      const dl = Math.hypot(dxx, dyy) || 1;
      for (let j = 0; j < dust.length; j++) {
        const tj = ef - (j + 1) * TAIL_STEP;
        const c = dust[j];
        if (tj <= 0 || flying <= 0) {
          c.style.opacity = "0";
          continue;
        }
        const jit = (((j * 53 + 7) % 11) - 5) * 2.2;
        c.setAttribute("cx", String(bezier(tj, ox, cx, tx) + (-dyy / dl) * jit));
        c.setAttribute("cy", String(bezier(tj, oy, cy, ty) + (dxx / dl) * jit));
        c.setAttribute("r", String((1 - j / dust.length) * 7 + 1.5));
        c.style.opacity = String(flying * (1 - j / dust.length) * 0.6);
      }
    };

    const render = (p: number) => {
      if (!isLive() || !svgEl.isConnected) return;

      const eExp = ease(clamp01(p / EXPLODE_END));
      const pNest = clamp01((p - EXPLODE_END) / (1 - EXPLODE_END));
      const fade = Math.min(1, p / FADE);

      if (assembled) assembled.style.opacity = String(1 - fade);
      planchasG.style.opacity = String(clamp01(pNest / 0.12));

      for (const g of pieces) {
        if (pNest <= 0) {
          // Fase explode: la pieza iso se separa (la caja de paredes aún entera).
          g.el.style.opacity = String(fade);
          g.el.setAttribute("transform", `translate(${g.dx * eExp},${g.dy * eExp})`);
          for (const pan of g.panels) pan.el.style.opacity = "0";
          for (const c of g.dust) c.style.opacity = "0";
          for (const pan of g.panels) for (const c of pan.dust) c.style.opacity = "0";
          g.depth = g.d0 + g.dr * eExp;
          continue;
        }

        if (g.wall) {
          // La caja se desvanece rápido mientras sus 4 paneles se abren y vuelan solos.
          g.el.setAttribute("transform", `translate(${g.dx},${g.dy})`);
          g.el.style.opacity = String(fade * (1 - clamp01(pNest / 0.1)));
          for (const pan of g.panels) {
            const fp = clamp01((pNest - pan.startT) / FLIGHT_DUR);
            const ef = ease(fp);
            const bx = bezier(ef, pan.originX, pan.ctrlX, pan.pcx);
            const by = bezier(ef, pan.originY, pan.ctrlY, pan.pcy);
            const s = lerp(0.7, 1, ef);
            const ang = (pan.spin * Math.sin(ef * Math.PI) * 180) / Math.PI;
            pan.el.setAttribute(
              "transform",
              `translate(${bx},${by}) rotate(${ang}) scale(${s}) translate(${-pan.pcx},${-pan.pcy})`,
            );
            pan.el.style.opacity = String(clamp01(fp / 0.08));
            const flying = clamp01(fp / 0.08) * clamp01((1 - fp) / 0.12);
            renderDust(pan.dust, ef, flying, pan.originX, pan.originY, pan.ctrlX, pan.ctrlY, pan.pcx, pan.pcy);
          }
          continue;
        }

        // Pieza normal (losa/carpintería): la iso vuela y al aterrizar cruza a su panel 2D.
        const fp = clamp01((pNest - g.startT) / FLIGHT_DUR);
        const ef = ease(fp);
        const bx = bezier(ef, g.originX, g.ctrlX, g.scCx);
        const by = bezier(ef, g.originY, g.ctrlY, g.scCy);
        const s = lerp(1, g.isoK, ef);
        const ang = (g.spin * Math.sin(ef * Math.PI) * 180) / Math.PI;
        g.el.setAttribute(
          "transform",
          `translate(${bx},${by}) rotate(${ang}) scale(${s}) translate(${-g.cx},${-g.cy})`,
        );
        const panelOp = clamp01((fp - 0.72) / 0.28);
        g.el.style.opacity = String(fade * (1 - clamp01((fp - 0.82) / 0.18)));
        for (const pan of g.panels) pan.el.style.opacity = String(panelOp);
        const flying = clamp01(fp / 0.08) * clamp01((1 - fp) / 0.12);
        renderDust(g.dust, ef, flying, g.originX, g.originY, g.ctrlX, g.ctrlY, g.scCx, g.scCy);
      }

      // painter's dinámico solo durante el explode; congelado en el vuelo.
      if (pNest <= 0) {
        const sorted = [...pieces].sort((a, b) => a.depth - b.depth);
        const key = sorted.map((g) => g.name).join(",");
        if (key !== lastKey) {
          reorderPieces(sorted);
          lastKey = key;
        }
      }
      if (assembled && fade > 0 && fade < 1) moveAssembledToFront();

      // Beat de texto activo (último cuyo `start` ya pasó) + tubo de progreso.
      let active = 0;
      for (let i = 0; i < BEATS.length; i++) if (p >= BEATS[i].start) active = i;
      panelEls.forEach((el, i) => el.classList.toggle("on", i === active));
      if (tubeFill) tubeFill.style.height = `${(clamp01(p) * 100).toFixed(2)}%`;
    };

    const setIntro = (t: number) => {
      const introOpacity = 1 - t;
      if (introRef.current) {
        introRef.current.style.opacity = String(introOpacity);
        introRef.current.style.visibility = introOpacity < 0.04 ? "hidden" : "visible";
        introRef.current.style.pointerEvents = introOpacity > 0.2 ? "auto" : "none";
      }
      if (copyRef.current) {
        const copyOpacity = t > 0.82 ? clamp01((t - 0.82) / 0.18) : 0;
        copyRef.current.style.opacity = String(copyOpacity);
        copyRef.current.style.visibility = copyOpacity < 0.04 ? "hidden" : "visible";
      }
    };

    const renderIntro = (t: number) => {
      if (!isLive() || !svgEl.isConnected) return;

      const peek = lerp(0.22, 1, t);
      if (assembled) assembled.style.opacity = String(peek);
      for (const g of pieces) {
        g.el.style.opacity = "0";
        g.el.setAttribute("transform", "translate(0,0)");
      }
      planchasG.style.opacity = "0";
      for (const pan of panelsG.querySelectorAll<SVGElement>(".panel")) pan.style.opacity = "0";
      if (tubeFill) tubeFill.style.height = "0%";
      panelEls.forEach((el) => el.classList.remove("on"));
    };

    gsap.registerPlugin(ScrollTrigger);
    const ctx = gsap.context(() => {
      ScrollTrigger.create({
        trigger: section,
        pin: pin,
        pinReparent: false,
        anticipatePin: 1,
        start: "top top",
        end: "+=380%",
        scrub: 0.4,
        onUpdate: (self) => {
          if (!isLive()) return;

          const p = self.progress;
          if (p < INTRO_PORTION) {
            const t = ease(p / INTRO_PORTION);
            setIntro(t);
            renderIntro(t);
            if (hintRef.current) hintRef.current.style.opacity = String(1 - t);
            return;
          }
          setIntro(1);
          if (hintRef.current) hintRef.current.style.opacity = "1";
          const animP = clamp01((p - INTRO_PORTION) / (1 - INTRO_PORTION));
          render(animP);
        },
      });
    }, section);

    setIntro(0);
    renderIntro(0);

    return () => {
      disposed = true;
      ctx.revert();
    };
  }, []);

  return (
    <section ref={sectionRef} id="recorrido" className="casa-explode-section">
      <div ref={pinRef} className="casa-explode-pin">
      <div ref={introRef} className="casa-intro">
        <p className="casa-intro-badge">modelos 3D · corte · nube</p>
        <img
          src="/images/logoFaviconE2d.svg"
          alt="Eficiencia2D"
          width={144}
          height={144}
          className="casa-intro-logo e2d-logo-glow"
        />
        <h1 className="casa-intro-title e2d-title-glow">
          Cortá en{" "}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-secondary to-primary">
            3D
          </span>
          . Exportá planchas.
        </h1>
        <p className="casa-intro-lead">
          La mayor parte del trabajo es revisar el modelo, medir y marcar cortes.
          Las planchas vienen al final.
        </p>
        <div className="casa-intro-cta">
          <Link href="/home" className="btn btn-primary gap-2 shadow-lg shadow-primary/35 px-8">
            Empezar
            <ArrowRight size={16} />
          </Link>
          <a href="#nube" className="btn btn-ghost border border-primary/25 text-primary/90">
            La nube
          </a>
        </div>
      </div>

      <div ref={copyRef} className="casa-explode-copy" style={{ opacity: 0 }}>
        <p className="casa-explode-kicker">de la casa a la plancha</p>
        <div className="casa-explode-panels">
          {BEATS.map((b, i) => (
            <div key={b.step} className={`casa-explode-panel${i === 0 ? " on" : ""}`}>
              <p className="casa-explode-step">{b.step}</p>
              <h2 className="casa-explode-title">{b.title}</h2>
              <p className="casa-explode-lead">{b.body}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="casa-explode-stage">
        <div
          ref={svgHostRef}
          className="casa-explode"
          aria-hidden
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: SVG_MARKUP }}
        />
      </div>

      {/* Tubo de vidrio que se llena de líquido neón con el avance del scroll. */}
      <div className="casa-tube" aria-hidden>
        <div className="casa-tube-glass">
          <div ref={tubeFillRef} className="casa-tube-fill" />
        </div>
        {BEATS.slice(1).map((b) => (
          <span key={b.step} className="casa-tube-tick" style={{ bottom: `${b.start * 100}%` }} />
        ))}
      </div>

      <div ref={hintRef} className="casa-explode-hint">
        <span className="animate-pulse">deslizá</span>
        <span className="casa-explode-hint-arrow">↓</span>
      </div>
      </div>
    </section>
  );
}

export default memo(CasaExplode);
