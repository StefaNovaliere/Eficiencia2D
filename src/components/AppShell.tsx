"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings, Sun, Moon } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";

// Rutas inmersivas del flujo: son pantallas full-screen (`fixed inset-0`) con su
// propio chrome (paso, volver, herramientas). Ahí NO mostramos la barra global.
const FLOW_ROUTES = ["/review", "/nesting", "/payment"];

function TopBar({ isAuthPage }: { isAuthPage: boolean }) {
  const { user, isLoadingAuth, isAuthenticated } = useAuth();
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <header className="sticky top-0 z-40 h-14 shrink-0 flex items-center justify-between gap-3 px-4 md:px-6 border-b border-base-300/50 bg-base-100/80 backdrop-blur-md">
      <Link href="/" className="flex items-center gap-2 font-bold tracking-tight" aria-label="Ir al inicio">
        <img src="/images/logoFaviconE2d.svg" alt="" width={28} height={28} className="w-7 h-7 e2d-logo-glow" />
        <span className="hidden sm:inline">Eficiencia2D</span>
      </Link>

      <div className="flex items-center gap-1.5">
        
        <Link
          href="/settings"
          className="btn btn-ghost btn-sm btn-circle"
          title="Configuración"
          aria-label="Configuración"
        >
          <Settings size={16} />
        </Link>

        {!isAuthPage && (
          isLoadingAuth ? (
            <span className="loading loading-spinner loading-sm text-primary ml-1" />
          ) : isAuthenticated && user ? (
            <span className="hidden sm:inline text-sm text-base-content/70 ml-1">
              {user.nombre || user.email}
            </span>
          ) : (
            <>
              <Link href="/login" className="btn btn-primary btn-outline btn-sm">Ingresar</Link>
            </>
          )
        )}
      </div>
    </header>
  );
}

/**
 * Shell de la app: barra superior persistente en las páginas estándar
 * (Inicio, Configuración, Login/Registro). Da identidad y navegación
 * consistente (logo→inicio, tema, auth) en un solo lugar, reemplazando los
 * botones flotantes sueltos en las esquinas.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const isFlow = FLOW_ROUTES.some((r) => pathname.startsWith(r));

  if (isFlow) return <>{children}</>;

  const isAuthPage =
    pathname === "/login" ||
    pathname === "/register" ||
    pathname.startsWith("/verify-email");
  return (
    <>
      <TopBar isAuthPage={isAuthPage} />
      {children}
    </>
  );
}
