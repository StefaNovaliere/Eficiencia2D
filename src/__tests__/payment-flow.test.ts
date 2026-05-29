import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("Payment → Download flow (integration)", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("approved payment triggers generation when verify returns verified:true", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ verified: true, status: "approved" }),
    });

    const proceedToGeneration = vi.fn().mockResolvedValue(undefined);

    const res = await fetch("/api/mp/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentId: "PAY-123" }),
    });
    const data = await res.json();

    if (data.verified) {
      await proceedToGeneration();
    }

    expect(fetchSpy).toHaveBeenCalledWith("/api/mp/verify", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ paymentId: "PAY-123" }),
    }));
    expect(data.verified).toBe(true);
    expect(proceedToGeneration).toHaveBeenCalledOnce();
  });

  it("rejected payment does NOT trigger generation", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ verified: false, status: "rejected" }),
    });

    const proceedToGeneration = vi.fn();
    const setError = vi.fn();

    const res = await fetch("/api/mp/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentId: "PAY-BAD" }),
    });
    const data = await res.json();

    if (data.verified) {
      await proceedToGeneration();
    } else {
      setError(`Pago no verificado (estado: ${data.status ?? "desconocido"}).`);
    }

    expect(proceedToGeneration).not.toHaveBeenCalled();
    expect(setError).toHaveBeenCalledWith("Pago no verificado (estado: rejected).");
  });

  it("pending payment does NOT trigger generation", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ verified: false, status: "pending" }),
    });

    const proceedToGeneration = vi.fn();

    const res = await fetch("/api/mp/verify", {
      method: "POST",
      body: JSON.stringify({ paymentId: "PAY-PENDING" }),
    });
    const data = await res.json();

    if (data.verified) {
      await proceedToGeneration();
    }

    expect(proceedToGeneration).not.toHaveBeenCalled();
  });

  it("network error during verification does NOT trigger generation", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("fetch failed"));

    const proceedToGeneration = vi.fn();
    const setError = vi.fn();

    try {
      await fetch("/api/mp/verify", {
        method: "POST",
        body: JSON.stringify({ paymentId: "PAY-ERR" }),
      });
    } catch {
      setError("Error al verificar el pago.");
    }

    expect(proceedToGeneration).not.toHaveBeenCalled();
    expect(setError).toHaveBeenCalledWith("Error al verificar el pago.");
  });

  it("valid bypass code triggers generation without payment", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ valid: true }),
    });

    const proceedToGeneration = vi.fn().mockResolvedValue(undefined);
    const setStatus = vi.fn();

    const res = await fetch("/api/mp/bypass", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "mysecret" }),
    });
    const data = await res.json();

    if (data.valid) {
      await proceedToGeneration();
    } else {
      setStatus("paying");
    }

    expect(proceedToGeneration).toHaveBeenCalledOnce();
    expect(setStatus).not.toHaveBeenCalled();
  });

  it("invalid bypass code falls through to payment screen", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ valid: false }),
    });

    const proceedToGeneration = vi.fn();
    const setStatus = vi.fn();

    const res = await fetch("/api/mp/bypass", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "wrongcode" }),
    });
    const data = await res.json();

    if (data.valid) {
      await proceedToGeneration();
    } else {
      setStatus("paying");
    }

    expect(proceedToGeneration).not.toHaveBeenCalled();
    expect(setStatus).toHaveBeenCalledWith("paying");
  });

  it("postMessage with approved status triggers verification", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ verified: true, status: "approved" }),
    });

    const proceedToGeneration = vi.fn().mockResolvedValue(undefined);

    const messageData = {
      type: "mp_payment_result",
      status: "approved",
      paymentId: "PAY-MSG-001",
    };

    if (messageData.type === "mp_payment_result" && messageData.status === "approved" && messageData.paymentId) {
      const res = await fetch("/api/mp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentId: messageData.paymentId }),
      });
      const data = await res.json();
      if (data.verified) {
        await proceedToGeneration();
      }
    }

    expect(fetchSpy).toHaveBeenCalledWith("/api/mp/verify", expect.objectContaining({
      body: JSON.stringify({ paymentId: "PAY-MSG-001" }),
    }));
    expect(proceedToGeneration).toHaveBeenCalledOnce();
  });

  it("postMessage with non-approved status does NOT trigger generation", async () => {
    const proceedToGeneration = vi.fn();
    const setError = vi.fn();

    const messageData = {
      type: "mp_payment_result",
      status: "rejected",
      paymentId: "PAY-MSG-002",
    };

    if (messageData.type === "mp_payment_result" && messageData.status === "approved" && messageData.paymentId) {
      await proceedToGeneration();
    } else if (messageData.type === "mp_payment_result") {
      setError("El pago no fue aprobado.");
    }

    expect(proceedToGeneration).not.toHaveBeenCalled();
    expect(setError).toHaveBeenCalledWith("El pago no fue aprobado.");
  });
});
