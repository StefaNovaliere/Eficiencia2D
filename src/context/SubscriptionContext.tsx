"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/context/AuthContext";
import {
  cancelarSuscripcion,
  findPlanByNumericId,
  getMiSuscripcion,
  getPlanes,
  seleccionarPlan,
  type Plan,
  type SeleccionPlanResult,
  type Suscripcion,
} from "@/services/planes";

interface SubscriptionContextType {
  planes: Plan[];
  suscripcion: Suscripcion | null;
  /** Plan vigente resuelto del catálogo (o null). */
  currentPlan: Plan | null;
  isLoading: boolean;
  error: string | null;
  /** true si el estado se resolvió localmente (backend no disponible). */
  unavailable: boolean;
  /** Selecciona un plan. Si es pago, devuelve `checkout` (la UI lleva a /payment). */
  selectPlan: (
    plan: Plan,
    options?: { cuponCodigo?: string; mpPaymentId?: string; bypassKey?: string },
  ) => Promise<SeleccionPlanResult>;
  cancelar: () => Promise<void>;
  refresh: () => Promise<void>;
}

const SubscriptionContext = createContext<SubscriptionContextType | undefined>(undefined);

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const { token, isLoadingAuth } = useAuth();
  const [planes, setPlanes] = useState<Plan[]>([]);
  const [suscripcion, setSuscripcion] = useState<Suscripcion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const [isLoadingPlanes, setIsLoadingPlanes] = useState(true);
  const [isLoadingSub, setIsLoadingSub] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setIsLoadingPlanes(true);
    try {
      setPlanes(await getPlanes());
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar los planes");
    } finally {
      setIsLoadingPlanes(false);
    }
    if (token) {
      setIsLoadingSub(true);
      try {
        const subFetch = await getMiSuscripcion(token);
        setSuscripcion(subFetch.suscripcion);
        setUnavailable(subFetch.unavailable);
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se pudo cargar tu suscripción");
      } finally {
        setIsLoadingSub(false);
      }
    }
  }, [token]);

  // Catálogo público: se trae siempre (haya o no sesión) para que /planes y el
  // chip de la barra funcionen también deslogueado.
  useEffect(() => {
    let cancelled = false;
    setIsLoadingPlanes(true);
    getPlanes()
      .then((data) => {
        if (!cancelled) setPlanes(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "No se pudieron cargar los planes");
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingPlanes(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Suscripción del usuario: sólo con sesión.
  useEffect(() => {
    if (isLoadingAuth) return;
    if (!token) {
      setSuscripcion(null);
      setUnavailable(false);
      return;
    }
    let cancelled = false;
    setIsLoadingSub(true);
    getMiSuscripcion(token)
      .then((subFetch) => {
        if (cancelled) return;
        setSuscripcion(subFetch.suscripcion);
        setUnavailable(subFetch.unavailable);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "No se pudo cargar tu suscripción");
      })
      .finally(() => {
        if (!cancelled) setIsLoadingSub(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, isLoadingAuth]);

  const isLoadingCombined = isLoadingPlanes || isLoadingSub;

  const currentPlan =
    (suscripcion?.plan_id != null &&
      (findPlanByNumericId(planes, Number(suscripcion.plan_id)) ??
        planes.find(
          (p) =>
            p.id === suscripcion.plan_id ||
            p.slug === suscripcion.plan_id,
        ))) ||
    null;

  const selectPlan = useCallback(
    async (
      plan: Plan,
      options?: { cuponCodigo?: string; mpPaymentId?: string; bypassKey?: string },
    ): Promise<SeleccionPlanResult> => {
      if (!token) throw new Error("Tenés que iniciar sesión para elegir un plan");
      const result = await seleccionarPlan(token, plan, options);
      if (result.kind === "activa") {
        setSuscripcion(result.suscripcion);
      }
      return result;
    },
    [token],
  );

  const cancelar = useCallback(async () => {
    if (!token) throw new Error("Tenés que iniciar sesión");
    const sub = await cancelarSuscripcion(token);
    setSuscripcion(sub);
  }, [token]);

  return (
    <SubscriptionContext.Provider
      value={{
        planes,
        suscripcion,
        currentPlan,
        isLoading: isLoadingCombined,
        error,
        unavailable,
        selectPlan,
        cancelar,
        refresh: load,
      }}
    >
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription() {
  const context = useContext(SubscriptionContext);
  if (!context) {
    throw new Error("useSubscription debe usarse dentro de SubscriptionProvider");
  }
  return context;
}
