"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

/** Soporta links del tipo /restablecer-contrasena/UUID (token en la ruta). */
export default function RestablecerContrasenaTokenPage() {
  const router = useRouter();
  const params = useParams();
  const token = typeof params.token === "string" ? params.token : "";

  useEffect(() => {
    if (!token) {
      router.replace("/restablecer-contrasena");
      return;
    }
    router.replace(`/restablecer-contrasena?token=${encodeURIComponent(token)}`);
  }, [token, router]);

  return (
    <main className="flex min-h-screen items-center justify-center">
      <span className="loading loading-spinner loading-lg text-primary" />
    </main>
  );
}
