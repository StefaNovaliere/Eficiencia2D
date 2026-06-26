"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import AuthForm from "@/components/AuthForm";

function LoginContent() {
  const searchParams = useSearchParams();
  const passwordUpdated = searchParams.get("passwordUpdated") === "1";

  return <AuthForm mode="login" passwordUpdatedNotice={passwordUpdated} />;
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center">
          <span className="loading loading-spinner loading-lg text-primary" />
        </main>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
