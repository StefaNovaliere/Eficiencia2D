"use client";

import Link from "next/link";
import { Shield } from "lucide-react";
import AdminCuponesSection from "@/components/AdminCuponesSection";
import type { AuthUser } from "@/services/auth";

interface AdminPanelProps {
  user: AuthUser;
}

export default function AdminPanel({ user }: AdminPanelProps) {
  const displayName = user.nombre || user.email;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-primary/20 bg-primary/5 p-5 md:p-6">
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-primary/15 text-primary shrink-0">
            <Shield size={24} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-primary/80 mb-1">
              Sesión de administrador
            </p>
            <h2 className="text-xl font-bold tracking-tight truncate">{displayName}</h2>
            <p className="text-sm text-base-content/60 mt-1">{user.email}</p>
            <div className="flex flex-wrap gap-2 mt-3">
              <span className="badge badge-primary badge-outline capitalize">{user.rol}</span>
              <span className="badge badge-ghost capitalize">{user.estado.replace(/_/g, " ")}</span>
            </div>
          </div>
        </div>
      </section>

      <AdminCuponesSection />

      <section className="pt-2 border-t border-base-300/40">
        <p className="text-xs text-base-content/50 leading-relaxed">
          Este panel está reservado para cuentas con rol{" "}
          <code className="bg-base-300 px-1 py-0.5 rounded">admin</code>.
        </p>
        <Link
          href="/settings"
          className="inline-flex text-sm text-primary font-medium hover:underline mt-3"
        >
          Ir a configuración de cuenta →
        </Link>
      </section>
    </div>
  );
}
