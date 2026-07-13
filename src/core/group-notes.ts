/**
 * Notas de usuario asociadas a componentes del modelo (paredes, pisos, etc.).
 *
 * Siempre se guardan contra el `group_id` padre de la topología del backend
 * (nunca ids negativos derivados de cortes). Ver `cutGroupOwnerId`.
 *
 * Persistencia: campo `notes` en `estado.json` (PATCH /api/projects/{id}/state)
 * y opcionalmente en payloads de nesting/generate.
 */

export interface GroupNote {
  id: string;
  /** Id del grupo de topología (padre). */
  groupId: number;
  text: string;
  /** ISO 8601 — opcional (el backend puede completarlo). */
  createdAt?: string;
  updatedAt?: string;
}

export function createGroupNoteId(): string {
  return `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createGroupNote(groupId: number, text: string): GroupNote {
  const now = new Date().toISOString();
  return {
    id: createGroupNoteId(),
    groupId,
    text: text.trim(),
    createdAt: now,
    updatedAt: now,
  };
}

export function upsertGroupNote(notes: GroupNote[], note: GroupNote): GroupNote[] {
  const next = notes.filter((n) => n.id !== note.id);
  next.push(note);
  return next;
}

export function removeGroupNote(notes: GroupNote[], id: string): GroupNote[] {
  return notes.filter((n) => n.id !== id);
}

export function notesForGroup(notes: GroupNote[], groupId: number): GroupNote[] {
  return notes.filter((n) => n.groupId === groupId);
}

export function noteCountByGroupId(notes: GroupNote[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const n of notes) {
    map.set(n.groupId, (map.get(n.groupId) ?? 0) + 1);
  }
  return map;
}

export function serializeGroupNotesForApi(notes: GroupNote[]): Record<string, unknown>[] {
  return notes.map((n) => ({
    id: n.id,
    group_id: n.groupId,
    text: n.text,
    ...(n.createdAt ? { created_at: n.createdAt } : {}),
    ...(n.updatedAt ? { updated_at: n.updatedAt } : {}),
  }));
}

export function parseGroupNotesFromApi(raw: unknown): GroupNote[] {
  if (!Array.isArray(raw)) return [];
  const out: GroupNote[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const groupId = Number(o.group_id ?? o.groupId);
    const text = o.text != null ? String(o.text).trim() : "";
    if (!Number.isFinite(groupId) || !text) continue;
    out.push({
      id: String(o.id ?? createGroupNoteId()),
      groupId,
      text,
      createdAt:
        typeof o.created_at === "string"
          ? o.created_at
          : typeof o.createdAt === "string"
            ? o.createdAt
            : undefined,
      updatedAt:
        typeof o.updated_at === "string"
          ? o.updated_at
          : typeof o.updatedAt === "string"
            ? o.updatedAt
            : undefined,
    });
  }
  return out;
}
