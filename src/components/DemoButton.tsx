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
    <div className="fixed top-4 right-4 md:top-6 md:right-6 z-50 flex items-center gap-3">
      <div className="hidden sm:flex items-center gap-1.5 text-primary animate-[pulse_2.4s_ease-in-out_infinite]">
        <span className="text-sm font-medium italic whitespace-nowrap">¿Querés ver cómo funciona?</span>
        <svg
          className="flex-shrink-0"
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
      <button className="btn btn-primary rounded-full shadow-lg shadow-primary/20 transition-transform hover:-translate-y-0.5" onClick={onClick} type="button">
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
