"use client";

export interface DemoButtonProps {
  onClick: () => void;
}

/**
 * Floating "Ver demo" call-to-action shown in the top-right corner of the
 * home page. Includes an arrow + hint text pointing at the button so new
 * users can discover the demo flow without uploading their own file.
 */
export default function DemoButton({ onClick }: DemoButtonProps) {
  return (
    <div className="demo-cta">
      <div className="demo-cta-hint">
        <span className="demo-cta-text">¿Querés ver cómo funciona?</span>
        <svg
          className="demo-cta-arrow"
          width="44"
          height="32"
          viewBox="0 0 44 32"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2 22 C 14 22, 24 16, 36 6" />
          <polyline points="30 4 36 6 36 12" />
        </svg>
      </div>
      <button className="demo-cta-btn" onClick={onClick} type="button">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <polygon points="6 4 20 12 6 20" />
        </svg>
        Ver demo
      </button>
    </div>
  );
}
