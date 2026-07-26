"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Search } from "lucide-react";
import { useUIStore } from "@/stores/uiStore";
import { COMMANDS, rankCommands, isEnabled, type CommandContext, type FlowStep } from "@/core/commands";

function stepFromPath(pathname: string): FlowStep {
  if (pathname.startsWith("/review")) return "review";
  if (pathname.startsWith("/nesting")) return "nesting";
  if (pathname.startsWith("/payment")) return "payment";
  return "other";
}

/**
 * Command Palette (⌘K). Montado una sola vez a nivel app. Lee `paletteOpen` del
 * store; sólo re-renderiza este componente (no el `<Canvas>` 3D). Al ejecutar un
 * comando llama a las acciones del store (setActiveTool / emitIntent / flow…),
 * que la pantalla activa interpreta.
 */
export default function CommandPalette() {
  const paletteOpen = useUIStore((s) => s.paletteOpen);
  const selectionCount = useUIStore((s) => s.selectionCount);
  const closePalette = useUIStore((s) => s.closePalette);
  const pathname = usePathname();

  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const ctx: CommandContext = useMemo(
    () => ({ step: stepFromPath(pathname), selectionCount }),
    [pathname, selectionCount],
  );

  const results = useMemo(() => rankCommands(COMMANDS, query, ctx), [query, ctx]);

  // Reset al abrir; foco al input.
  useEffect(() => {
    if (paletteOpen) {
      setQuery("");
      setActive(0);
      // foco en el próximo tick (tras montar).
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [paletteOpen]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  if (!paletteOpen) return null;

  const runCommand = (index: number) => {
    const cmd = results[index];
    if (!cmd || !isEnabled(cmd, ctx)) return; // no ejecutar los que no cumplen el requisito
    const s = useUIStore.getState();
    cmd.perform({
      setActiveTool: s.setActiveTool,
      emitIntent: s.emitIntent,
      flowNext: s.flowNext,
      flowBack: s.flowBack,
    });
    // perform() ya cierra la palette (setActiveTool/emitIntent) o navega.
    s.closePalette();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      runCommand(active);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] bg-neutral/70 backdrop-blur-sm"
      onMouseDown={closePalette}
      role="dialog"
      aria-modal="true"
      aria-label="Buscador de acciones"
    >
      <div
        className="w-full max-w-lg mx-4 rounded-2xl bg-base-100 border border-base-300/60 shadow-2xl overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-base-300/40">
          <Search size={18} className="text-base-content/40 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Buscar acción…  (p.ej. 'curvar madera', 'reforzar')"
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-base-content/40"
          />
          <kbd className="kbd kbd-sm hidden sm:inline-flex">esc</kbd>
        </div>

        <ul className="max-h-[50vh] overflow-y-auto py-1.5">
          {results.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-base-content/40">
              Sin resultados para “{query}”.
            </li>
          )}
          {results.map((cmd, i) => {
            const enabled = isEnabled(cmd, ctx);
            return (
              <li key={cmd.id}>
                <button
                  type="button"
                  disabled={!enabled}
                  className={`w-full flex items-center justify-between gap-3 px-4 py-2 text-left text-sm ${
                    !enabled
                      ? "opacity-45 cursor-not-allowed"
                      : i === active
                        ? "bg-primary/10 text-primary"
                        : "hover:bg-base-200/60"
                  }`}
                  onMouseEnter={() => enabled && setActive(i)}
                  onClick={() => runCommand(i)}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] uppercase tracking-wider text-base-content/35 w-16 shrink-0">
                      {cmd.group}
                    </span>
                    <span className="truncate">{cmd.title}</span>
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    {!enabled && cmd.requirement && (
                      <span className="text-[10px] text-warning/80 hidden sm:inline whitespace-nowrap">
                        {cmd.requirement}
                      </span>
                    )}
                    {cmd.hotkey && enabled && <kbd className="kbd kbd-xs">{cmd.hotkey}</kbd>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
