"use client";

// Indicador de progreso del flujo (Revisión → Planchas → Pago).
// Da orientación al usuario sobre en qué paso está y cuántos faltan.
// Reusa el componente `steps` de DaisyUI.

export type FlowStep = "upload" | "review" | "nesting" | "payment";

const STEPS: { key: FlowStep; label: string }[] = [
  { key: "upload", label: "Subir" },
  { key: "review", label: "Revisión" },
  { key: "nesting", label: "Planchas" },
  { key: "payment", label: "Pago" },
];

export default function StepIndicator({ current }: { current: FlowStep }) {
  const currentIdx = STEPS.findIndex((s) => s.key === current);

  return (
    <ul className="steps steps-horizontal w-full text-[13px] font-medium">
      {STEPS.map((s, i) => (
        <li
          key={s.key}
          className={`step ${i <= currentIdx ? "step-primary" : ""}`}
          data-content={i < currentIdx ? "✓" : `${i + 1}`}
        >
          {s.label}
        </li>
      ))}
    </ul>
  );
}
