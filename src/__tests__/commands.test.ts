import { describe, it, expect } from "vitest";
import { COMMANDS, rankCommands, isEnabled, type CommandContext, type Command } from "@/core/commands";

const sel2: CommandContext = { step: "review", selectionCount: 2 };
const sel1: CommandContext = { step: "review", selectionCount: 1 };
const sel0: CommandContext = { step: "review", selectionCount: 0 };
const nesting: CommandContext = { step: "nesting", selectionCount: 0 };

const byId = (id: string) => COMMANDS.find((c) => c.id === id) as Command;

describe("rankCommands", () => {
  it("'curvar madera' rankea Kerf primero", () => {
    expect(rankCommands(COMMANDS, "curvar madera", sel1)[0]?.id).toBe("sel.kerf");
  });

  it("jerga/alias: 'reforzar esquina' → nervio", () => {
    expect(rankCommands(COMMANDS, "reforzar esquina", sel2)[0]?.id).toBe("reinf.rib");
  });

  it("ignora acentos ('area' encuentra 'áreas')", () => {
    expect(rankCommands(COMMANDS, "area", sel1).some((c) => c.id === "tool.measure")).toBe(true);
  });

  it("catálogo COMPLETO: incluye vista, selección y refuerzos", () => {
    const ids = COMMANDS.map((c) => c.id);
    for (const id of ["view.xray", "edit.undo", "sel.merge", "sel.mark", "reinf.rib", "reinf.column"]) {
      expect(ids).toContain(id);
    }
  });
});

describe("requisitos (enabled/requirement)", () => {
  it("nervio deshabilitado con <2 seleccionados, con texto de requisito", () => {
    const rib = byId("reinf.rib");
    expect(isEnabled(rib, sel1)).toBe(false);
    expect(isEnabled(rib, sel2)).toBe(true);
    expect(rib.requirement).toMatch(/2 paredes/i);
  });

  it("acciones de selección deshabilitadas sin selección (pero VISIBLES)", () => {
    const ids = rankCommands(COMMANDS, "", sel0).map((c) => c.id);
    expect(ids).toContain("sel.kerf"); // se muestra…
    expect(isEnabled(byId("sel.kerf"), sel0)).toBe(false); // …pero atenuado
  });

  it("query vacía: los accionables van primero", () => {
    const r = rankCommands(COMMANDS, "", sel0);
    const firstDisabledIdx = r.findIndex((c) => !isEnabled(c, sel0));
    const lastEnabledIdx = r.map((c) => isEnabled(c, sel0)).lastIndexOf(true);
    expect(firstDisabledIdx).toBeGreaterThan(lastEnabledIdx);
  });
});

describe("gating por paso", () => {
  it("en nesting no aparecen las herramientas de review; sí la navegación", () => {
    const ids = rankCommands(COMMANDS, "", nesting).map((c) => c.id);
    expect(ids).not.toContain("tool.cut");
    expect(ids).toContain("nav.continue");
  });
});
