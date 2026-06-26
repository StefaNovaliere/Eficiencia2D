"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/** Alias legacy → ruta canónica del backend. */
function VerifyEmailRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  useEffect(() => {
    const target = token
      ? `/verificar-correo?token=${encodeURIComponent(token)}`
      : "/verificar-correo";
    router.replace(target);
  }, [token, router]);

  return (
    <main className="flex min-h-screen items-center justify-center">
      <span className="loading loading-spinner loading-lg text-primary" />
    </main>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center">
          <span className="loading loading-spinner loading-lg text-primary" />
        </main>
      }
    >
      <VerifyEmailRedirect />
    </Suspense>
  );
}
