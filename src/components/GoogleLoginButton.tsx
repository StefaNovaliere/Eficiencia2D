"use client";

import { GoogleLogin, type CredentialResponse } from "@react-oauth/google";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";

interface GoogleLoginButtonProps {
  /** Texto del botón oficial de Google. */
  text?: "signin_with" | "signup_with" | "continue_with" | "signin";
  /** Callback opcional para mostrar errores en el formulario padre. */
  onError?: (message: string) => void;
  disabled?: boolean;
}

/**
 * Botón oficial de Google Sign-In.
 * En éxito: extrae `credential` (JWT) y lo valida vía `POST /api/auth/google`.
 */
export default function GoogleLoginButton({
  text = "signin_with",
  onError,
  disabled = false,
}: GoogleLoginButtonProps) {
  const router = useRouter();
  const { loginWithGoogle } = useAuth();
  const containerRef = useRef<HTMLDivElement>(null);
  const [buttonWidth, setButtonWidth] = useState(320);
  const [isLoading, setIsLoading] = useState(false);

  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateWidth = () => {
      const next = Math.floor(el.getBoundingClientRect().width);
      if (next > 0) setButtonWidth(next);
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  async function handleSuccess(response: CredentialResponse) {
    const credential = response.credential;
    if (!credential) {
      onError?.("Google no devolvió una credencial válida.");
      return;
    }

    setIsLoading(true);
    try {
      await loginWithGoogle(credential);
      router.push("/home");
    } catch (err) {
      onError?.(
        err instanceof Error ? err.message : "No se pudo iniciar sesión con Google",
      );
    } finally {
      setIsLoading(false);
    }
  }

  function handleError() {
    onError?.("Inicio de sesión con Google cancelado o fallido. Intentá de nuevo.");
  }

  if (!clientId) return null;

  return (
    <div ref={containerRef} className="relative w-full">
      {(isLoading || disabled) && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-base-100/70"
          aria-busy={isLoading}
          aria-live="polite"
        >
          {isLoading && <span className="loading loading-spinner loading-sm text-primary" />}
        </div>
      )}
      <div className={`flex w-full justify-center ${disabled || isLoading ? "pointer-events-none opacity-60" : ""}`}>
        <GoogleLogin
          onSuccess={handleSuccess}
          onError={handleError}
          useOneTap={false}
          theme="outline"
          size="large"
          text={text}
          shape="rectangular"
          width={buttonWidth}
        />
      </div>
    </div>
  );
}
