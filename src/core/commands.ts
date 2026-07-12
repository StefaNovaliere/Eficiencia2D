/**
 * Diccionario de INTENCIONES para el Command Palette (⌘K). Cada comando tiene
 * jerga/alias en español para que el usuario lo encuentre por lo que quiere hacer
 * ("curvar madera" → Kerf), no por el nombre técnico. `rankCommands` es puro y
 * testeable (sin React).
 */

import type { ToolId } from "@/stores/uiStore";

export type FlowStep = "review" | "nesting" | "payment" | "other";

export interface CommandContext {
  step: FlowStep;
  hasSelection: boolean;
  selectionCount: number;
}

/** Acciones que un comando puede disparar (las provee el Palette desde el store). */
export interface CommandActions {
  setActiveTool: (tool: ToolId, mode?: string) => void;
  emitIntent: (id: string) => void;
  flowNext: () => void;
  flowBack: () => void;
}

export interface Command {
  id: string;
  title: string;
  group: "Herramientas" | "Refuerzos" | "Navegación" | "Vista";
  /** Palabras clave y jerga por las que se busca (además del título). */
  keywords: string[];
  /** Atajo mostrado (informativo). */
  hotkey?: string;
  /** Disponibilidad según contexto (paso/selección). */
  when?: (ctx: CommandContext) => boolean;
  perform: (a: CommandActions) => void;
}

const inReview = (c: CommandContext) => c.step === "review";

export const COMMANDS: Command[] = [
  // — Herramientas de dibujo (mapean a tool-modes reales) —
  {
    id: "tool.cursor",
    title: "Cursor / seleccionar",
    group: "Herramientas",
    keywords: ["cursor", "seleccionar", "flecha", "mover"],
    hotkey: "V",
    when: inReview,
    perform: (a) => a.setActiveTool("cursor"),
  },
  {
    id: "tool.cut",
    title: "Cortar (recortes manuales)",
    group: "Herramientas",
    keywords: ["cortar", "corte", "recorte", "tijera", "dividir", "hueco"],
    hotkey: "C",
    when: inReview,
    perform: (a) => a.setActiveTool("cut"),
  },
  {
    id: "tool.measure",
    title: "Medir distancias y áreas",
    group: "Herramientas",
    keywords: ["medir", "medida", "regla", "distancia", "área", "cotas"],
    hotkey: "M",
    when: inReview,
    perform: (a) => a.setActiveTool("measure"),
  },
  {
    id: "tool.markLine",
    title: "Marcar con líneas rojas (grabar)",
    group: "Herramientas",
    keywords: ["marcar", "línea roja", "grabar", "rojo", "anotar", "dibujar linea"],
    hotkey: "R",
    when: inReview,
    perform: (a) => a.setActiveTool("markLine"),
  },
  {
    id: "tool.box",
    title: "Selección por área",
    group: "Herramientas",
    keywords: ["seleccionar area", "lazo", "caja", "rectángulo de selección", "varias"],
    hotkey: "S",
    when: inReview,
    perform: (a) => a.setActiveTool("box"),
  },
  {
    id: "tool.walk",
    title: "Caminar / volar (primera persona)",
    group: "Vista",
    keywords: ["caminar", "volar", "primera persona", "recorrer", "fps"],
    when: inReview,
    perform: (a) => a.emitIntent("walk"),
  },
  // — Curvado / flexión — (jerga estrella: "curvar madera") —
  {
    id: "intent.kerf",
    title: "Curvar madera (Kerf Bending)",
    group: "Herramientas",
    keywords: ["curvar", "curvatura", "doblar", "flexionar", "flex", "kerf", "auxético", "madera", "curva"],
    when: (c) => inReview(c) && c.hasSelection,
    perform: (a) => a.emitIntent("kerf"),
  },
  // — Refuerzos —
  {
    id: "intent.rib",
    title: "Agregar nervio (cartela de refuerzo)",
    group: "Refuerzos",
    keywords: ["nervio", "cartela", "refuerzo", "rigidez", "soporte", "escuadra", "reforzar esquina"],
    when: (c) => inReview(c) && c.selectionCount === 2,
    perform: (a) => a.emitIntent("rib"),
  },
  {
    id: "intent.column",
    title: "Agregar columna estructural",
    group: "Refuerzos",
    keywords: ["columna", "pilar", "poste", "soporte vertical", "refuerzo"],
    when: (c) => inReview(c) && c.hasSelection,
    perform: (a) => a.emitIntent("column"),
  },
  // — Instructivo / navegación —
  {
    id: "intent.assembly",
    title: "Abrir instructivo de armado",
    group: "Vista",
    keywords: ["instructivo", "armado", "ensamble", "guía", "pasos", "maqueta", "3d"],
    when: inReview,
    perform: (a) => a.emitIntent("assembly"),
  },
  {
    id: "nav.continue",
    title: "Continuar al siguiente paso",
    group: "Navegación",
    keywords: ["continuar", "siguiente", "avanzar", "next"],
    perform: (a) => a.flowNext(),
  },
  {
    id: "nav.back",
    title: "Volver al paso anterior",
    group: "Navegación",
    keywords: ["volver", "atrás", "anterior", "back"],
    perform: (a) => a.flowBack(),
  },
];

/** Normaliza para búsqueda: minúsculas y sin acentos. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** Puntúa un comando contra la query (0 = no matchea). */
function scoreCommand(cmd: Command, q: string): number {
  const title = norm(cmd.title);
  const hay = [title, ...cmd.keywords.map(norm)];
  let best = 0;
  for (const term of hay) {
    if (term === q) best = Math.max(best, 100);
    else if (term.startsWith(q)) best = Math.max(best, 70);
    else if (term.includes(q)) best = Math.max(best, 40);
  }
  // Bonus por matchear varias palabras de la query en el título.
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length > 1 && words.every((w) => hay.some((h) => h.includes(w)))) {
    best = Math.max(best, 55);
  }
  return best;
}

/**
 * Filtra por disponibilidad (`when`) y ordena por relevancia. Con query vacía
 * devuelve todos los disponibles agrupados por orden de definición.
 */
export function rankCommands(
  commands: Command[],
  query: string,
  ctx: CommandContext,
): Command[] {
  const available = commands.filter((c) => !c.when || c.when(ctx));
  const q = norm(query.trim());
  if (!q) return available;
  return available
    .map((c) => ({ c, score: scoreCommand(c, q) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.c);
}
