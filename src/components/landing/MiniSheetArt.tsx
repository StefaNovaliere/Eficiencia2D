/** Plancha miniatura decorativa — simplificada, colores del tema. */
export default function MiniSheetArt({
  variant,
  className = "",
}: {
  variant: "upload" | "review" | "nest" | "build";
  className?: string;
}) {
  const layouts: Record<typeof variant, { x: number; y: number; w: number; h: number; tone: string }[]> = {
    upload: [
      { x: 8, y: 10, w: 38, h: 28, tone: "wall" },
      { x: 52, y: 10, w: 22, h: 18, tone: "wall" },
      { x: 8, y: 44, w: 66, h: 14, tone: "floor" },
    ],
    review: [
      { x: 6, y: 8, w: 28, h: 50, tone: "wall" },
      { x: 38, y: 8, w: 36, h: 22, tone: "floor" },
      { x: 38, y: 34, w: 18, h: 24, tone: "accent" },
      { x: 58, y: 34, w: 16, h: 24, tone: "wall" },
    ],
    nest: [
      { x: 5, y: 6, w: 30, h: 20, tone: "wall" },
      { x: 38, y: 6, w: 34, h: 20, tone: "wall" },
      { x: 5, y: 30, w: 22, h: 28, tone: "floor" },
      { x: 30, y: 30, w: 20, h: 28, tone: "floor" },
      { x: 53, y: 30, w: 20, h: 28, tone: "wall" },
    ],
    build: [
      { x: 10, y: 12, w: 24, h: 40, tone: "wall" },
      { x: 38, y: 12, w: 32, h: 18, tone: "floor" },
      { x: 38, y: 34, w: 32, h: 18, tone: "floor" },
    ],
  };

  const panels = layouts[variant];

  return (
    <svg
      viewBox="0 0 80 58"
      className={`w-full max-w-[11rem] h-auto ${className}`}
      aria-hidden
    >
      <rect
        x="1"
        y="1"
        width="78"
        height="56"
        rx="1"
        fill="color-mix(in oklch, var(--color-primary) 6%, transparent)"
        stroke="var(--color-primary)"
        strokeWidth="1.2"
        strokeDasharray="4 3"
        opacity="0.85"
      />
      {panels.map((p, i) => (
        <g key={i}>
          <rect
            x={p.x}
            y={p.y}
            width={p.w}
            height={p.h}
            fill={
              p.tone === "floor"
                ? "color-mix(in oklch, var(--viewer-floor, #cf9567) 35%, transparent)"
                : p.tone === "accent"
                  ? "color-mix(in oklch, var(--color-secondary) 25%, transparent)"
                  : "color-mix(in oklch, var(--viewer-wall, #9c9c9c) 30%, transparent)"
            }
            stroke={
              p.tone === "floor"
                ? "var(--viewer-floor, #cf9567)"
                : p.tone === "accent"
                  ? "var(--color-secondary)"
                  : "var(--color-primary)"
            }
            strokeWidth="0.9"
            opacity="0.9"
          />
        </g>
      ))}
    </svg>
  );
}
