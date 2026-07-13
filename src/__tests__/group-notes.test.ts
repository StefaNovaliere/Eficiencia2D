import { describe, expect, it } from "vitest";
import {
  createGroupNote,
  noteCountByGroupId,
  parseGroupNotesFromApi,
  serializeGroupNotesForApi,
} from "@/core/group-notes";

describe("group-notes", () => {
  it("crea nota con texto recortado", () => {
    const note = createGroupNote(12, "  pintar de amarillo  ");
    expect(note.groupId).toBe(12);
    expect(note.text).toBe("pintar de amarillo");
    expect(note.id).toMatch(/^note-/);
  });

  it("serializa snake_case", () => {
    const note = createGroupNote(5, "hola");
    const wire = serializeGroupNotesForApi([note]);
    expect(wire[0]).toMatchObject({
      id: note.id,
      group_id: 5,
      text: "hola",
    });
  });

  it("parsea respuesta del backend", () => {
    const notes = parseGroupNotesFromApi([
      { id: "n1", group_id: 3, text: "reforzar", created_at: "2026-01-01T00:00:00Z" },
      { group_id: 1, text: "" },
      { text: "sin grupo" },
    ]);
    expect(notes).toHaveLength(1);
    expect(notes[0].id).toBe("n1");
    expect(notes[0].groupId).toBe(3);
    expect(notes[0].createdAt).toBe("2026-01-01T00:00:00Z");
  });

  it("cuenta por grupo", () => {
    const counts = noteCountByGroupId([
      createGroupNote(1, "a"),
      createGroupNote(1, "b"),
      createGroupNote(2, "c"),
    ]);
    expect(counts.get(1)).toBe(2);
    expect(counts.get(2)).toBe(1);
  });
});
