import { describe, expect, it } from "vitest";
import {
  createGroupNote,
  noteComponentId,
  noteCountByCutId,
  noteCountByGroupId,
  notesForComponent,
  notesForCut,
  notesForTarget,
  parseGroupNotesFromApi,
  removeNotesForCut,
  serializeGroupNotesForApi,
} from "@/core/group-notes";

describe("group-notes", () => {
  it("crea nota con texto recortado", () => {
    const note = createGroupNote(12, "  pintar de amarillo  ");
    expect(note.groupId).toBe(12);
    expect(note.text).toBe("pintar de amarillo");
    expect(note.cutId).toBeUndefined();
    expect(note.componentId).toBeUndefined();
    expect(note.id).toMatch(/^note-/);
  });

  it("crea nota ligada a un corte", () => {
    const note = createGroupNote(12, "ventana", { cutId: "cut-abc" });
    expect(note.groupId).toBe(12);
    expect(note.cutId).toBe("cut-abc");
    expect(note.componentId).toBeUndefined();
  });

  it("crea nota ligada a un componente derivado", () => {
    const note = createGroupNote(12, "resto", { componentId: -12001 });
    expect(note.groupId).toBe(12);
    expect(note.componentId).toBe(-12001);
    expect(noteComponentId(note)).toBe(-12001);
  });

  it("serializa snake_case con cut_id y component_id", () => {
    const cutNote = createGroupNote(5, "hola", { cutId: "cut-1" });
    expect(serializeGroupNotesForApi([cutNote])[0]).toMatchObject({
      group_id: 5,
      cut_id: "cut-1",
      text: "hola",
    });
    const pieceNote = createGroupNote(5, "resto", { componentId: -5001 });
    expect(serializeGroupNotesForApi([pieceNote])[0]).toMatchObject({
      group_id: 5,
      component_id: -5001,
      text: "resto",
    });
    const parent = createGroupNote(5, "pared");
    expect(serializeGroupNotesForApi([parent])[0]).not.toHaveProperty("cut_id");
    expect(serializeGroupNotesForApi([parent])[0]).not.toHaveProperty(
      "component_id",
    );
  });

  it("parsea respuesta del backend", () => {
    const notes = parseGroupNotesFromApi([
      { id: "n1", group_id: 3, text: "reforzar", created_at: "2026-01-01T00:00:00Z" },
      { id: "n2", group_id: 3, cut_id: "cut-9", text: "marco" },
      { id: "n3", group_id: 3, component_id: -3001, text: "resto" },
      { group_id: 1, text: "" },
      { text: "sin grupo" },
    ]);
    expect(notes).toHaveLength(3);
    expect(notes[0].cutId).toBeUndefined();
    expect(notes[1].cutId).toBe("cut-9");
    expect(notes[2].componentId).toBe(-3001);
  });

  it("separa notas de componente, pieza y corte", () => {
    const parent = createGroupNote(1, "padre");
    const resto = createGroupNote(1, "resto", { componentId: -1001 });
    const cutNote = createGroupNote(1, "corte", { cutId: "cut-x" });
    const other = createGroupNote(2, "c");
    const all = [parent, resto, cutNote, other];

    expect(notesForComponent(all, 1)).toEqual([parent]);
    expect(notesForComponent(all, -1001)).toEqual([resto]);
    expect(notesForCut(all, "cut-x")).toEqual([cutNote]);
    expect(notesForTarget(all, -1001, null)).toEqual([resto]);
    expect(notesForTarget(all, 1, "cut-x")).toEqual([cutNote]);
  });

  it("cuenta por componente de display, no por padre", () => {
    const counts = noteCountByGroupId([
      createGroupNote(1, "a"),
      createGroupNote(1, "resto", { componentId: -1001 }),
      createGroupNote(1, "corte", { cutId: "cut-1" }),
      createGroupNote(2, "c"),
    ]);
    expect(counts.get(1)).toBe(1);
    expect(counts.get(-1001)).toBe(1);
    expect(counts.get(2)).toBe(1);
  });

  it("cuenta por corte y borra notas al eliminar el corte", () => {
    const notes = [
      createGroupNote(1, "pared"),
      createGroupNote(1, "ventana", { cutId: "cut-1" }),
      createGroupNote(1, "otra", { cutId: "cut-2" }),
    ];
    expect(noteCountByCutId(notes).get("cut-1")).toBe(1);
    expect(removeNotesForCut(notes, "cut-1")).toHaveLength(2);
  });
});
