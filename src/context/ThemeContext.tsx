"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Check, Palette } from "lucide-react";

export type ThemeId =
  | "light"
  | "dark"
  | "aqua"
  | "valentine"
  | "sunset"
  | "halloween";

export const THEMES: { id: ThemeId; label: string; swatch: string }[] = [
  { id: "light", label: "Claro", swatch: "#ffffff" },
  { id: "dark", label: "Oscuro", swatch: "#1f2937" },
  { id: "aqua", label: "Aqua", swatch: "#09ecf3" },
  { id: "valentine", label: "Valentine", swatch: "#e96d7b" },
  { id: "sunset", label: "Sunset", swatch: "#ff865b" },
  { id: "halloween", label: "Halloween", swatch: "#f28c18" },
];

const VALID_THEMES = new Set<string>(THEMES.map((t) => t.id));
const DARK_THEMES = new Set<ThemeId>(["dark", "halloween"]);

interface ThemeContextValue {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function resolveInitialTheme(): ThemeId {
  if (typeof window === "undefined") return "light";
  try {
    const saved = localStorage.getItem("theme");
    if (saved && VALID_THEMES.has(saved)) return saved as ThemeId;
  } catch {
    /* ignore */
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: ThemeId) {
  document.documentElement.setAttribute("data-theme", theme);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>("light");

  useEffect(() => {
    const initial = resolveInitialTheme();
    setThemeState(initial);
    applyTheme(initial);
  }, []);

  const setTheme = useCallback((next: ThemeId) => {
    setThemeState(next);
    applyTheme(next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function ThemePicker() {
  const ctx = useContext(ThemeContext);
  if (!ctx) return null;

  const { theme, setTheme } = ctx;
  const current = THEMES.find((t) => t.id === theme);

  return (
    <div className="dropdown dropdown-right dropdown-bottom fixed top-4 left-4 md:top-6 md:left-6 z-[110]">
      <button
        type="button"
        tabIndex={0}
        className="btn btn-ghost btn-circle shadow-md bg-base-100/90 backdrop-blur border border-base-300"
        title="Elegir tema"
        aria-label="Elegir tema"
      >
        <Palette className="h-5 w-5" />
      </button>
      <ul
        tabIndex={0}
        className="dropdown-content menu bg-base-100 rounded-box z-[111] w-52 p-2 shadow-lg border border-base-300 mt-2 right-0"
      >
        <li className="menu-title px-3 py-1 text-xs">Tema</li>
        {THEMES.map((item) => {
          const active = item.id === theme;
          return (
            <li key={item.id}>
              <button
                type="button"
                className={`flex items-center gap-3 rounded-lg ${active ? "active font-semibold" : ""}`}
                onClick={() => setTheme(item.id)}
              >
                <span
                  className="w-4 h-4 rounded-full border border-base-content/20 shrink-0"
                  style={{ backgroundColor: item.swatch }}
                />
                <span className="flex-1 text-left">{item.label}</span>
                {active && <Check className="h-4 w-4 text-primary shrink-0" />}
              </button>
            </li>
          );
        })}
        {current && (
          <li className="pointer-events-none mt-1 border-t border-base-300 pt-2">
            <span className="px-3 text-[10px] uppercase tracking-wider text-base-content/50">
              Activo: {current.label}
            </span>
          </li>
        )}
      </ul>
    </div>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return ctx;
}

function isDarkTheme(theme: ThemeId): boolean {
  return DARK_THEMES.has(theme);
}

export function getViewerBackground(theme: ThemeId): string {
  if (isDarkTheme(theme)) return "#1c1917";
  if (theme === "aqua") return "#ecfeff";
  if (theme === "valentine") return "#fff1f2";
  if (theme === "sunset") return "#fff7ed";
  return "#f5f5f7";
}

export function getNestingCanvasColors(theme: ThemeId) {
  if (isDarkTheme(theme)) {
    return {
      wall: "#60a5fa",
      floor: "#4ade80",
      sheetBg: "rgba(41, 37, 36, 0.95)",
      sheetStroke: "#57534e",
      labelText: "#a8a29e",
    };
  }
  if (theme === "aqua") {
    return {
      wall: "#0891b2",
      floor: "#14b8a6",
      sheetBg: "rgba(236, 254, 255, 0.95)",
      sheetStroke: "#a5f3fc",
      labelText: "#155e75",
    };
  }
  if (theme === "valentine") {
    return {
      wall: "#e11d48",
      floor: "#fb7185",
      sheetBg: "rgba(255, 241, 245, 0.95)",
      sheetStroke: "#fecdd3",
      labelText: "#9f1239",
    };
  }
  if (theme === "sunset") {
    return {
      wall: "#ea580c",
      floor: "#f59e0b",
      sheetBg: "rgba(255, 247, 237, 0.95)",
      sheetStroke: "#fed7aa",
      labelText: "#9a3412",
    };
  }
  return {
    wall: "#3b82f6",
    floor: "#22c55e",
    sheetBg: "rgba(255, 255, 255, 0.9)",
    sheetStroke: "#d4d4d8",
    labelText: "#52525b",
  };
}
