"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

/** Soporta links del tipo /verify-email/UUID (token en la ruta). */
export default function VerifyEmailTokenPage() {
  const router = useRouter();
  const params = useParams();
  const token = typeof params.token === "string" ? params.token : "";

  useEffect(() => {
    if (!token) {
      router.replace("/verify-email");
      return;
    }
    router.replace(`/verify-email?token=${encodeURIComponent(token)}`);
  }, [token, router]);

  return (
    <main className="flex min-h-screen items-center justify-center">
      <span className="loading loading-spinner loading-lg text-primary" />
    </main>
  );
}
