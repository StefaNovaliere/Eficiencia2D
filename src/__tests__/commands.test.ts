import { describe, it, expect } from "vitest";
import { COMMANDS, rankCommands, type CommandContext } from "@/core/commands";

const review: CommandContext = { step: "review", hasSelection: true, selectionCount: 2 };
const reviewNoSel: CommandContext = { step: "review", hasSelection: false, selectionCount: 0 };
const nesting: CommandContext = { step: "nesting", hasSelection: false, selectionCount: 0 };

describe("rankCommands", () => {
  it("'curvar madera' rankea Kerf primero", () => {
    const r = rankCommands(COMMANDS, "curvar madera", review);
    expect(r[0]?.id).toBe("intent.kerf");
  });

  it("busca por jerga/alias ('reforzar esquina' → nervio)", () => {
    const r = rankCommands(COMMANDS, "reforzar esquina", review);
    expect(r[0]?.id).toBe("intent.rib");
  });

  it("ignora acentos ('area' encuentra 'áreas')", () => {
    const r = rankCommands(COMMANDS, "area", review);
    expect(r.some((c) => c.id === "tool.measure")).toBe(true);
  });

  it("gatea por contexto: sin selección no aparece Kerf ni nervio", () => {
    const ids = rankCommands(COMMANDS, "", reviewNoSel).map((c) => c.id);
    expect(ids).not.toContain("intent.kerf");
    expect(ids).not.toContain("intent.rib");
    expect(ids).toContain("tool.cut");
  });

  it("gatea por paso: en nesting no aparecen las herramientas de review", () => {
    const ids = rankCommands(COMMANDS, "", nesting).map((c) => c.id);
    expect(ids).not.toContain("tool.cut");
    expect(ids).toContain("nav.continue"); // navegación siempre disponible
  });

  it("nervio requiere exactamente 2 seleccionados", () => {
    const one: CommandContext = { step: "review", hasSelection: true, selectionCount: 1 };
    expect(rankCommands(COMMANDS, "nervio", one)).toHaveLength(0);
    expect(rankCommands(COMMANDS, "nervio", review)[0]?.id).toBe("intent.rib");
  });

  it("query vacía devuelve los disponibles (sin filtrar por score)", () => {
    expect(rankCommands(COMMANDS, "", review).length).toBeGreaterThan(5);
  });
});
