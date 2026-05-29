import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "@/app/api/mp/bypass/route";

describe("/api/mp/bypass", () => {
  const originalEnv = process.env.MP_BYPASS_KEY;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.MP_BYPASS_KEY = originalEnv;
    } else {
      delete process.env.MP_BYPASS_KEY;
    }
  });

  function makeRequest(body: unknown) {
    return new Request("http://localhost/api/mp/bypass", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("returns valid:true when key matches MP_BYPASS_KEY", async () => {
    process.env.MP_BYPASS_KEY = "secreto123";
    const res = await POST(makeRequest({ key: "secreto123" }));
    const data = await res.json();
    expect(data.valid).toBe(true);
  });

  it("returns valid:false when key does not match", async () => {
    process.env.MP_BYPASS_KEY = "secreto123";
    const res = await POST(makeRequest({ key: "wrong" }));
    const data = await res.json();
    expect(data.valid).toBe(false);
  });

  it("returns valid:false when key is empty string", async () => {
    process.env.MP_BYPASS_KEY = "secreto123";
    const res = await POST(makeRequest({ key: "" }));
    const data = await res.json();
    expect(data.valid).toBe(false);
  });

  it("returns valid:false when MP_BYPASS_KEY is not set", async () => {
    delete process.env.MP_BYPASS_KEY;
    const res = await POST(makeRequest({ key: "anything" }));
    const data = await res.json();
    expect(data.valid).toBe(false);
  });

  it("returns valid:false on malformed body", async () => {
    process.env.MP_BYPASS_KEY = "secreto123";
    const req = new Request("http://localhost/api/mp/bypass", {
      method: "POST",
      body: "not json",
    });
    const res = await POST(req);
    const data = await res.json();
    expect(data.valid).toBe(false);
  });
});
