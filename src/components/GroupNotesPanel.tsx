"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { StickyNote, Trash2, Plus, Pencil, Check, X, Scissors } from "lucide-react";
import {
  createGroupNote,
  noteComponentId,
  notesForTarget,
  type GroupNote,
} from "@/core/group-notes";
import { cutGroupOwnerId } from "@/core/cut-derived-groups";

interface GroupNotesPanelProps {
  notes: GroupNote[];
  /**
   * Componente de display seleccionado (puede ser id derivado < 0).
   * Si null, solo se muestra el listado global.
   */
  selectedComponentId: number | null;
  selectedComponentLabel?: string;
  /**
   * Corte seleccionado. Si está definido, las notas se crean/listan para ese
   * corte (no para el componente).
   */
  selectedCutId?: string | null;
  selectedCutLabel?: string;
  /** Mapa componentId → etiqueta legible. */
  componentLabels: Map<number, string>;
  /** Mapa cutId → etiqueta legible. */
  cutLabels?: Map<string, string>;
  onChange: (notes: GroupNote[]) => void;
  onSelectComponent?: (componentId: number) => void;
  onSelectCut?: (groupId: number, cutId: string) => void;
  focusDraftKey?: number;
}

export default function GroupNotesPanel({
  notes,
  selectedComponentId,
  selectedComponentLabel,
  selectedCutId = null,
  selectedCutLabel,
  componentLabels,
  cutLabels,
  onChange,
  onSelectComponent,
  onSelectCut,
  focusDraftKey = 0,
}: GroupNotesPanelProps) {
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [showAll, setShowAll] = useState(true);
  const draftRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!focusDraftKey || selectedComponentId == null) return;
    const t = window.setTimeout(() => {
      draftRef.current?.focus();
      draftRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, 50);
    return () => window.clearTimeout(t);
  }, [focusDraftKey, selectedComponentId, selectedCutId]);

  const isCutContext = Boolean(selectedCutId);

  const selectedNotes = useMemo(
    () =>
      selectedComponentId != null
        ? notesForTarget(notes, selectedComponentId, selectedCutId)
        : [],
    [notes, selectedComponentId, selectedCutId],
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

  const contextTitle = isCutContext
    ? `Notas · Corte · ${selectedCutLabel ?? selectedCutId}`
    : `Notas · ${selectedComponentLabel ?? (selectedComponentId != null ? `Componente ${selectedComponentId}` : "")}`;

  const placeholder = isCutContext
    ? "Ej: marco de ventana, pulir borde…"
    : "Ej: pintar de amarillo, reforzar esquina…";

  function handleAdd() {
    if (selectedComponentId == null) return;
    const text = draft.trim();
    if (!text) return;
    const parentId = cutGroupOwnerId(selectedComponentId);
    onChange([
      ...notes,
      createGroupNote(parentId, text, {
        cutId: selectedCutId ?? undefined,
        componentId: selectedCutId ? undefined : selectedComponentId,
      }),
    ]);
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

  function handleSelectNoteOwner(note: GroupNote) {
    if (note.cutId) {
      onSelectCut?.(note.groupId, note.cutId);
      return;
    }
    onSelectComponent?.(noteComponentId(note));
  }

  function ownerLabel(note: GroupNote): string {
    if (note.cutId) {
      const groupLabel =
        componentLabels.get(note.groupId) ?? `Grupo ${note.groupId}`;
      const cutLabel = cutLabels?.get(note.cutId) ?? note.cutId;
      return `${groupLabel} · corte ${cutLabel}`;
    }
    const cid = noteComponentId(note);
    return componentLabels.get(cid) ?? `Componente ${cid}`;
  }

  function renderNoteRow(note: GroupNote, showOwnerLabel: boolean) {
    const isEditing = editingId === note.id;

    return (
      <div
        key={note.id}
        className="rounded-lg border border-base-300/50 bg-base-100/80 px-2.5 py-2 space-y-1.5"
      >
        {showOwnerLabel && (
          <button
            type="button"
            className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-primary/80 hover:underline text-left"
            onClick={() => handleSelectNoteOwner(note)}
          >
            {note.cutId && <Scissors size={9} className="shrink-0 opacity-70" />}
            {ownerLabel(note)}
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
      {selectedComponentId != null && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            {isCutContext ? (
              <Scissors size={12} className="text-warning shrink-0" />
            ) : (
              <StickyNote size={12} className="text-primary shrink-0" />
            )}
            <p
              className={`text-[11px] font-semibold uppercase tracking-widest ${
                isCutContext ? "text-warning/70" : "text-base-content/45"
              }`}
            >
              {contextTitle}
            </p>
            <span className="badge badge-ghost badge-xs">{selectedNotes.length}</span>
          </div>

          {isCutContext && (
            <p className="text-[10px] text-base-content/45 leading-relaxed px-0.5">
              Estas notas son solo del corte. Deseleccioná el corte para ver
              las del componente.
            </p>
          )}

          {selectedNotes.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {selectedNotes.map((n) => renderNoteRow(n, false))}
            </div>
          )}

          <div className="flex gap-1.5">
            <textarea
              ref={draftRef}
              className="textarea textarea-bordered textarea-xs flex-1 min-h-[2.5rem] text-xs leading-relaxed"
              placeholder={placeholder}
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
              className={`btn btn-sm self-end rounded-lg gap-1 ${
                isCutContext ? "btn-warning" : "btn-primary"
              }`}
              disabled={!draft.trim()}
              onClick={handleAdd}
              title={
                isCutContext
                  ? "Agregar nota al corte"
                  : "Agregar nota al componente"
              }
            >
              <Plus size={14} />
            </button>
          </div>
        </div>
      )}

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

        {showAll &&
          (notes.length === 0 ? (
            <p className="text-[11px] text-base-content/45 px-1 leading-relaxed">
              Todavía no hay notas. Seleccioná un componente (o un corte) y
              agregá una.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto pr-0.5">
              {sortedAll.map((n) => renderNoteRow(n, true))}
            </div>
          ))}
      </div>
    </div>
  );
}
