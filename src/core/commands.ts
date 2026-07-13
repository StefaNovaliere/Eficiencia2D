/**
 * Catálogo COMPLETO de acciones sobre el visor/modelo para el Command Palette.
 * Es la fuente única de "todo lo que se puede hacer" — aunque también esté en la
 * barra o el sidebar. Jerga/alias en español para encontrar por intención
 * ("curvar madera" → Kerf). `rankCommands` es puro y testeable.
 *
 * - `when(ctx)`  → disponibilidad por PASO (si no, ni se muestra).
 * - `enabled(ctx)` → si es accionable AHORA; si no, se muestra ATENUADO con el
 *   texto `requirement` (p.ej. "Requiere 2 paredes ⊥") y no ejecuta.
 */

import type { ToolId } from "@/stores/uiStore";

export type FlowStep = "review" | "nesting" | "payment" | "other";

export interface CommandContext {
  step: FlowStep;
  selectionCount: number;
}

export interface CommandActions {
  setActiveTool: (tool: ToolId, mode?: string) => void;
  emitIntent: (id: string) => void;
  flowNext: () => void;
  flowBack: () => void;
}

export type CommandGroup =
  | "Herramientas"
  | "Vista"
  | "Selección"
  | "Refuerzos"
  | "Navegación";

export interface Command {
  id: string;
  title: string;
  group: CommandGroup;
  keywords: string[];
  hotkey?: string;
  /** Disponibilidad por paso. */
  when?: (ctx: CommandContext) => boolean;
  /** Accionable ahora. Si devuelve false, se muestra atenuado con `requirement`. */
  enabled?: (ctx: CommandContext) => boolean;
  /** Texto de requisito mostrado cuando `enabled` es false. */
  requirement?: string;
  perform: (a: CommandActions) => void;
}

const inReview = (c: CommandContext) => c.step === "review";
const hasSel = (c: CommandContext) => c.selectionCount >= 1;
const has2 = (c: CommandContext) => c.selectionCount === 2;
const REQ_1 = "Requiere seleccionar 1 componente";
const REQ_2 = "Requiere seleccionar 2 paredes perpendiculares";
const REQ_MERGE = "Requiere seleccionar 2 o más paredes";

export const COMMANDS: Command[] = [
  // ─────────── Herramientas de dibujo (tool-modes) ───────────
  { id: "tool.cursor", title: "Cursor / seleccionar", group: "Herramientas", hotkey: "V",
    keywords: ["cursor", "seleccionar", "flecha", "mover", "elegir"], when: inReview,
    perform: (a) => a.setActiveTool("cursor") },
  { id: "tool.box", title: "Selección por área", group: "Herramientas", hotkey: "S",
    keywords: ["seleccionar area", "lazo", "caja", "rectangulo de seleccion", "varias", "multiple"],
    when: inReview, perform: (a) => a.setActiveTool("box") },
  { id: "tool.cut", title: "Cortar (recortes manuales)", group: "Herramientas", hotkey: "C",
    keywords: ["cortar", "corte", "recorte", "tijera", "hueco", "abrir", "dividir cara"], when: inReview,
    perform: (a) => a.setActiveTool("cut") },
  { id: "tool.measure", title: "Medir distancias y áreas", group: "Herramientas", hotkey: "M",
    keywords: ["medir", "medida", "regla", "distancia", "area", "areas", "cotas", "largo"], when: inReview,
    perform: (a) => a.setActiveTool("measure") },
  { id: "tool.markLine", title: "Marcar con líneas rojas (grabar)", group: "Herramientas", hotkey: "R",
    keywords: ["marcar", "linea roja", "grabar", "rojo", "anotar", "dibujar linea", "trazo"], when: inReview,
    perform: (a) => a.setActiveTool("markLine") },

  // ─────────── Vista / cámara / edición ───────────
  { id: "view.frame", title: "Encuadrar (selección o todo)", group: "Vista", hotkey: "Z",
    keywords: ["encuadrar", "centrar", "enfocar", "zoom", "ajustar vista", "frame"], when: inReview,
    perform: (a) => a.emitIntent("frame") },
  { id: "view.reset", title: "Vista general (reset de cámara)", group: "Vista",
    keywords: ["vista general", "reset", "reiniciar camara", "inicio", "alejar"], when: inReview,
    perform: (a) => a.emitIntent("reset") },
  { id: "view.xray", title: "Rayos X (ver interior)", group: "Vista",
    keywords: ["rayos x", "xray", "transparente", "ver adentro", "interior", "ver dentro"], when: inReview,
    perform: (a) => a.emitIntent("xray") },
  { id: "view.section", title: "Plano de corte (ver interior)", group: "Vista",
    keywords: ["plano de corte", "seccion", "cortar vista", "clipping", "interior"], when: inReview,
    perform: (a) => a.emitIntent("section") },
  { id: "view.walk", title: "Caminar / volar (primera persona)", group: "Vista",
    keywords: ["caminar", "volar", "primera persona", "recorrer", "fps", "wasd"], when: inReview,
    perform: (a) => a.emitIntent("walk") },
  { id: "view.showHidden", title: "Mostrar componentes ocultos", group: "Vista",
    keywords: ["mostrar ocultos", "ver ocultos", "revelar", "unhide", "todos visibles"], when: inReview,
    perform: (a) => a.emitIntent("showHidden") },
  { id: "view.assembly", title: "Abrir instructivo de armado", group: "Vista",
    keywords: ["instructivo", "armado", "ensamble", "guia", "pasos", "maqueta", "3d", "armar"], when: inReview,
    perform: (a) => a.emitIntent("assembly") },
  { id: "edit.undo", title: "Deshacer", group: "Vista", hotkey: "Ctrl+Z",
    keywords: ["deshacer", "undo", "atras cambio", "revertir"], when: inReview,
    perform: (a) => a.emitIntent("undo") },
  { id: "edit.redo", title: "Rehacer", group: "Vista", hotkey: "Ctrl+Y",
    keywords: ["rehacer", "redo", "adelante cambio"], when: inReview,
    perform: (a) => a.emitIntent("redo") },

  // ─────────── Selección / clasificación (requieren selección) ───────────
  { id: "sel.floor", title: "Clasificar como Piso", group: "Selección",
    keywords: ["piso", "suelo", "horizontal", "clasificar", "categoria"], when: inReview,
    enabled: hasSel, requirement: REQ_1, perform: (a) => a.emitIntent("cat.floor") },
  { id: "sel.wall", title: "Clasificar como Pared", group: "Selección",
    keywords: ["pared", "muro", "vertical", "clasificar", "categoria"], when: inReview,
    enabled: hasSel, requirement: REQ_1, perform: (a) => a.emitIntent("cat.wall") },
  { id: "sel.discard", title: "Descartar componente", group: "Selección",
    keywords: ["descartar", "ignorar", "borrar", "quitar", "no cortar", "excluir"], when: inReview,
    enabled: hasSel, requirement: REQ_1, perform: (a) => a.emitIntent("cat.discard") },
  { id: "sel.merge", title: "Fusionar paredes", group: "Selección",
    keywords: ["fusionar", "unir", "juntar", "combinar", "merge"], when: inReview,
    enabled: (c) => c.selectionCount >= 2, requirement: REQ_MERGE, perform: (a) => a.emitIntent("merge") },
  { id: "sel.split", title: "Dividir componente", group: "Selección",
    keywords: ["dividir", "separar", "split", "desfusionar", "partir"], when: inReview,
    enabled: hasSel, requirement: REQ_1, perform: (a) => a.emitIntent("split") },
  { id: "sel.mark", title: "Marcar aberturas para grabar (rojo)", group: "Selección",
    keywords: ["marcar aberturas", "grabar ventana", "grabar puerta", "rojo", "marca", "no cortar abertura"],
    when: inReview, enabled: hasSel, requirement: REQ_1, perform: (a) => a.emitIntent("markOpenings") },
  { id: "sel.kerf", title: "Curvar madera (Kerf Bending)", group: "Selección",
    keywords: ["curvar", "curvatura", "doblar", "flexionar", "flex", "kerf", "auxetico", "madera", "curva"],
    when: inReview, enabled: hasSel, requirement: REQ_1, perform: (a) => a.emitIntent("kerf") },

  // ─────────── Refuerzos ───────────
  { id: "reinf.ribSnap", title: "Colocar nervio con imán (junta pared-piso)", group: "Refuerzos",
    keywords: ["nervio", "iman", "magnetico", "snap", "colocar", "cartela", "esquina", "soporte"],
    when: inReview, perform: (a) => a.emitIntent("ribSnap") },
  { id: "reinf.rib", title: "Agregar nervio (cartela de refuerzo)", group: "Refuerzos",
    keywords: ["nervio", "cartela", "refuerzo", "rigidez", "soporte", "escuadra", "reforzar esquina"],
    when: inReview, enabled: has2, requirement: REQ_2, perform: (a) => a.emitIntent("rib") },
  { id: "reinf.column", title: "Agregar columna estructural", group: "Refuerzos",
    keywords: ["columna", "pilar", "poste", "soporte vertical", "refuerzo"], when: inReview,
    enabled: hasSel, requirement: REQ_1, perform: (a) => a.emitIntent("column") },

  // ─────────── Navegación de flujo ───────────
  { id: "nav.continue", title: "Continuar al siguiente paso", group: "Navegación",
    keywords: ["continuar", "siguiente", "avanzar", "next", "seguir"], perform: (a) => a.flowNext() },
  { id: "nav.back", title: "Volver al paso anterior", group: "Navegación",
    keywords: ["volver", "atras", "anterior", "back", "regresar"], perform: (a) => a.flowBack() },
];

/** Normaliza para búsqueda: minúsculas y sin acentos. */
function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function scoreCommand(cmd: Command, q: string): number {
  const hay = [norm(cmd.title), ...cmd.keywords.map(norm)];
  let best = 0;
  for (const term of hay) {
    if (term === q) best = Math.max(best, 100);
    else if (term.startsWith(q)) best = Math.max(best, 70);
    else if (term.includes(q)) best = Math.max(best, 40);
  }
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length > 1 && words.every((w) => hay.some((h) => h.includes(w)))) {
    best = Math.max(best, 55);
  }
  return best;
}

/** True si el comando es accionable en el contexto (default: sí). */
export function isEnabled(cmd: Command, ctx: CommandContext): boolean {
  return cmd.enabled ? cmd.enabled(ctx) : true;
}

/**
 * Filtra por paso (`when`) y ordena por relevancia. NO oculta los deshabilitados
 * (se muestran atenuados con su requisito). Con query vacía: todos los del paso,
 * accionables primero.
 */
export function rankCommands(
  commands: Command[],
  query: string,
  ctx: CommandContext,
): Command[] {
  const available = commands.filter((c) => !c.when || c.when(ctx));
  const q = norm(query.trim());
  if (!q) {
    return [...available].sort(
      (a, b) => Number(isEnabled(b, ctx)) - Number(isEnabled(a, ctx)),
    );
  }
  return available
    .map((c) => ({ c, score: scoreCommand(c, q) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => {
      const en = Number(isEnabled(b.c, ctx)) - Number(isEnabled(a.c, ctx));
      return b.score - a.score || en;
    })
    .map((x) => x.c);
}
