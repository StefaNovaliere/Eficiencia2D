/** FastAPI: `{ "detail": "Mensaje de error en español" }` (o lista de validación). */
export async function parseApiError(res: Response, fallback: string): Promise<never> {
  const errorData = await res.json().catch(() => null);
  const detail = errorData?.detail;

  if (typeof detail === "string") {
    throw new Error(detail);
  }

  if (Array.isArray(detail) && detail.length > 0) {
    const first = detail[0];
    if (typeof first?.msg === "string") {
      throw new Error(first.msg);
    }
  }

  throw new Error(fallback);
}

/** Cabeceras para endpoints protegidos con JWT (sin cookies). */
export function authHeaders(token: string, extra?: HeadersInit): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    ...extra,
  };
}
