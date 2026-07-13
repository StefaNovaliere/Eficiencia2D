"use client";

import { useMemo, useState } from "react";
import { StickyNote, Trash2, Plus, Pencil, Check, X } from "lucide-react";
import {
  createGroupNote,
  notesForGroup,
  type GroupNote,
} from "@/core/group-notes";

interface GroupNotesPanelProps {
  notes: GroupNote[];
  /** Grupo actualmente seleccionado (padre). Si null, solo se muestra el listado global. */
  selectedGroupId: number | null;
  selectedGroupLabel?: string;
  /** Mapa groupId → etiqueta legible. */
  groupLabels: Map<number, string>;
  onChange: (notes: GroupNote[]) => void;
  onSelectGroup?: (groupId: number) => void;
}

export default function GroupNotesPanel({
  notes,
  selectedGroupId,
  selectedGroupLabel,
  groupLabels,
  onChange,
  onSelectGroup,
}: GroupNotesPanelProps) {
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [showAll, setShowAll] = useState(true);

  const selectedNotes = useMemo(
    () => (selectedGroupId != null ? notesForGroup(notes, selectedGroupId) : []),
    [notes, selectedGroupId],
  );

  const sortedAll = useMemo(
    () =>
      [...notes].sort((a, b) => {
        const ta = a.updatedAt ?? a.createdAt ?? "";
        const tb = b.updatedAt ?? b.createdAt ?? "";
        return tb.localeCompare(ta);
      }),
    [notes],
  );

  function handleAdd() {
    if (selectedGroupId == null) return;
    const text = draft.trim();
    if (!text) return;
    onChange([...notes, createGroupNote(selectedGroupId, text)]);
    setDraft("");
  }

  function handleDelete(id: string) {
    onChange(notes.filter((n) => n.id !== id));
    if (editingId === id) setEditingId(null);
  }

  function startEdit(note: GroupNote) {
    setEditingId(note.id);
    setEditText(note.text);
  }

  function commitEdit() {
    if (!editingId) return;
    const text = editText.trim();
    if (!text) return;
    const now = new Date().toISOString();
    onChange(
      notes.map((n) =>
        n.id === editingId ? { ...n, text, updatedAt: now } : n,
      ),
    );
    setEditingId(null);
    setEditText("");
  }

  function renderNoteRow(note: GroupNote, showGroupLabel: boolean) {
    const isEditing = editingId === note.id;
    const label = groupLabels.get(note.groupId) ?? `Grupo ${note.groupId}`;

    return (
      <div
        key={note.id}
        className="rounded-lg border border-base-300/50 bg-base-100/80 px-2.5 py-2 space-y-1.5"
      >
        {showGroupLabel && (
          <button
            type="button"
            className="text-[10px] font-semibold uppercase tracking-wide text-primary/80 hover:underline text-left"
            onClick={() => onSelectGroup?.(note.groupId)}
          >
            {label}
          </button>
        )}

        {isEditing ? (
          <div className="space-y-1.5">
            <textarea
              className="textarea textarea-bordered textarea-xs w-full min-h-[4rem] text-xs leading-relaxed"
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              autoFocus
            />
            <div className="flex gap-1 justify-end">
              <button
                type="button"
                className="btn btn-ghost btn-xs btn-circle"
                onClick={() => {
                  setEditingId(null);
                  setEditText("");
                }}
                aria-label="Cancelar"
              >
                <X size={12} />
              </button>
              <button
                type="button"
                className="btn btn-primary btn-xs btn-circle"
                onClick={commitEdit}
                aria-label="Guardar"
              >
                <Check size={12} />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-1.5">
            <p className="flex-1 text-xs text-base-content/80 leading-relaxed whitespace-pre-wrap">
              {note.text}
            </p>
            <button
              type="button"
              className="btn btn-ghost btn-xs btn-circle opacity-50 hover:opacity-100"
              onClick={() => startEdit(note)}
              aria-label="Editar nota"
            >
              <Pencil size={11} />
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-xs btn-circle opacity-50 hover:opacity-100 hover:text-error"
              onClick={() => handleDelete(note.id)}
              aria-label="Eliminar nota"
            >
              <Trash2 size={11} />
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Notas del componente seleccionado */}
      {selectedGroupId != null && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <StickyNote size={12} className="text-primary shrink-0" />
            <p className="text-[11px] font-semibold uppercase tracking-widest text-base-content/45">
              Notas · {selectedGroupLabel ?? `Grupo ${selectedGroupId}`}
            </p>
            <span className="badge badge-ghost badge-xs">{selectedNotes.length}</span>
          </div>

          {selectedNotes.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {selectedNotes.map((n) => renderNoteRow(n, false))}
            </div>
          )}

          <div className="flex gap-1.5">
            <textarea
              className="textarea textarea-bordered textarea-xs flex-1 min-h-[2.5rem] text-xs leading-relaxed"
              placeholder="Ej: pintar de amarillo, reforzar esquina…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleAdd();
                }
              }}
            />
            <button
              type="button"
              className="btn btn-primary btn-sm self-end rounded-lg gap-1"
              disabled={!draft.trim()}
              onClick={handleAdd}
              title="Agregar nota"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Listado global */}
      <div className="space-y-2 pt-1 border-t border-base-300/40">
        <button
          type="button"
          className="flex items-center gap-2 w-full text-left"
          onClick={() => setShowAll((v) => !v)}
        >
          <StickyNote size={12} className="text-base-content/40 shrink-0" />
          <p className="text-[11px] font-semibold uppercase tracking-widest text-base-content/45 flex-1">
            Todas las notas · {notes.length}
          </p>
          <span className="text-[10px] text-base-content/40">
            {showAll ? "Ocultar" : "Ver"}
          </span>
        </button>

        {showAll && (
          notes.length === 0 ? (
            <p className="text-[11px] text-base-content/45 px-1 leading-relaxed">
              Todavía no hay notas. Seleccioná un componente y agregá una.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto pr-0.5">
              {sortedAll.map((n) => renderNoteRow(n, true))}
            </div>
          )
        )}
      </div>
    </div>
  );
}
