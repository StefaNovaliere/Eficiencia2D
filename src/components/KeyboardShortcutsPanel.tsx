"use client";

import { Fragment } from "react";
import {
  KEYBOARD_SHORTCUT_SECTIONS,
  type KeyCombo,
  type KeyboardShortcutSection,
} from "@/core/keyboard-shortcuts";

function ShortcutKeys({ combos }: { combos: KeyCombo[] }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1.5 shrink-0">
      {combos.map((combo, comboIndex) => (
        <Fragment key={comboIndex}>
          {comboIndex > 0 && (
            <span className="text-[11px] text-base-content/40 px-0.5">o</span>
          )}
          <span className="inline-flex items-center gap-1">
            {combo.map((key, keyIndex) => (
              <Fragment key={keyIndex}>
                {keyIndex > 0 && (
                  <span className="text-[10px] text-base-content/30 select-none">+</span>
                )}
                <kbd className="kbd kbd-sm min-w-[1.75rem] font-mono text-xs bg-base-200 border-base-300/80 shadow-sm">
                  {key}
                </kbd>
              </Fragment>
            ))}
          </span>
        </Fragment>
      ))}
    </div>
  );
}

function ShortcutSection({ section }: { section: KeyboardShortcutSection }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-base-content">{section.title}</h2>
        {section.description && (
          <p className="text-xs text-base-content/55 mt-1">{section.description}</p>
        )}
      </div>

      <ul className="divide-y divide-base-300/40 rounded-xl border border-base-300/50 bg-base-100/50 overflow-hidden">
        {section.shortcuts.map((shortcut) => (
          <li
            key={shortcut.id}
            className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-4 px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm text-base-content">{shortcut.label}</p>
              {shortcut.detail && (
                <p className="text-xs text-base-content/50 mt-0.5">{shortcut.detail}</p>
              )}
            </div>
            <ShortcutKeys combos={shortcut.combos} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function KeyboardShortcutsPanel() {
  return (
    <div className="space-y-8">
      {KEYBOARD_SHORTCUT_SECTIONS.map((section) => (
        <ShortcutSection key={section.id} section={section} />
      ))}

      <p className="text-xs text-base-content/45 border-t border-base-300/40 pt-4">
        Los atajos con Ctrl también funcionan con ⌘ en macOS. No aplican mientras escribís
        en un campo de texto.
      </p>
    </div>
  );
}
