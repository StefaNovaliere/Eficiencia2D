"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import CommandPalette from "@/components/command/CommandPalette";
import FlowBottomBar from "@/components/shell/FlowBottomBar";
import { useCommandHotkey } from "@/components/command/useCommandHotkey";

// Rutas inmersivas del flujo: son pantallas full-screen (`fixed inset-0`) con su
// propio chrome (paso, volver, herramientas). Ahí NO mostramos la barra global.
const FLOW_ROUTES = ["/review", "/nesting", "/payment"];

// Landing de marketing: navegación propia, sin TopBar global.
const STANDALONE_ROUTES = ["/"];

function TopBar({ isAuthPage }: { isAuthPage: boolean }) {
  const { user, isLoadingAuth, isAuthenticated, isAdmin } = useAuth();

  return (
    <header className="e2d-topbar sticky top-0 z-40 h-14 shrink-0 flex items-center justify-between gap-3 px-4 md:px-6 border-b border-base-300/50 bg-base-100/80 backdrop-blur-md">
      <Link href="/home" className="flex items-center gap-2 font-bold tracking-tight" aria-label="Ir al inicio">
        <img src="/images/logoFaviconE2d.svg" alt="" width={54} height={24} className="h-6 w-auto e2d-logo-glow" />
        <span className="hidden sm:inline">Eficiencia2D</span>
      </Link>

      <div className="flex items-center gap-1.5">
        {!isAuthPage && !isLoadingAuth && !isAuthenticated && (
          <Link href="/planes" className="btn btn-ghost btn-sm" title="Ver planes">
            Planes
          </Link>
        )}

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
            isAdmin ? (
              <Link
                href="/admin"
                className="btn btn-ghost btn-sm ml-1 max-w-[12rem] truncate font-medium text-primary hover:bg-primary/10"
                title="Panel de administración"
              >
                {user.nombre || user.email}
              </Link>
            ) : (
              <span className="hidden sm:inline text-sm text-base-content/70 ml-1 truncate max-w-[12rem]">
                {user.nombre || user.email}
              </span>
            )
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
  // Atajo global ⌘K + palette montada UNA vez para TODAS las rutas (incluido el
  // flujo full-screen, donde más falta hace).
  useCommandHotkey();

  const isFlow = FLOW_ROUTES.some((r) => pathname.startsWith(r));
  const isStandalone = STANDALONE_ROUTES.includes(pathname);

  const isAuthPage =
    pathname === "/login" ||
    pathname === "/register" ||
    pathname.startsWith("/verificar-correo") ||
    pathname.startsWith("/verify-email") ||
    pathname.startsWith("/olvide-contrasena") ||
    pathname.startsWith("/restablecer-contrasena");

  const content =
    isFlow || isStandalone ? (
      <>{children}</>
    ) : (
      <>
        <TopBar isAuthPage={isAuthPage} />
        {children}
      </>
    );

  return (
    <>
      {content}
      {/* Barra de navegación constante + entrada visible al palette (sólo en el flujo). */}
      {isFlow && <FlowBottomBar />}
      <CommandPalette />
    </>
  );
}
