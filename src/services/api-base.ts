const DEFAULT_LOCAL = "http://localhost:8081";
// Fallback SÓLO si no está seteada la env `NEXT_PUBLIC_API_URL` (Vercel). En
// producción la env manda; este valor mantiene el fallback alineado con el
// backend actual (GCP detrás de HTTPS: api.eficiencia2d.com.ar).
const DEFAULT_REMOTE = "https://api.eficiencia2d.com.ar";
const HEALTH_CHECK_TIMEOUT_MS = 1500;

let cachedBaseUrl: string | null = null;
let resolvePromise: Promise<string> | null = null;

export interface ApiFetchOptions {
  /** JWT de sesión — se envía como `Authorization: Bearer …`. */
  token?: string;
  /** Solo para flujos basados en cookies (no JWT). */
  useCookies?: boolean;
}

function normalizeBaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/$/, "");
  if (!/^https?:\/\//i.test(trimmed)) {
    return `https://${trimmed.replace(/^\//, "")}`;
  }
  return trimmed;
}

export function getLocalApiUrl(): string {
  return normalizeBaseUrl(
    process.env.NEXT_PUBLIC_LOCAL_API_URL ?? DEFAULT_LOCAL,
  );
}

export function getRemoteApiUrl(): string {
  return normalizeBaseUrl(
    process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_REMOTE,
  );
}

async function isApiReachable(baseUrl: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
    const res = await fetch(`${baseUrl}/`, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

/** Resuelve la URL del backend: localhost primero, remoto si no responde. */
export async function resolveApiBaseUrl(force = false): Promise<string> {
  if (!force && cachedBaseUrl) return cachedBaseUrl;
  if (!force && resolvePromise) return resolvePromise;

  resolvePromise = (async () => {
    const local = getLocalApiUrl();
    const remote = getRemoteApiUrl();

    if (await isApiReachable(local)) {
      cachedBaseUrl = local;
      return local;
    }

    cachedBaseUrl = remote;
    return remote;
  })();

  try {
    return await resolvePromise;
  } finally {
    resolvePromise = null;
  }
}

export function invalidateApiBaseUrl(): void {
  cachedBaseUrl = null;
}

function cloneRequestBody(body: BodyInit | null | undefined): BodyInit | null | undefined {
  if (body instanceof FormData) {
    const clone = new FormData();
    for (const [key, value] of body.entries()) {
      clone.append(key, value);
    }
    return clone;
  }
  return body;
}

function buildRequestInit(init: RequestInit | undefined, options?: ApiFetchOptions): RequestInit {
  const headers = new Headers(init?.headers);

  if (options?.token) {
    headers.set("Authorization", `Bearer ${options.token}`);
  }

  return {
    ...init,
    headers,
    ...(options?.useCookies ? { credentials: "include" as RequestCredentials } : {}),
  };
}

async function fetchAtBase(
  baseUrl: string,
  path: string,
  init: RequestInit,
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, init);
}

/**
 * Fetch al backend con fallback local → remoto.
 * JWT: pasar `options.token` (sin `credentials: "include"`).
 * Cookies: pasar `options.useCookies: true`.
 */
export async function fetchWithApiFallback(
  path: string,
  init?: RequestInit,
  options?: ApiFetchOptions,
): Promise<Response> {
  let baseUrl = await resolveApiBaseUrl();
  const requestInit = buildRequestInit(init, options);

  try {
    return await fetchAtBase(baseUrl, path, requestInit);
  } catch (error) {
    invalidateApiBaseUrl();
    baseUrl = await resolveApiBaseUrl(true);

    try {
      const retryInit: RequestInit = {
        ...requestInit,
        body: cloneRequestBody(requestInit.body),
      };
      return await fetchAtBase(baseUrl, path, retryInit);
    } catch (retryError) {
      const message =
        retryError instanceof TypeError || error instanceof TypeError
          ? "No se pudo conectar al servidor. Verificá que el backend esté en ejecución."
          : undefined;
      throw message ? new Error(message) : retryError ?? error;
    }
  }
}
