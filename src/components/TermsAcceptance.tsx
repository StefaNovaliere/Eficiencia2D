"use client";

import { useState } from "react";
import TermsModal from "@/components/TermsModal";

interface TermsAcceptanceProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Texto corto junto al checkbox. */
  label?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Checkbox + link que abre el modal de términos.
 * El padre decide bloquear el submit / pago si `checked` es false.
 */
export default function TermsAcceptance({
  checked,
  onChange,
  label = "Acepto los",
  id = "acepto-terminos",
  disabled = false,
  className = "",
}: TermsAcceptanceProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <label
        htmlFor={id}
        className={`flex items-start gap-2.5 text-sm text-base-content/80 cursor-pointer select-none ${className}`}
      >
        <input
          id={id}
          type="checkbox"
          className="checkbox checkbox-primary checkbox-sm mt-0.5 shrink-0"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>
          {label}{" "}
          <button
            type="button"
            className="link link-primary font-medium"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpen(true);
            }}
          >
            términos y condiciones
          </button>
        </span>
      </label>

      <TermsModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
