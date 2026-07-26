"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Sparkles } from "lucide-react";
import GuidedTour from "./GuidedTour";
import {
  REVIEW_TOUR_STEPS,
  hasSeenReviewTour,
  markReviewTourSeen,
} from "@/core/guided-tour";

export interface ReviewTourProps {
  /** Incrementar para relanzar el tour (Command Palette → «Tutorial guiado»). */
  launchNonce?: number;
}

/**
 * Tour guiado de la pantalla de Revisión. La PRIMERA vez que el usuario entra
 * al visor le ofrece el recorrido (invitación discreta); después queda
 * disponible desde el Command Palette. La preferencia persiste por navegador.
 */
export default function ReviewTour({ launchNonce = 0 }: ReviewTourProps) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);

  // Primera visita → invitar (tras montar, para que las anclas ya existan).
  useEffect(() => {
    if (!hasSeenReviewTour()) setInviteOpen(true);
  }, []);

  // Relanzado explícito desde la palette: directo al tour, sin invitación.
  useEffect(() => {
    if (launchNonce > 0) {
      setInviteOpen(false);
      setTourOpen(true);
    }
  }, [launchNonce]);

  const acceptInvite = () => {
    markReviewTourSeen();
    setInviteOpen(false);
    setTourOpen(true);
  };

  const declineInvite = () => {
    markReviewTourSeen();
    setInviteOpen(false);
  };

  if (tourOpen) {
    return (
      <GuidedTour
        steps={REVIEW_TOUR_STEPS}
        onClose={() => {
          markReviewTourSeen();
          setTourOpen(false);
        }}
      />
    );
  }

  if (!inviteOpen || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-x-0 bottom-20 z-[400] flex justify-center px-4 pointer-events-none">
      <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-primary/25 bg-base-100/95 px-4 py-3 shadow-2xl shadow-primary/10 backdrop-blur-md animate-[fadeIn_0.2s_ease]">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
          <Sparkles size={16} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-base-content leading-tight">
            ¿Primera vez en el visor?
          </p>
          <p className="text-xs text-base-content/55 mt-0.5">
            Te mostramos lo esencial en 30 segundos, con clicks guiados.
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
