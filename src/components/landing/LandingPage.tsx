"use client";

import { useLayoutEffect, useRef } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ArrowRight } from "lucide-react";
import NeonThemeSwitch from "@/components/NeonThemeSwitch";
import {
  scheduleLandingScrollRefresh,
  setupLandingTail,
  whenLandingSectionsReady,
} from "./landingScroll";

const CasaExplode = dynamic(() => import("./CasaExplode"), { ssr: false });
const LandingPlans = dynamic(() => import("./LandingPlans"), { ssr: false });
const LandingCta = dynamic(() => import("./LandingCta"), { ssr: false });

export default function LandingPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const footerRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    gsap.registerPlugin(ScrollTrigger);
    const ctx = gsap.context(() => {
      gsap.fromTo(
        navRef.current,
        { y: -60, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.8, ease: "power3.out", delay: 0.15 },
      );

    }, containerRef);

    let tailCleanup = () => {};
    const cancelWait = whenLandingSectionsReady(["planes", "probar"], () => {
      requestAnimationFrame(() => {
        const plans = document.getElementById("planes");
        const cta = document.getElementById("probar");
        if (!plans || !cta) return;

        tailCleanup = setupLandingTail({
          snapSections: [plans, cta],
          ctaSection: cta,
          footer: footerRef.current,
        });
        scheduleLandingScrollRefresh();
      });
    });

    const cancelRefresh = scheduleLandingScrollRefresh();

    return () => {
      cancelWait();
      tailCleanup();
      cancelRefresh();
      ctx.revert();
    };
  }, []);

  return (
    <div ref={containerRef} className="landing-root relative overflow-x-clip bg-base-200 text-base-content">
      <nav
        ref={navRef}
        className="landing-nav absolute top-0 inset-x-0 z-50 flex items-center justify-between gap-4 px-4 md:px-8 py-4 border-b border-base-300/30 bg-base-100/70 backdrop-blur-xl"
      >
        <Link href="/" className="flex items-center gap-2.5 font-bold tracking-tight shrink-0">
          <img src="/images/logoFaviconE2d.svg" alt="" width={28} height={28} className="w-7 h-7 e2d-logo-glow" />
          <span className="hidden sm:inline">Eficiencia2D</span>
        </Link>
        <div className="hidden md:flex items-center gap-8 text-sm text-base-content/60">
          <a href="#recorrido" className="hover:text-primary transition-colors">
            Recorrido
          </a>
          <a href="#planes" className="hover:text-primary transition-colors">
            Planes
          </a>
          <a href="#probar" className="hover:text-primary transition-colors">
            Probar
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

      <CasaExplode />

      <LandingPlans />

      <LandingCta />

      <footer
        ref={footerRef}
        className="landing-footer border-t border-base-300/40 py-8 md:py-10 px-4 md:px-8"
      >
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6 md:gap-8">

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
