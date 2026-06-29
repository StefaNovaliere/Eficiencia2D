"use client";

import { memo } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

function LandingCta() {
  return (
    <section id="probar" className="landing-cta-section">
      <div className="landing-cta-bridge" aria-hidden />
      <div className="landing-cta-glow-static" aria-hidden />

      <div className="landing-cta-content">
        <p className="landing-cta-kicker">04 · probá la app</p>
        <div className="landing-cta-inner max-w-xl mx-auto text-center p-10 md:p-12 rounded-3xl border border-primary/30 bg-gradient-to-br from-primary/12 via-base-100/80 to-secondary/10 shadow-[0_0_60px_color-mix(in_oklch,var(--color-primary)_12%,transparent)]">
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
    </section>
  );
}

export default memo(LandingCta);
