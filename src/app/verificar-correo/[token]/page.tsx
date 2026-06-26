"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

/** Soporta links del tipo /verificar-correo/UUID (token en la ruta). */
export default function VerificarCorreoTokenPage() {
  const router = useRouter();
  const params = useParams();
  const token = typeof params.token === "string" ? params.token : "";

  useEffect(() => {
    if (!token) {
      router.replace("/verificar-correo");
      return;
    }
    router.replace(`/verificar-correo?token=${encodeURIComponent(token)}`);
  }, [token, router]);

  return (
    <main className="flex min-h-screen items-center justify-center">
      <span className="loading loading-spinner loading-lg text-primary" />
    </main>
  );
}
