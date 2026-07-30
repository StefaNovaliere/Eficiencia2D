"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Bot } from "lucide-react";
import GuidedTour from "./GuidedTour";
import {
  REVIEW_TOUR_STEPS,
  hasSeenReviewTour,
  markReviewTourSeen,
} from "@/core/guided-tour";
import { useAuth } from "@/context/AuthContext";
import { completarFirstTime, fetchFirstTime } from "@/services/users";

export interface ReviewTourProps {
  /** Incrementar para relanzar el tour (Command Palette → «Tutorial guiado»). */
  launchNonce?: number;
}

/**
 * Tour guiado de la pantalla de Revisión. La PRIMERA vez (según el backend
 * `first_time`, o localStorage si no hay sesión) se ofrece el recorrido; al
 * salir o terminarlo se llama a `PATCH /api/users/me/first-time` con
 * `first_time: false`. Después queda disponible desde el Command Palette.
 */
export default function ReviewTour({ launchNonce = 0 }: ReviewTourProps) {
  const { token } = useAuth();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  /** Evita invitar antes de saber si el backend ya marcó el onboarding. */
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function decideInvite() {
      if (token) {
        try {
          const { first_time } = await fetchFirstTime(token);
          if (!cancelled && first_time) setInviteOpen(true);
        } catch {
          // Fallback local si el endpoint falla (offline, 5xx, etc.).
          if (!cancelled && !hasSeenReviewTour()) setInviteOpen(true);
        }
      } else if (!hasSeenReviewTour()) {
        if (!cancelled) setInviteOpen(true);
      }
      if (!cancelled) setReady(true);
    }

    void decideInvite();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Relanzado explícito desde la palette: directo al tour, sin invitación.
  useEffect(() => {
    if (launchNonce > 0) {
      setInviteOpen(false);
      setTourOpen(true);
    }
  }, [launchNonce]);

  const persistCompleted = useCallback(async () => {
    markReviewTourSeen();
    if (!token) return;
    try {
      await completarFirstTime(token);
    } catch {
      /* El tour ya terminó en UI; el backend se reintentará en otra visita. */
    }
  }, [token]);

  const acceptInvite = () => {
    setInviteOpen(false);
    setTourOpen(true);
  };

  const declineInvite = () => {
    setInviteOpen(false);
    // Sin sesión no hay backend: no volver a molestar en este navegador.
    // Con sesión, `first_time` sigue true hasta que abra y cierre el tour.
    if (!token) markReviewTourSeen();
  };

  const handleTourClose = (_completed: boolean) => {
    setTourOpen(false);
    // Salir o terminar: ambos marcan first_time = false.
    void persistCompleted();
  };

  if (tourOpen) {
    return (
      <GuidedTour
        steps={REVIEW_TOUR_STEPS}
        onClose={handleTourClose}
      />
    );
  }

  if (!ready || !inviteOpen || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-x-0 bottom-20 z-[400] flex justify-center px-4 pointer-events-none">
      <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-primary/25 bg-base-100/95 px-4 py-3 shadow-2xl shadow-primary/10 backdrop-blur-md animate-[fadeIn_0.2s_ease]">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
          <Bot size={16} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-base-content leading-tight">
            ¿Primera vez en el visor?
          </p>
          <p className="text-xs text-base-content/55 mt-0.5">
            Te mostramos lo esencial de la barra y el visor, con clicks guiados.
          </p>
        </div>
        <div className="flex items-center gap-1.5 pl-1 shrink-0">
          <button
            type="button"
            onClick={declineInvite}
            className="btn btn-ghost btn-xs rounded-lg text-base-content/60"
          >
            Ahora no
          </button>
          <button
            type="button"
            onClick={acceptInvite}
            className="btn btn-primary btn-xs rounded-lg"
          >
            Ver el tour
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
