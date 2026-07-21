"use client";

import { TERMINOS_SECTIONS, TERMINOS_VERSION } from "@/content/terminos";

interface TermsModalProps {
  open: boolean;
  onClose: () => void;
}

/** Modal DaisyUI (`dialog.modal`) — mismo patrón que ReviewScreen. */
export default function TermsModal({ open, onClose }: TermsModalProps) {
  if (!open) return null;

  return (
    <dialog className="modal modal-open z-[300]" open aria-labelledby="terminos-modal-title">
      <div className="modal-box max-w-lg rounded-2xl max-h-[85vh] flex flex-col p-0 overflow-hidden">
        <div className="px-6 pt-6 pb-3 shrink-0">
          <h3 id="terminos-modal-title" className="font-semibold text-base">
            Términos y condiciones
          </h3>
          <p className="text-xs text-base-content/55 mt-1">Versión {TERMINOS_VERSION}</p>
        </div>

        <div className="px-6 pb-2 overflow-y-auto flex-1 min-h-0 space-y-4 text-sm text-base-content/75">
          {TERMINOS_SECTIONS.map((section) => (
            <section key={section.title} className="space-y-1">
              <h4 className="font-semibold text-base-content text-sm">{section.title}</h4>
              <p className="leading-relaxed text-xs sm:text-sm">{section.body}</p>
            </section>
          ))}
        </div>

        <div className="modal-action px-6 py-4 mt-0 border-t border-base-200 shrink-0">
          <button type="button" className="btn btn-primary rounded-xl" onClick={onClose}>
            Entendido
          </button>
        </div>
      </div>

      <form method="dialog" className="modal-backdrop">
        <button type="button" onClick={onClose}>
          cerrar
        </button>
      </form>
    </dialog>
  );
}
