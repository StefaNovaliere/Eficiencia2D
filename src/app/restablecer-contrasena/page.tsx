"use client";

import { Suspense } from "react";
import ResetPasswordScreen from "@/components/ResetPasswordScreen";

export default function RestablecerContrasenaPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center">
          <span className="loading loading-spinner loading-lg text-primary" />
        </main>
      }
    >
      <ResetPasswordScreen />
    </Suspense>
  );
}
