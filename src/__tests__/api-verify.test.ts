import { describe, it, expect, vi, afterEach } from "vitest";

const mockGet = vi.fn();

vi.mock("mercadopago", () => {
  return {
    MercadoPagoConfig: class MercadoPagoConfig {
      constructor(_opts: any) {}
    },
    Payment: class Payment {
      get: typeof mockGet;
      constructor(_client: any) {
        this.get = mockGet;
      }
    },
  };
});

import { POST } from "@/app/api/mp/verify/route";

describe("/api/mp/verify", () => {
  const originalEnv = process.env.MP_ACCESS_TOKEN;

  afterEach(() => {
    vi.clearAllMocks();
    if (originalEnv !== undefined) {
      process.env.MP_ACCESS_TOKEN = originalEnv;
    } else {
      delete process.env.MP_ACCESS_TOKEN;
    }
  });

  function makeRequest(body: unknown) {
    return new Request("http://localhost/api/mp/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("returns verified:true when MP API returns approved", async () => {
    process.env.MP_ACCESS_TOKEN = "TEST-token";
    mockGet.mockResolvedValueOnce({ status: "approved" });

    const res = await POST(makeRequest({ paymentId: "12345" }));
    const data = await res.json();

    expect(data.verified).toBe(true);
    expect(data.status).toBe("approved");
    expect(mockGet).toHaveBeenCalledWith({ id: "12345" });
  });

  it("returns verified:false when MP API returns pending", async () => {
    process.env.MP_ACCESS_TOKEN = "TEST-token";
    mockGet.mockResolvedValueOnce({ status: "pending" });

    const res = await POST(makeRequest({ paymentId: "12345" }));
    const data = await res.json();

    expect(data.verified).toBe(false);
    expect(data.status).toBe("pending");
  });

  it("returns verified:false when MP API returns rejected", async () => {
    process.env.MP_ACCESS_TOKEN = "TEST-token";
    mockGet.mockResolvedValueOnce({ status: "rejected" });

    const res = await POST(makeRequest({ paymentId: "12345" }));
    const data = await res.json();

    expect(data.verified).toBe(false);
  });

  it("returns 500 when MP_ACCESS_TOKEN is not set", async () => {
    delete process.env.MP_ACCESS_TOKEN;
    const res = await POST(makeRequest({ paymentId: "12345" }));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBeTruthy();
  });

  it("returns 400 when paymentId is missing", async () => {
    process.env.MP_ACCESS_TOKEN = "TEST-token";
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it("returns 400 on malformed body", async () => {
    process.env.MP_ACCESS_TOKEN = "TEST-token";
    const req = new Request("http://localhost/api/mp/verify", {
      method: "POST",
      body: "not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 500 when MP API throws", async () => {
    process.env.MP_ACCESS_TOKEN = "TEST-token";
    mockGet.mockRejectedValueOnce(new Error("Network error"));

    const res = await POST(makeRequest({ paymentId: "12345" }));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.verified).toBe(false);
    expect(data.error).toContain("Network error");
  });
});
