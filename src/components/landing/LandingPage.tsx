"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ArrowRight } from "lucide-react";
import { useViewerPalette } from "@/context/ThemeContext";
import NeonThemeSwitch from "@/components/NeonThemeSwitch";


const CasaExplode = dynamic(() => import("./CasaExplode"), { ssr: false });

export default function LandingPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
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
