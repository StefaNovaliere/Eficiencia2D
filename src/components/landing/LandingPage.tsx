"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ArrowRight } from "lucide-react";
import { useViewerPalette } from "@/context/ThemeContext";
import FlowStepVisual from "@/components/landing/FlowStepVisual";
import NeonThemeSwitch from "@/components/NeonThemeSwitch";

const LandingScene = dynamic(() => import("./LandingScene"), { ssr: false });
const CasaExplode = dynamic(() => import("./CasaExplode"), { ssr: false });

const JOURNEY = [
  {
    kicker: "01 · subir",
    title: "Tu .obj en la nube",
    body: "Lo cargás una vez y seguís desde la compu, el celu o la tablet. Acá todavía no hay planchas — solo tu modelo guardado.",
    visual: "upload" as const,
  },
  {
    kicker: "02 · revisar",
    title: "Acá vivís en el 3D",
    body: "Medís, clasificás piezas y marcás cortes en el visor. Es el paso más largo y el que más importa: definís cómo se va a cortar.",
    visual: "review" as const,
  },
  {
    kicker: "03 · planchas",
    title: "Recién acá aparecen las láminas",
    body: "El anidado arma las planchas de corte con tus paneles. Es el único momento del flujo donde trabajás con la lámina como salida.",
    visual: "nest" as const,
  },
  {
    kicker: "04 · armar",
    title: "Montás pieza por pieza",
    body: "Descargás el PDF y, si querés, el instructivo interactivo te guía el armado en 3D — otra vez en el modelo, no en el plano.",
    visual: "assembly" as const,
  },
];

export default function LandingPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const workflowRef = useRef<HTMLElement>(null);
  const ctaRef = useRef<HTMLElement>(null);
  const [scrollProgress, setScrollProgress] = useState(0);
  const palette = useViewerPalette();

  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);
    const ctx = gsap.context(() => {
      gsap.fromTo(
        progressRef.current,
        { scaleX: 0 },
        {
          scaleX: 1,
          ease: "none",
          scrollTrigger: {
            trigger: containerRef.current,
            start: "top top",
            end: "bottom bottom",
            scrub: 0.3,
          },
        },
      );

      gsap.fromTo(
        navRef.current,
        { y: -60, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.8, ease: "power3.out", delay: 0.15 },
      );

      gsap.set(".landing-scene", { opacity: 1 });
      gsap.set(".landing-hero-dim", { opacity: 0 });
      gsap.set(".landing-hero-content", { opacity: 0, y: 32 });
      gsap.set(".landing-hero-logo", { scale: 0.8 });
      gsap.set(".landing-scroll-hint", { opacity: 1 });

      const heroTl = gsap.timeline({
        scrollTrigger: {
          trigger: heroRef.current,
          start: "top top",
          end: "+=140%",
          pin: true,
          scrub: 0.85,
          onUpdate: (self) => setScrollProgress(self.progress),
        },
      });

      heroTl
        .to(".landing-scroll-hint", { opacity: 0, duration: 0.1 }, 0.02)
        .to(".landing-scene", { opacity: 0.4, duration: 0.35, ease: "power2.out" }, 0.08)
        .to(".landing-hero-dim", { opacity: 1, duration: 0.35, ease: "power2.out" }, 0.08)
        .to(".landing-hero-content", { opacity: 1, y: 0, duration: 0.4, ease: "power2.out" }, 0.12)
        .to(".landing-hero-logo", { scale: 1, duration: 0.45, ease: "back.out(1.5)" }, 0.12)
        /* Transformación: opacidad casi plana para no delatar el corte */
        .to(".landing-scene", { opacity: 0.46, duration: 0.42, ease: "none" }, 0.22)
        .to(".landing-scene", { opacity: 0.5, duration: 0.38, ease: "none" }, 0.48)
        .to(".landing-hero-content", { opacity: 0, y: -40, duration: 0.25 }, 0.78)
        .to(".landing-hero-dim", { opacity: 0, duration: 0.25 }, 0.78)
        .to(".landing-scene", { opacity: 0.52, duration: 0.25, ease: "power2.out" }, 0.78);

      gsap.utils.toArray<HTMLElement>(".landing-journey-row").forEach((row, i) => {
        const visual = row.querySelector(".landing-journey-visual");
        const copy = row.querySelector(".landing-journey-copy");
        gsap.from(row, {
          opacity: 0,
          y: 40,
          duration: 0.7,
          ease: "power3.out",
          scrollTrigger: { trigger: row, start: "top 82%" },
        });
        if (visual) {
          gsap.from(visual, {
            scale: 0.92,
            duration: 0.8,
            delay: 0.05,
            ease: "back.out(1.4)",
            scrollTrigger: { trigger: row, start: "top 82%" },
          });
        }
        if (copy) {
          gsap.from(copy, {
            x: i % 2 === 0 ? 24 : -24,
            opacity: 0,
            duration: 0.6,
            delay: 0.1,
            ease: "power2.out",
            scrollTrigger: { trigger: row, start: "top 82%" },
          });
        }
      });

      gsap.from(".landing-cta-inner", {
        opacity: 0,
        y: 30,
        scale: 0.96,
        duration: 0.7,
        ease: "power3.out",
        scrollTrigger: { trigger: ctaRef.current, start: "top 80%" },
      });
    }, containerRef);

    return () => ctx.revert();
  }, []);

  return (
    <div ref={containerRef} className="landing-root relative overflow-x-hidden bg-base-200 text-base-content">
      <div
        ref={progressRef}
        className="landing-scroll-progress fixed top-0 left-0 right-0 h-[3px] z-[60] origin-left scale-x-0 bg-gradient-to-r from-primary via-secondary to-primary"
        aria-hidden
      />

      <nav
        ref={navRef}
        className="landing-nav fixed top-0 inset-x-0 z-50 flex items-center justify-between gap-4 px-4 md:px-8 py-4 border-b border-base-300/30 bg-base-100/70 backdrop-blur-xl"
      >
        <Link href="/" className="flex items-center gap-2.5 font-bold tracking-tight shrink-0">
          <img src="/images/logoFaviconE2d.svg" alt="" width={28} height={28} className="w-7 h-7 e2d-logo-glow" />
          <span className="hidden sm:inline">Eficiencia2D</span>
        </Link>
        <div className="hidden md:flex items-center gap-8 text-sm text-base-content/60">
          <a href="#recorrido" className="hover:text-primary transition-colors">
            Recorrido
          </a>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <NeonThemeSwitch />
          <Link href="/login" className="btn btn-ghost btn-sm hidden sm:inline-flex">
            Ingresar
          </Link>
          <Link href="/home" className="btn btn-primary btn-sm gap-1 shadow-lg shadow-primary/30">
            Abrir app
            <ArrowRight size={14} />
          </Link>
        </div>
      </nav>

      <section
        ref={heroRef}
        className="landing-hero relative min-h-screen flex items-center justify-center pt-20 px-4 md:px-8"
      >
        <LandingScene
          scrollProgress={scrollProgress}
          primaryColor={palette.leaderPrimary}
          secondaryColor={palette.leaderSecondary}
          wallColor={palette.wall}
          floorColor={palette.floor}
        />
        <div className="landing-hero-dim absolute inset-0 z-[1] pointer-events-none opacity-0" aria-hidden />

        <div className="landing-hero-content relative z-10 max-w-3xl mx-auto text-center opacity-0">
          <p className="landing-hero-badge inline-block mb-6 px-4 py-1.5 text-xs font-semibold tracking-widest uppercase text-primary border border-primary/40 rounded-full bg-primary/10 shadow-[0_0_20px_color-mix(in_oklch,var(--color-primary)_25%,transparent)]">
            modelos 3D · corte · nube
          </p>

          <img
            src="/images/logoFaviconE2d.svg"
            alt="Eficiencia2D"
            width={144}
            height={144}
            className="landing-hero-logo mx-auto w-28 h-28 md:w-36 md:h-36 e2d-logo-glow mb-6"
          />

          <h1 className="landing-hero-title text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-extrabold tracking-tight mb-5 e2d-title-glow">
            Cortá en{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-secondary to-primary">
              3D
            </span>
            . Exportá planchas.
          </h1>

          <p className="landing-hero-sub text-base md:text-lg text-base-content/70 max-w-lg mx-auto leading-relaxed mb-8">
            La mayor parte del trabajo es revisar el modelo, medir y marcar cortes.
            Las planchas vienen al final.
          </p>

          <div className="landing-hero-cta flex flex-wrap items-center justify-center gap-3">
            <Link href="/home" className="btn btn-primary gap-2 shadow-lg shadow-primary/35 px-8">
              Empezar
              <ArrowRight size={16} />
            </Link>
            <a href="#recorrido" className="btn btn-ghost border border-primary/25 text-primary/90">
              Ver recorrido
            </a>
          </div>
        </div>

        <div className="landing-scroll-hint absolute bottom-8 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-1 text-primary/60 text-xs">
          <span className="animate-pulse">deslizá</span>
          <span className="text-lg leading-none">↓</span>
        </div>
      </section>

      <CasaExplode />

      <section id="recorrido" ref={workflowRef} className="landing-journey relative py-24 md:py-32 px-4 md:px-8 overflow-hidden">
        <div className="landing-journey-bg" aria-hidden />
        <div className="max-w-6xl mx-auto relative z-10">
          <div className="text-center mb-16 md:mb-20">
            <h2 className="text-3xl md:text-4xl font-extrabold mb-4 e2d-title-glow">
              Qué hacés en cada paso
            </h2>
            <p className="text-base-content/60 max-w-xl mx-auto leading-relaxed">
              No pasás todo el tiempo mirando planos. Pasás la mayor parte en el modelo 3D;
              la lámina es el resultado.
            </p>
          </div>

          <div className="space-y-16 md:space-y-24">
            {JOURNEY.map((step, i) => (
              <article
                key={step.kicker}
                className={`landing-journey-row flex flex-col gap-8 md:gap-12 items-center ${
                  i % 2 === 1 ? "md:flex-row-reverse" : "md:flex-row"
                }`}
              >
                <div className="landing-journey-visual w-full md:w-[48%] flex justify-center">
                  <div className="flow-visual-frame">
                    <FlowStepVisual kind={step.visual} />
                  </div>
                </div>
                <div className="landing-journey-copy w-full md:w-[44%]">
                  <p className="text-primary font-mono text-xs tracking-widest uppercase mb-3">
                    {step.kicker}
                  </p>
                  <h3 className="text-2xl md:text-3xl font-bold mb-4 text-base-content">
                    {step.title}
                  </h3>
                  <p className="text-base-content/65 leading-relaxed text-base md:text-lg">
                    {step.body}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section ref={ctaRef} className="relative py-20 md:py-28 px-4 md:px-8">
        <div className="landing-cta-inner max-w-xl mx-auto text-center p-10 md:p-12 rounded-3xl border border-primary/30 bg-gradient-to-br from-primary/12 via-base-100/80 to-secondary/10 shadow-[0_0_60px_color-mix(in_oklch,var(--color-primary)_12%,transparent)]">
          <h2 className="text-2xl md:text-3xl font-extrabold mb-3 e2d-title-glow">Probar Eficiencia2D</h2>
          <p className="text-base-content/65 mb-8 leading-relaxed">
            Subí un .obj, recorré el visor 3D y llegá a tus planchas cuando estés listo.
          </p>
          <Link href="/home" className="btn btn-primary btn-lg gap-2 shadow-xl shadow-primary/35 px-10">
            Ir a la app
            <ArrowRight size={18} />
          </Link>
        </div>
      </section>

      <footer className="landing-footer border-t border-base-300/40 py-10 px-4 md:px-8">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-8">
          <div className="flex items-center gap-3">
            <img
              src="/images/logoFaviconE2d.svg"
              alt=""
              width={36}
              height={36}
              className="w-9 h-9 e2d-logo-glow"
            />
            <p className="font-semibold text-sm">Eficiencia2D</p>
          </div>

          <div className="flex flex-col items-center gap-2 text-center">
            <p className="text-xs text-base-content/50">Una aplicación hecha por</p>
            <div className="flex items-center gap-2.5">
              <img
                src="/images/ideas_haus_sinFondo.svg"
                alt=""
                width={148}
                height={52}
                className="h-10 md:h-11 w-auto opacity-95"
              />
              <span className="text-base md:text-lg font-bold tracking-tight text-base-content/90">
                IdeasHaus
              </span>
            </div>
          </div>

          <div className="flex gap-4 text-xs text-base-content/45">
            <Link href="/settings" className="hover:text-primary">
              Configuración
            </Link>
            <Link href="/login" className="hover:text-primary">
              Ingresar
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
