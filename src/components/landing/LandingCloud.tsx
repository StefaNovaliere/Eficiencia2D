"use client";

import { memo, useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Cloud, Laptop, Smartphone, Check } from "lucide-react";

/**
 * Sección "tus proyectos, en la nube", pineada y sincronizada al scroll (mismo patrón
 * anime.js que `CasaExplode`): el visual queda fijo y el texto avanza por beats.
 *
 * Historia en 3 beats:
 *  1. guardar     (p 0–0.34): las tarjetas casa.obj / planchas.pdf suben y entran a la nube.
 *  2. retomar     (p 0.34–0.67): bajan desde la nube a la notebook y al celular.
 *  3. sincronizar (p 0.67–1): loop de sync (haces nube↔dispositivos) + ✓ actualizado.
 *
 * Progreso: se reusa el tubo de vidrio neón (`.casa-tube*`).
 */

const BEATS = [
  {
    start: 0,
    step: "01 · guardar",
    title: "Un clic y queda en la nube",
    body: "Subís el .obj estando logueada y el proyecto queda guardado con el modelo, los cortes y las planchas.",
  },
  {
    start: 0.34,
    step: "02 · retomar",
    title: "Desde cualquier dispositivo",
    body: "Abrís la app en la notebook o en el celular y seguís exactamente donde lo dejaste.",
  },
  {
    start: 0.67,
    step: "03 · sincronizar",
    title: "Siempre actualizado",
    body: "Cada cambio se persiste en el servidor. No hace falta reenviar archivos ni versionar a mano.",
  },
];

const ease = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

interface Pt {
  x: number;
  y: number;
}

function LandingCloud() {
  const sectionRef = useRef<HTMLElement>(null);
  const pinRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const tubeFillRef = useRef<HTMLDivElement>(null);
  const visualRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const cloudRef = useRef<HTMLDivElement>(null);
  const cardARef = useRef<HTMLDivElement>(null);
  const cardBRef = useRef<HTMLDivElement>(null);
  const laptopRef = useRef<HTMLDivElement>(null);
  const phoneRef = useRef<HTMLDivElement>(null);
  const beamLRef = useRef<HTMLDivElement>(null);
  const beamRRef = useRef<HTMLDivElement>(null);
  const checkRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const section = sectionRef.current;
    const pin = pinRef.current;
    const visual = visualRef.current;
    if (!section || !pin || !visual) return;

    let disposed = false;
    const isLive = () => !disposed && section.isConnected && pin.isConnected;

    const panelEls = copyRef.current
      ? [...copyRef.current.querySelectorAll<HTMLElement>(".landing-cloud-panel")]
      : [];
    const tubeFill = tubeFillRef.current;

    // Anclas (coords locales del visual): nube arriba-centro, dispositivos abajo.
    let cloudPt: Pt = { x: 0, y: 0 };
    let laptopPt: Pt = { x: 0, y: 0 };
    let phonePt: Pt = { x: 0, y: 0 };

    const positionBeam = (el: HTMLDivElement | null, from: Pt, to: Pt) => {
      if (!el) return;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const len = Math.hypot(dx, dy);
      const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
      el.style.left = `${from.x}px`;
      el.style.top = `${from.y}px`;
      el.style.width = `${len}px`;
      el.style.transform = `rotate(${ang}deg)`;
    };

    const measure = () => {
      const r = visual.getBoundingClientRect();
      const W = r.width;
      const H = r.height;
      cloudPt = { x: W * 0.5, y: H * 0.28 };
      laptopPt = { x: W * 0.28, y: H * 0.82 };
      phonePt = { x: W * 0.74, y: H * 0.82 };
      positionBeam(beamLRef.current, cloudPt, laptopPt);
      positionBeam(beamRRef.current, cloudPt, phonePt);
    };
    measure();

    const placeCard = (
      el: HTMLDivElement | null,
      base: Pt,
      p: number,
      eg: number,
      er: number,
    ) => {
      if (!el) return;
      let cur: Pt;
      let op: number;
      let sc: number;
      if (p < 0.34) {
        // sube del dispositivo a la nube y se desvanece al entrar
        cur = { x: lerp(base.x, cloudPt.x, eg), y: lerp(base.y, cloudPt.y, eg) };
        op = 1 - clamp01((eg - 0.72) / 0.28);
        sc = lerp(1, 0.6, eg);
      } else if (p < 0.67) {
        // baja de la nube al dispositivo
        cur = { x: lerp(cloudPt.x, base.x, er), y: lerp(cloudPt.y, base.y, er) };
        op = clamp01(er / 0.25);
        sc = lerp(0.6, 1, er);
      } else {
        cur = base;
        op = 1;
        sc = 1;
      }
      const dx = cur.x - base.x;
      const dy = cur.y - base.y;
      el.style.transform = `translate(-50%,-50%) translate(${dx}px,${dy}px) scale(${sc})`;
      el.style.opacity = String(op);
    };

    const render = (p: number) => {
      const eg = ease(clamp01(p / 0.34));
      const er = ease(clamp01((p - 0.34) / 0.33));
      const es = clamp01((p - 0.67) / 0.33);

      // nube: brillo que sube en la fase guardar y se mantiene
      if (glowRef.current) glowRef.current.style.opacity = String(lerp(0.22, 0.6, clamp01(p / 0.5)));
      if (cloudRef.current) {
        const cs = lerp(0.92, 1.06, clamp01(p / 0.34));
        cloudRef.current.style.transform = `translate(-50%,-50%) scale(${cs})`;
      }

      placeCard(cardARef.current, laptopPt, p, eg, er);
      placeCard(cardBRef.current, phonePt, p, eg, er);

      // dispositivos: aparecen entrando en "retomar"
      const devOp = lerp(0.28, 1, clamp01((p - 0.28) / 0.2));
      if (laptopRef.current) laptopRef.current.style.opacity = String(devOp);
      if (phoneRef.current) phoneRef.current.style.opacity = String(devOp);

      // haces nube↔dispositivos: aparecen en retomar y pulsan en sincronizar
      const beamBase = clamp01((p - 0.34) / 0.12);
      const pulse = es > 0 ? 0.55 + 0.45 * Math.sin(es * Math.PI * 4) : 1;
      const beamOp = beamBase * (es > 0 ? pulse : 1) * 0.85;
      if (beamLRef.current) beamLRef.current.style.opacity = String(beamOp);
      if (beamRRef.current) beamRRef.current.style.opacity = String(beamOp);

      // ✓ sincronizado
      if (checkRef.current) {
        const co = clamp01((es - 0.15) / 0.35);
        checkRef.current.style.opacity = String(co);
        checkRef.current.style.transform = `translate(-50%,-50%) scale(${lerp(0.7, 1, co)})`;
      }

      // beat de texto activo + tubo
      let active = 0;
      for (let i = 0; i < BEATS.length; i++) if (p >= BEATS[i].start) active = i;
      panelEls.forEach((el, i) => el.classList.toggle("on", i === active));
      if (tubeFill) tubeFill.style.height = `${(clamp01(p) * 100).toFixed(2)}%`;
    };

    gsap.registerPlugin(ScrollTrigger);
    const ctx = gsap.context(() => {
      ScrollTrigger.create({
        trigger: section,
        pin: pin,
        pinReparent: false,
        anticipatePin: 1,
        start: "top top",
        end: "+=300%",
        scrub: 0.4,
        onUpdate: (self) => {
          if (!isLive()) return;
          render(self.progress);
        },
        onRefresh: measure,
      });
    }, section);

    render(0);

    return () => {
      disposed = true;
      ctx.revert();
    };
  }, []);

  return (
    <section ref={sectionRef} id="nube" className="landing-cloud-section">
      <div className="landing-cloud-bg" aria-hidden />

      <div ref={pinRef} className="landing-cloud-pin">
        <div ref={copyRef} className="landing-cloud-copy">
          <p className="landing-cloud-kicker">tus proyectos, en la nube</p>
          <div className="landing-cloud-panels">
            {BEATS.map((b, i) => (
              <div key={b.step} className={`landing-cloud-panel${i === 0 ? " on" : ""}`}>
                <p className="landing-cloud-step">{b.step}</p>
                <h2 className="landing-cloud-title">{b.title}</h2>
                <p className="landing-cloud-lead">{b.body}</p>
              </div>
            ))}
          </div>
        </div>

        <div ref={visualRef} className="landing-cloud-visual" aria-hidden>
          <div ref={glowRef} className="lc-glow" />
          <div ref={beamLRef} className="lc-beam" />
          <div ref={beamRRef} className="lc-beam" />

          <div ref={cloudRef} className="lc-cloud">
            <Cloud size={64} strokeWidth={1.25} />
          </div>

          <div ref={laptopRef} className="lc-device lc-laptop">
            <Laptop size={26} strokeWidth={1.5} />
          </div>
          <div ref={phoneRef} className="lc-device lc-phone">
            <Smartphone size={22} strokeWidth={1.5} />
          </div>

          <div ref={cardARef} className="lc-card lc-card-a">
            <span>casa.obj</span>
          </div>
          <div ref={cardBRef} className="lc-card lc-card-b">
            <span>planchas.pdf</span>
          </div>

          <div ref={checkRef} className="lc-check">
            <Check size={15} strokeWidth={2.5} />
            <span>sincronizado</span>
          </div>
        </div>

        {/* Tubo de vidrio neón (mismo de la casa). */}
        <div className="casa-tube" aria-hidden>
          <div className="casa-tube-glass">
            <div ref={tubeFillRef} className="casa-tube-fill" />
          </div>
          {BEATS.slice(1).map((b) => (
            <span key={b.step} className="casa-tube-tick" style={{ bottom: `${b.start * 100}%` }} />
          ))}
        </div>

        <div className="casa-explode-hint">
          <span className="animate-pulse">deslizá</span>
          <span className="casa-explode-hint-arrow">↓</span>
        </div>
      </div>
    </section>
  );
}

export default memo(LandingCloud);
