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
          <img src="/images/logoFaviconE2d.svg" alt="" width={54} height={24} className="h-6 w-auto e2d-logo-glow" />
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
    </div>  );
}
