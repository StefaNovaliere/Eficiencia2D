"use client";

import { Suspense } from "react";
import VerifyEmailScreen from "@/components/VerifyEmailScreen";

export default function VerificarCorreoPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center">
          <span className="loading loading-spinner loading-lg text-primary" />
        </main>
      }
    >
      <VerifyEmailScreen />
    </Suspense>
  );
}
