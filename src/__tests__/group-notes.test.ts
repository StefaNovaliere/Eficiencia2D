import { describe, expect, it } from "vitest";
import {
  createGroupNote,
  noteCountByCutId,
  noteCountByGroupId,
  notesForCut,
  notesForGroup,
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
    expect(note.id).toMatch(/^note-/);
  });

  it("crea nota ligada a un corte", () => {
    const note = createGroupNote(12, "ventana", "cut-abc");
    expect(note.groupId).toBe(12);
    expect(note.cutId).toBe("cut-abc");
  });

  it("serializa snake_case con cut_id opcional", () => {
    const note = createGroupNote(5, "hola", "cut-1");
    const wire = serializeGroupNotesForApi([note]);
    expect(wire[0]).toMatchObject({
      id: note.id,
      group_id: 5,
      cut_id: "cut-1",
      text: "hola",
    });
    const parent = createGroupNote(5, "pared");
    expect(serializeGroupNotesForApi([parent])[0]).not.toHaveProperty("cut_id");
  });

  it("parsea respuesta del backend con cut_id", () => {
    const notes = parseGroupNotesFromApi([
      { id: "n1", group_id: 3, text: "reforzar", created_at: "2026-01-01T00:00:00Z" },
      { id: "n2", group_id: 3, cut_id: "cut-9", text: "marco" },
      { group_id: 1, text: "" },
      { text: "sin grupo" },
    ]);
    expect(notes).toHaveLength(2);
    expect(notes[0].id).toBe("n1");
    expect(notes[0].cutId).toBeUndefined();
    expect(notes[1].cutId).toBe("cut-9");
  });

  it("separa notas de componente y de corte", () => {
    const parentA = createGroupNote(1, "a");
    const parentB = createGroupNote(1, "b");
    const cutNote = createGroupNote(1, "corte", "cut-x");
    const other = createGroupNote(2, "c");
    const all = [parentA, parentB, cutNote, other];

    expect(notesForGroup(all, 1)).toEqual([parentA, parentB]);
    expect(notesForCut(all, "cut-x")).toEqual([cutNote]);
    expect(notesForTarget(all, 1, null)).toEqual([parentA, parentB]);
    expect(notesForTarget(all, 1, "cut-x")).toEqual([cutNote]);
  });

  it("cuenta por grupo solo notas de componente", () => {
    const counts = noteCountByGroupId([
      createGroupNote(1, "a"),
      createGroupNote(1, "b"),
      createGroupNote(1, "corte", "cut-1"),
      createGroupNote(2, "c"),
    ]);
    expect(counts.get(1)).toBe(2);
    expect(counts.get(2)).toBe(1);
  });

  it("cuenta por corte y borra notas al eliminar el corte", () => {
    const notes = [
      createGroupNote(1, "pared"),
      createGroupNote(1, "ventana", "cut-1"),
      createGroupNote(1, "otra", "cut-2"),
    ];
    expect(noteCountByCutId(notes).get("cut-1")).toBe(1);
    expect(removeNotesForCut(notes, "cut-1")).toHaveLength(2);
    expect(removeNotesForCut(notes, "cut-1").every((n) => n.cutId !== "cut-1")).toBe(
      true,
    );
  });
});
