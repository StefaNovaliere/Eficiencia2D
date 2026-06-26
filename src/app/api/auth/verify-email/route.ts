import { NextRequest, NextResponse } from "next/server";

/**
 * Algunos mails de verificación apuntan a /api/auth/verify-email?token=...
 * en el dominio del frontend. Redirigimos a la página que hace POST al backend.
 */
export function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const target = new URL("/verificar-correo", request.url);

  if (token) {
    target.searchParams.set("token", token);
  }

  return NextResponse.redirect(target);
}
