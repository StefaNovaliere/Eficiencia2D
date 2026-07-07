"use client";

import { memo, useLayoutEffect, useRef } from "react";
import Link from "next/link";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ArrowRight, Check, Sparkles } from "lucide-react";
import { MOCK_PLANES, type Plan } from "@/services/planes";
import { revealOnSectionLand, scheduleLandingScrollRefresh } from "./landingScroll";

function formatPrecio(plan: Plan): string {
  if (plan.precio_mensual <= 0) return "Gratis";
  const monto = plan.precio_mensual.toLocaleString("es-AR");
  const periodo = plan.periodo === "año" ? "año" : "mes";
  return `${plan.moneda} ${monto}/${periodo}`;
}

function LandingPlans() {
  const sectionRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    gsap.registerPlugin(ScrollTrigger);

    const section = sectionRef.current;
    const header = headerRef.current;
    const grid = gridRef.current;
    const cta = ctaRef.current;
    if (!section || !header || !grid) return;

    const cards = grid.querySelectorAll<HTMLElement>(".landing-plans-card");

    gsap.set(header, { y: 36, autoAlpha: 0 });
    gsap.set(cards, { x: -48, autoAlpha: 0 });
    if (cta) gsap.set(cta, { y: 24, autoAlpha: 0 });

    let cleanupReveal = () => {};
    const ctx = gsap.context(() => {
      cleanupReveal = revealOnSectionLand(section, () => {
        gsap.to(header, { y: 0, autoAlpha: 1, duration: 0.75, ease: "power3.out", overwrite: "auto" });
        gsap.to(cards, {
          x: 0,
          autoAlpha: 1,
          duration: 0.8,
          stagger: 0.12,
          ease: "power3.out",
          delay: 0.08,
          overwrite: "auto",
        });
        if (cta) {
          gsap.to(cta, {
            y: 0,
            autoAlpha: 1,
            duration: 0.65,
            ease: "power2.out",
            delay: 0.2,
            overwrite: "auto",
          });
        }
      });
    }, section);

    const cancelRefresh = scheduleLandingScrollRefresh();

    return () => {
      cleanupReveal();
      cancelRefresh();
      ctx.revert();
    };
  }, []);

  return (
    <section ref={sectionRef} id="planes" className="landing-plans-section">
      <div className="landing-plans-bg" aria-hidden />

      <div className="landing-plans-inner">
        <div ref={headerRef} className="landing-plans-header">
          <p className="landing-plans-kicker">07 · planes</p>
          <h2 className="text-2xl md:text-4xl font-extrabold tracking-tight e2d-title-glow">
            Elegí cómo querés trabajar
          </h2>
          <p className="landing-plans-lead">
            Empezá gratis y pasá a un plan pago cuando lo necesites. Sin apuro.
          </p>
        </div>

        <div ref={gridRef} className="landing-plans-grid">
          {MOCK_PLANES.map((plan) => (
            <article
              key={plan.id}
              className={`landing-plans-card${plan.destacado ? " landing-plans-card--featured" : ""}`}
            >
              {plan.destacado && (
                <span className="landing-plans-badge">
                  <Sparkles size={11} />
                  Recomendado
                </span>
              )}

              <h3 className="text-lg font-bold">{plan.nombre}</h3>
              <p className="landing-plans-price">{formatPrecio(plan)}</p>
              <p className="text-sm text-base-content/55 mt-1">{plan.descripcion}</p>

              <ul className="landing-plans-features">
                {plan.features.map((feature) => (
                  <li key={feature}>
                    <Check size={14} className="text-primary shrink-0" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>

        <div ref={ctaRef} className="landing-plans-cta">
          <Link href="/planes" className="btn btn-primary btn-lg gap-2 shadow-xl shadow-primary/30 px-8">
            Conocer todos los planes
            <ArrowRight size={18} />
          </Link>
          <p className="text-xs text-base-content/45 mt-3">
            Cupones, suscripción y facturación en la página de planes.
          </p>
        </div>
      </div>
    </section>
  );
}

export default memo(LandingPlans);
