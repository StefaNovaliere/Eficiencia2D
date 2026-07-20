"use client";

import { memo, useLayoutEffect, useRef } from "react";
import Link from "next/link";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ArrowRight } from "lucide-react";
import { revealOnSectionLand, scheduleLandingScrollRefresh } from "./landingScroll";
import LandingFooter from "./LandingFooter";

function LandingCta() {
  const sectionRef = useRef<HTMLElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    gsap.registerPlugin(ScrollTrigger);

    const section = sectionRef.current;
    const inner = innerRef.current;
    const glow = glowRef.current;
    if (!section || !inner) return;

    gsap.set(inner, { x: "42vw", autoAlpha: 0, rotateY: -8, transformPerspective: 900 });
    if (glow) gsap.set(glow, { autoAlpha: 0, scale: 0.88 });

    const playReveal = () => {
      gsap.to(inner, {
        x: 0,
        autoAlpha: 1,
        rotateY: 0,
        duration: 0.95,
        ease: "power3.out",
        overwrite: "auto",
      });
      if (glow) {
        gsap.to(glow, {
          autoAlpha: 0.55,
          scale: 1,
          duration: 0.85,
          ease: "power2.out",
          delay: 0.1,
          overwrite: "auto",
        });
      }
    };

    let cleanupReveal = () => {};
    const ctx = gsap.context(() => {
      cleanupReveal = revealOnSectionLand(section, playReveal);
    }, section);

    const cancelRefresh = scheduleLandingScrollRefresh();

    return () => {
      cleanupReveal();
      cancelRefresh();
      ctx.revert();
    };
  }, []);

  return (
    <section ref={sectionRef} id="probar" className="landing-cta-section">
      <div className="landing-cta-pin">
        <div className="landing-cta-bridge" aria-hidden />
        <div ref={glowRef} className="landing-cta-glow-static" aria-hidden />

        <div className="landing-cta-content">
          <div
            ref={innerRef}
            className="landing-cta-inner max-w-xl mx-auto text-center p-10 md:p-12 rounded-3xl border border-primary/30 bg-gradient-to-br from-primary/12 via-base-100/80 to-secondary/10 shadow-[0_0_60px_color-mix(in_oklch,var(--color-primary)_12%,transparent)]"
          >
            <h2 className="text-2xl md:text-3xl font-extrabold mb-3 e2d-title-glow">
              Probar Eficiencia2D
            </h2>
            <p className="text-base-content/65 mb-8 leading-relaxed">
              Subí un .obj, recorré el visor 3D y llegá a tus planchas cuando estés listo.
            </p>
            <Link
              href="/home"
              className="btn btn-primary btn-lg gap-2 shadow-xl shadow-primary/35 px-10"
            >
              Ir a la app
              <ArrowRight size={18} />
            </Link>
          </div>
        </div>
      </div>

      <LandingFooter />
    </section>
  );
}

export default memo(LandingCta);
