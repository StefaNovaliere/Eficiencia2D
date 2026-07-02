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
  /** Selecciona un plan. Si devuelve checkout, redirige a pagar. */
  selectPlan: (plan: Plan) => Promise<SeleccionPlanResult>;
  cancelar: () => Promise<void>;
  refresh: () => Promise<void>;
}

const SubscriptionContext = createContext<SubscriptionContextType | undefined>(undefined);

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const { token, isLoadingAuth } = useAuth();
  const [planes, setPlanes] = useState<Plan[]>([]);
  const [suscripcion, setSuscripcion] = useState<Suscripcion | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setError(null);
    try {
      const [planesData, subFetch] = await Promise.all([
        getPlanes(),
        getMiSuscripcion(token),
      ]);
      setPlanes(planesData);
      setSuscripcion(subFetch.suscripcion);
      setUnavailable(subFetch.unavailable);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar los planes");
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (isLoadingAuth) return;
    if (!token) {
      setPlanes([]);
      setSuscripcion(null);
      setError(null);
      setUnavailable(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    Promise.all([getPlanes(), getMiSuscripcion(token)])
      .then(([planesData, subFetch]) => {
        if (cancelled) return;
        setPlanes(planesData);
        setSuscripcion(subFetch.suscripcion);
        setUnavailable(subFetch.unavailable);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "No se pudieron cargar los planes");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, isLoadingAuth]);

  const currentPlan =
    (suscripcion?.plan_id != null &&
      planes.find((p) => p.id === suscripcion.plan_id)) ||
    null;

  const selectPlan = useCallback(
    async (plan: Plan): Promise<SeleccionPlanResult> => {
      if (!token) throw new Error("Tenés que iniciar sesión para elegir un plan");
      const result = await seleccionarPlan(token, plan);
      if (result.kind === "checkout") {
        if (typeof window !== "undefined") window.location.href = result.url;
        return result;
      }
      setSuscripcion(result.suscripcion);
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
        isLoading,
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
