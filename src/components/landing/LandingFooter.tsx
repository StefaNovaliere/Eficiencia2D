import Link from "next/link";

export default function LandingFooter() {
  return (
    <footer className="landing-footer border-t border-base-300/40 py-6 md:py-8 px-4 md:px-8">
      <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-5 md:gap-8">
        <div className="flex items-center gap-3">
          <img
            src="/images/logoFaviconE2d.svg"
            alt=""
            width={54}
            height={24}
            className="h-6 w-auto e2d-logo-glow"
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
  );
}
