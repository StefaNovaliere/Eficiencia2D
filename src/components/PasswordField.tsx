"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

interface PasswordFieldProps {
  id?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  disabled?: boolean;
}

export default function PasswordField({
  id,
  label,
  value,
  onChange,
  placeholder,
  autoComplete = "new-password",
  required = true,
  minLength,
  maxLength,
  disabled = false,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);

  return (
    <label className="form-control w-full">
      <span className="label-text font-medium mb-1">{label}</span>
      <div className="relative">
        <input
          id={id}
          type={visible ? "text" : "password"}
          className="input input-bordered w-full bg-base-100 pr-11"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          minLength={minLength}
          maxLength={maxLength}
          autoComplete={autoComplete}
          disabled={disabled}
        />
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-circle absolute right-1 top-1/2 -translate-y-1/2"
          onClick={() => setVisible((v) => !v)}
          disabled={disabled}
          aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
    </label>
  );
}
