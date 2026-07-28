"use client";

import { GoogleOAuthProvider } from "@react-oauth/google";
import type { ReactNode } from "react";

const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";

/**
 * Envuelve la app con GoogleOAuthProvider.
 * Sin `NEXT_PUBLIC_GOOGLE_CLIENT_ID` solo renderiza los children (el botón no se muestra).
 */
export default function GoogleOAuthClientProvider({ children }: { children: ReactNode }) {
  if (!googleClientId) {
    return <>{children}</>;
  }

  return <GoogleOAuthProvider clientId={googleClientId}>{children}</GoogleOAuthProvider>;
}
