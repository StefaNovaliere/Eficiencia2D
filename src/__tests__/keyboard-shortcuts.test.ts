import { describe, it, expect } from "vitest";
import { KEYBOARD_SHORTCUT_SECTIONS } from "@/core/keyboard-shortcuts";

describe("keyboard-shortcuts registry", () => {
  it("tiene secciones con ids únicos", () => {
    const sectionIds = KEYBOARD_SHORTCUT_SECTIONS.map((s) => s.id);
    expect(new Set(sectionIds).size).toBe(sectionIds.length);
  });

  it("tiene atajos con ids únicos en todo el registro", () => {
    const shortcutIds = KEYBOARD_SHORTCUT_SECTIONS.flatMap((s) =>
      s.shortcuts.map((sh) => sh.id),
    );
    expect(new Set(shortcutIds).size).toBe(shortcutIds.length);
  });

  it("cada atajo define al menos una combinación de teclas", () => {
    for (const section of KEYBOARD_SHORTCUT_SECTIONS) {
      for (const shortcut of section.shortcuts) {
        expect(shortcut.combos.length).toBeGreaterThan(0);
        for (const combo of shortcut.combos) {
          expect(combo.length).toBeGreaterThan(0);
        }
      }
    }
  });
});
