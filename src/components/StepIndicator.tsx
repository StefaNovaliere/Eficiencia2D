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

export default function StepIndicator({
  current,
  variant = "full",
}: {
  current: FlowStep;
  variant?: "full" | "compact";
}) {
  const currentIdx = STEPS.findIndex((s) => s.key === current);

  // Compacto: sólo el paso actual (Revisión/Planchas/Pago). La barra completa
  // queda únicamente en la pantalla de inicio.
  if (variant === "compact") {
    const step = STEPS[currentIdx];
    return (
      <div className="flex items-center gap-2 text-[13px] font-medium">
        <span className="badge badge-primary badge-sm font-mono">{currentIdx + 1}</span>
        <span>{step?.label}</span>
        <span className="text-base-content/40 text-xs">
          Paso {currentIdx + 1} de {STEPS.length}
        </span>
      </div>
    );
  }

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
