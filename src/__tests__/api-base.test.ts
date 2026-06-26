import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const DEFAULT_LOCAL = "http://localhost:8081";
const REMOTE = "https://api.example.com";

function healthOk() {
  return { ok: true, status: 200 };
}

describe("fetchWithApiFallback", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_API_URL", REMOTE);
    delete process.env.NEXT_PUBLIC_LOCAL_API_URL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("usa local cuando responde", async () => {
    const fetchMock = vi.fn().mockResolvedValue(healthOk());
    vi.stubGlobal("fetch", fetchMock);

    const { fetchWithApiFallback } = await import("@/services/api-base");
    const res = await fetchWithApiFallback("/api/upload", { method: "POST" });

    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      `${DEFAULT_LOCAL}/`,
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `${DEFAULT_LOCAL}/api/upload`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("cae al remoto si local no responde", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(healthOk());

    vi.stubGlobal("fetch", fetchMock);

    const { fetchWithApiFallback } = await import("@/services/api-base");
    const res = await fetchWithApiFallback("/api/upload", { method: "POST" });

    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      `${DEFAULT_LOCAL}/`,
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `${REMOTE}/api/upload`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("lanza error claro si ningún backend responde", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);

    const { fetchWithApiFallback } = await import("@/services/api-base");

    await expect(fetchWithApiFallback("/api/upload")).rejects.toThrow(
      /No se pudo conectar al servidor/,
    );
  });

  it("clona FormData al reintentar tras fallo de red", async () => {
    const file = new File(["data"], "test.obj", { type: "text/plain" });
    const formData = new FormData();
    formData.append("file", file);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(healthOk())
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(healthOk())
      .mockResolvedValueOnce(healthOk());

    vi.stubGlobal("fetch", fetchMock);

    const { fetchWithApiFallback } = await import("@/services/api-base");
    await fetchWithApiFallback("/api/upload", { method: "POST", body: formData });

    const uploadCalls = fetchMock.mock.calls.filter(
      ([url]) => String(url).endsWith("/api/upload"),
    );
    expect(uploadCalls).toHaveLength(2);
    expect(uploadCalls[1][1]?.body).toBeInstanceOf(FormData);
    expect(uploadCalls[1][1]?.body).not.toBe(formData);
  });

  it("adjunta Authorization Bearer cuando hay token JWT", async () => {
    const fetchMock = vi.fn().mockResolvedValue(healthOk());
    vi.stubGlobal("fetch", fetchMock);

    const { fetchWithApiFallback } = await import("@/services/api-base");
    await fetchWithApiFallback(
      "/api/users/me/projects",
      { method: "POST" },
      { token: "jwt-test" },
    );

    const uploadCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/api/users/me/projects"),
    );
    const headers = uploadCall?.[1]?.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer jwt-test");
  });
});

describe("resolveApiBaseUrl", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_API_URL", REMOTE);
    delete process.env.NEXT_PUBLIC_LOCAL_API_URL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("prioriza local cuando responde el health check", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(healthOk()));

    const { resolveApiBaseUrl } = await import("@/services/api-base");
    expect(await resolveApiBaseUrl()).toBe(DEFAULT_LOCAL);
  });
});
