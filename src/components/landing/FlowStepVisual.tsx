/** Visual distinto por etapa — no planchas en todos lados. */
export default function FlowStepVisual({ kind }: { kind: "upload" | "review" | "nest" | "assembly" }) {
  if (kind === "upload") {
    return (
      <div className="flow-visual flow-visual-upload" aria-hidden>
        <div className="flow-visual-glow flow-visual-glow-cyan" />
        <div className="flow-upload-orbit" />
        <div className="flow-upload-file">
          <span className="flow-upload-ext">.obj</span>
        </div>
        <div className="flow-upload-cloud">
          <svg viewBox="0 0 64 40" className="w-16 h-10 text-primary opacity-90">
            <path
              fill="currentColor"
              d="M18 32a10 10 0 01-.2-20 14 14 0 0126.4-4.2A9 9 0 0148 32H18z"
              opacity="0.35"
            />
            <path
              fill="currentColor"
              d="M20 30a8 8 0 01-.1-16 11 11 0 0120.8-3.3A7 7 0 0144 30H20z"
            />
          </svg>
        </div>
        <div className="flow-upload-devices">
          <span /><span /><span />
        </div>
      </div>
    );
  }

  if (kind === "review") {
    return (
      <div className="flow-visual flow-visual-review" aria-hidden>
        <div className="flow-visual-glow flow-visual-glow-magenta" />
        <div className="flow-model-scene">
          <div className="flow-model-cube">
            <div className="flow-model-face flow-model-face-front" />
            <div className="flow-model-face flow-model-face-back" />
            <div className="flow-model-face flow-model-face-right" />
            <div className="flow-model-face flow-model-face-left" />
            <div className="flow-model-face flow-model-face-top" />
            <div className="flow-model-face flow-model-face-bottom" />
          </div>
          <div className="flow-cut-line flow-cut-line-a" />
          <div className="flow-cut-line flow-cut-line-b" />
          <div className="flow-measure flow-measure-a" />
          <div className="flow-measure flow-measure-b" />
        </div>
        <p className="flow-visual-caption">visor 3D</p>
      </div>
    );
  }

  if (kind === "nest") {
    return (
      <div className="flow-visual flow-visual-nest" aria-hidden>
        <div className="flow-visual-glow flow-visual-glow-cyan" />
        <svg viewBox="0 0 120 72" className="flow-nest-sheet w-full max-w-[220px]">
          <rect
            x="2"
            y="2"
            width="116"
            height="68"
            rx="2"
            fill="color-mix(in oklch, var(--color-primary) 8%, transparent)"
            stroke="var(--color-primary)"
            strokeWidth="1.5"
            strokeDasharray="5 4"
          />
          <rect x="8" y="8" width="42" height="28" className="flow-nest-panel flow-nest-wall" rx="1" />
          <rect x="54" y="8" width="28" height="20" className="flow-nest-panel flow-nest-wall" rx="1" />
          <rect x="86" y="8" width="24" height="32" className="flow-nest-panel flow-nest-wall" rx="1" />
          <rect x="8" y="40" width="58" height="24" className="flow-nest-panel flow-nest-floor" rx="1" />
          <rect x="70" y="44" width="40" height="20" className="flow-nest-panel flow-nest-floor" rx="1" />
          <text x="29" y="24" className="flow-nest-label">P1</text>
          <text x="68" y="20" className="flow-nest-label">P2</text>
        </svg>
        <p className="flow-visual-caption">anidado</p>
      </div>
    );
  }

  return (
    <div className="flow-visual flow-visual-assembly" aria-hidden>
      <div className="flow-visual-glow flow-visual-glow-magenta" />
      <div className="flow-stack">
        <div className="flow-stack-piece flow-stack-3" />
        <div className="flow-stack-piece flow-stack-2" />
        <div className="flow-stack-piece flow-stack-1" />
      </div>
      <div className="flow-stack-arrow">↑</div>
      <p className="flow-visual-caption">armado guiado</p>
    </div>
  );
}
