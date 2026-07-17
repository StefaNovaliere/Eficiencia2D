/**
 * Notas de usuario asociadas a componentes del modelo (paredes, pisos, etc.)
 * o a un corte concreto dentro de ese componente.
 *
 * Siempre se guardan contra el `group_id` padre de la topología del backend
 * (nunca ids negativos derivados de cortes). Ver `cutGroupOwnerId`.
 *
 * Si `cutId` está definido, la nota pertenece a ese corte (UserCut.id) y no
 * al componente contenedor. Sin `cutId`, pertenece solo al componente.
 *
 * Persistencia: campo `notes` en `estado.json` (PATCH /api/projects/{id}/state)
 * y opcionalmente en payloads de nesting/generate.
 */

export interface GroupNote {
  id: string;
  /** Id del grupo de topología (padre). */
  groupId: number;
  /**
   * Si está definido, la nota es del corte (`UserCut.id`), no del componente.
   * Ausente / undefined = nota del componente contenedor.
   */
  cutId?: string;
  text: string;
  /** ISO 8601 — opcional (el backend puede completarlo). */
  createdAt?: string;
  updatedAt?: string;
}

export function createGroupNoteId(): string {
  return `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createGroupNote(
  groupId: number,
  text: string,
  cutId?: string,
): GroupNote {
  const now = new Date().toISOString();
  return {
    id: createGroupNoteId(),
    groupId,
    ...(cutId ? { cutId } : {}),
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

/** Notas del componente (sin corte asociado). */
export function notesForGroup(notes: GroupNote[], groupId: number): GroupNote[] {
  return notes.filter((n) => n.groupId === groupId && !n.cutId);
}

/** Notas de un corte concreto. */
export function notesForCut(notes: GroupNote[], cutId: string): GroupNote[] {
  return notes.filter((n) => n.cutId === cutId);
}

/**
 * Notas del contexto activo: si hay `cutId`, solo las de ese corte;
 * si no, solo las del componente (sin `cutId`).
 */
export function notesForTarget(
  notes: GroupNote[],
  groupId: number,
  cutId?: string | null,
): GroupNote[] {
  if (cutId) return notesForCut(notes, cutId);
  return notesForGroup(notes, groupId);
}

/** Cuenta solo notas de componente (excluye notas de cortes). */
export function noteCountByGroupId(notes: GroupNote[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const n of notes) {
    if (n.cutId) continue;
    map.set(n.groupId, (map.get(n.groupId) ?? 0) + 1);
  }
  return map;
}

/** Cuenta notas por id de corte. */
export function noteCountByCutId(notes: GroupNote[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const n of notes) {
    if (!n.cutId) continue;
    map.set(n.cutId, (map.get(n.cutId) ?? 0) + 1);
  }
  return map;
}

export function removeNotesForCut(notes: GroupNote[], cutId: string): GroupNote[] {
  return notes.filter((n) => n.cutId !== cutId);
}

export function removeNotesForCuts(
  notes: GroupNote[],
  cutIds: Iterable<string>,
): GroupNote[] {
  const set = cutIds instanceof Set ? cutIds : new Set(cutIds);
  if (set.size === 0) return notes;
  return notes.filter((n) => !n.cutId || !set.has(n.cutId));
}

export function serializeGroupNotesForApi(notes: GroupNote[]): Record<string, unknown>[] {
  return notes.map((n) => ({
    id: n.id,
    group_id: n.groupId,
    text: n.text,
    ...(n.cutId ? { cut_id: n.cutId } : {}),
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
    const cutRaw = o.cut_id ?? o.cutId;
    const cutId =
      typeof cutRaw === "string" && cutRaw.trim() ? cutRaw.trim() : undefined;
    out.push({
      id: String(o.id ?? createGroupNoteId()),
      groupId,
      ...(cutId ? { cutId } : {}),
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
