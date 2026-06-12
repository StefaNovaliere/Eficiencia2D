const DEFAULT_LOCAL = "http://localhost:8081";
const DEFAULT_REMOTE = "https://eficiencia.mykonosboutique.com.ar";
const HEALTH_CHECK_TIMEOUT_MS = 1500;

let cachedBaseUrl: string | null = null;
let resolvePromise: Promise<string> | null = null;

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
