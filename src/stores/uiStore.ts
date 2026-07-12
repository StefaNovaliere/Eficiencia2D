/**
 * Store de UI EFÍMERA (Zustand) — estado volátil que no pertenece al dominio del
 * proyecto: herramienta activa, Command Palette abierto/cerrado, y la navegación
 * de flujo que registra la página actual.
 *
 * Por qué Zustand y no Context: da suscripción granular por selector (sólo el
 * chip/overlay que lee ese slice re-renderiza, NO el `<Canvas>` 3D), sin agregar
 * providers. El estado de dominio (proyecto, geometría) sigue en `ProjectContext`.
 */

import { create } from "zustand";

export type ToolId =
  | "cursor"
  | "cut"
  | "measure"
  | "markLine"
  | "box"
  | "walk"
  | null;

/** Navegación de flujo que la página activa "registra" para el shell/palette. */
export interface FlowNav {
  backLabel?: string;
  onBack?: () => void;
  nextLabel?: string;
  onNext?: () => void;
  canNext?: boolean;
}

const EMPTY_NAV: FlowNav = {};

export interface UIState {
  // Command Palette
  paletteOpen: boolean;
  openPalette: () => void;
  closePalette: () => void;
  togglePalette: () => void;

  /** Nº de componentes seleccionados (lo publica la pantalla) — para gatear comandos. */
  selectionCount: number;
  setSelectionCount: (n: number) => void;

  // Herramienta activa (fuente de verdad de la intención; la pantalla la aplica)
  activeTool: ToolId;
  toolMode?: string;
  /** Se incrementa en cada `setActiveTool` para que el adaptador re-dispare aun
   *  si se vuelve a pedir la misma herramienta. */
  toolNonce: number;
  setActiveTool: (tool: ToolId, mode?: string) => void;

  /** Canal de intenciones genéricas (comandos que no son herramientas: abrir
   *  instructivo, enfocar un panel, etc.). La pantalla activa las interpreta. */
  intent: { id: string; nonce: number } | null;
  emitIntent: (id: string) => void;

  // Navegación de flujo (la registra la página; la consume el shell y la palette)
  flowNav: FlowNav;
  registerFlowNav: (nav: FlowNav) => void;
  clearFlowNav: () => void;
  flowNext: () => void;
  flowBack: () => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  paletteOpen: false,
  openPalette: () => set({ paletteOpen: true }),
  closePalette: () => set({ paletteOpen: false }),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),

  selectionCount: 0,
  setSelectionCount: (n) => set({ selectionCount: n }),

  activeTool: "cursor",
  toolMode: undefined,
  toolNonce: 0,
  setActiveTool: (tool, mode) =>
    set((s) => ({ activeTool: tool, toolMode: mode, toolNonce: s.toolNonce + 1, paletteOpen: false })),

  intent: null,
  emitIntent: (id) =>
    set((s) => ({ intent: { id, nonce: (s.intent?.nonce ?? 0) + 1 }, paletteOpen: false })),

  flowNav: EMPTY_NAV,
  registerFlowNav: (nav) => set({ flowNav: nav }),
  clearFlowNav: () => set({ flowNav: EMPTY_NAV }),
  flowNext: () => get().flowNav.onNext?.(),
  flowBack: () => get().flowNav.onBack?.(),
}));
