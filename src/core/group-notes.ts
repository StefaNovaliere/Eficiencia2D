/**
 * Notas de usuario asociadas a un **componente** visible del modelo, o a un
 * **corte** concreto.
 *
 * - `groupId`: siempre el id de topología padre (≥ 0) para persistencia.
 * - `componentId`: id del componente de display (puede ser negativo si es
 *   pieza derivada de un corte). Sin esto, las notas de un “resto” y las del
 *   padre se mezclaban.
 * - `cutId`: si está, la nota es del corte (`UserCut.id`), no del componente.
 *
 * Persistencia: campo `notes` en `estado.json` (PATCH /api/projects/{id}/state).
 */

export interface GroupNote {
  id: string;
  /** Id del grupo de topología (padre, ≥ 0). */
  groupId: number;
  /**
   * Componente de display al que pertenece la nota (puede ser id derivado < 0).
   * Si falta, se interpreta como el propio `groupId` (notas legacy).
   */
  componentId?: number;
  /**
   * Si está definido, la nota es del corte (`UserCut.id`), no del componente.
   */
  cutId?: string;
  text: string;
  /** ISO 8601 — opcional (el backend puede completarlo). */
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateGroupNoteOpts {
  cutId?: string;
  /** Id del componente de display. Por defecto = groupId. */
  componentId?: number;
}

export function createGroupNoteId(): string {
  return `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createGroupNote(
  groupId: number,
  text: string,
  opts?: CreateGroupNoteOpts | string,
): GroupNote {
  const now = new Date().toISOString();
  // Compat: tercer arg string = cutId (API anterior).
  const cutId = typeof opts === "string" ? opts : opts?.cutId;
  const componentId =
    typeof opts === "string" ? undefined : opts?.componentId;
  return {
    id: createGroupNoteId(),
    groupId,
    ...(cutId ? { cutId } : {}),
    ...(!cutId && componentId != null && componentId !== groupId
      ? { componentId }
      : {}),
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

/** Id de display efectivo de una nota de componente (sin corte). */
export function noteComponentId(note: GroupNote): number {
  return note.componentId ?? note.groupId;
}

/** Notas del componente de display (sin corte asociado). */
export function notesForComponent(
  notes: GroupNote[],
  componentId: number,
): GroupNote[] {
  return notes.filter(
    (n) => !n.cutId && noteComponentId(n) === componentId,
  );
}

/** @deprecated Usar notesForComponent — filtra por padre y mezcla piezas. */
export function notesForGroup(notes: GroupNote[], groupId: number): GroupNote[] {
  return notesForComponent(notes, groupId);
}

/** Notas de un corte concreto. */
export function notesForCut(notes: GroupNote[], cutId: string): GroupNote[] {
  return notes.filter((n) => n.cutId === cutId);
}

/**
 * Notas del contexto activo: si hay `cutId`, solo las de ese corte;
 * si no, solo las del componente de display indicado.
 */
export function notesForTarget(
  notes: GroupNote[],
  componentId: number,
  cutId?: string | null,
): GroupNote[] {
  if (cutId) return notesForCut(notes, cutId);
  return notesForComponent(notes, componentId);
}

/**
 * Cuenta notas de componente por id de display (excluye notas de cortes).
 * Incluye ids derivados negativos.
 */
export function noteCountByGroupId(notes: GroupNote[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const n of notes) {
    if (n.cutId) continue;
    const cid = noteComponentId(n);
    map.set(cid, (map.get(cid) ?? 0) + 1);
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
    ...(n.componentId != null && n.componentId !== n.groupId
      ? { component_id: n.componentId }
      : {}),
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
    const compRaw = o.component_id ?? o.componentId;
    const componentId =
      compRaw != null && Number.isFinite(Number(compRaw))
        ? Number(compRaw)
        : undefined;
    out.push({
      id: String(o.id ?? createGroupNoteId()),
      groupId,
      ...(cutId ? { cutId } : {}),
      ...(!cutId && componentId != null && componentId !== groupId
        ? { componentId }
        : {}),
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
