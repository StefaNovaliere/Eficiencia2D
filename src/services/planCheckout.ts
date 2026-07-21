/** Checkout pendiente de un plan pago (entre /planes y /payment). */

export const PLAN_CHECKOUT_KEY = "e2d_plan_checkout";

export interface PlanCheckoutPayload {
  planId: string;
  planNumericId: number;
  planNombre: string;
  amount: number;
  moneda: string;
  periodo: "mes" | "año";
  /** Solo si el backend devolvió preapproval; si falta, se cobra con Wallet Brick. */
  checkoutUrl?: string;
  cuponCodigo?: string;
}

export function savePlanCheckout(payload: PlanCheckoutPayload): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(PLAN_CHECKOUT_KEY, JSON.stringify(payload));
}

export function loadPlanCheckout(): PlanCheckoutPayload | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(PLAN_CHECKOUT_KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as PlanCheckoutPayload;
    if (
      typeof data.planId !== "string" ||
      typeof data.amount !== "number" ||
      !Number.isFinite(data.amount) ||
      data.amount <= 0
    ) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export function clearPlanCheckout(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(PLAN_CHECKOUT_KEY);
}
