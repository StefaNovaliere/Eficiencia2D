"use client";

import { memo } from "react";
import Link from "next/link";
import { Cloud, Laptop, Smartphone, ArrowRight } from "lucide-react";

const FEATURES = [
  {
    step: "01 · guardar",
    title: "Un clic y queda en la nube",
    body: "Subís el .obj estando logueada y el proyecto queda guardado con el modelo, los cortes y las planchas.",
  },
  {
    step: "02 · retomar",
    title: "Desde cualquier dispositivo",
    body: "Abrís la app en la notebook o en el celular y seguís exactamente donde lo dejaste.",
  },
  {
    step: "03 · sincronizar",
    title: "Siempre actualizado",
    body: "Cada cambio se persiste en el servidor. No hace falta reenviar archivos ni versionar a mano.",
  },
];

function LandingCloud() {
  return (
    <section id="nube" className="landing-cloud-section">
      <div className="landing-cloud-bg" aria-hidden />

      <div className="landing-cloud-wrap">
        <p className="landing-cloud-kicker">tus proyectos, en la nube</p>

        <div className="landing-cloud-layout">
          <div className="landing-cloud-features">
            {FEATURES.map((f) => (
              <article key={f.step} className="landing-cloud-feature">
                <p className="landing-cloud-step">{f.step}</p>
                <h2 className="landing-cloud-title">{f.title}</h2>
                <p className="landing-cloud-lead">{f.body}</p>
              </article>
            ))}
          </div>

          <div className="landing-cloud-visual" aria-hidden>
            <div className="landing-cloud-glow" />
            <div className="landing-cloud-orbit">
              <div className="landing-cloud-orbit-item landing-cloud-orbit-laptop">
                <Laptop size={22} strokeWidth={1.5} />
              </div>
              <div className="landing-cloud-orbit-item landing-cloud-orbit-phone">
                <Smartphone size={18} strokeWidth={1.5} />
              </div>
            </div>
            <div className="landing-cloud-icon-wrap">
              <Cloud size={56} strokeWidth={1.25} />
            </div>
            <div className="landing-cloud-cards">
              <div className="landing-cloud-card landing-cloud-card-a">
                <span className="landing-cloud-card-ext">casa.obj</span>
              </div>
              <div className="landing-cloud-card landing-cloud-card-b">
                <span className="landing-cloud-card-ext">planchas.pdf</span>
              </div>
            </div>
            <div className="landing-cloud-sync-beam" />
          </div>
        </div>

        <div className="landing-cloud-outro-static">
          <Link href="/login" className="btn btn-primary gap-2 shadow-lg shadow-primary/30">
            Iniciar sesión
            <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    </section>
  );
}

export default memo(LandingCloud);
