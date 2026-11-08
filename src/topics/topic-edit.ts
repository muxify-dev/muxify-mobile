/**
 * The Edit sheet's model. Save sends one write for each field that differs
 * from what the Host last had, and nothing for the rest, so a phone edit of the
 * title does not put back a Note that the Mac changed in the meantime.
 */

/** A Topic's three fields that the Edit sheet can change. */
export interface TopicFields {
  title: string;
  /** null is no Note. */
  note: string | null;
  /** In the order to send them. The order is not a change. */
  tags: readonly string[];
}

export type TopicField = keyof TopicFields;

/** One write to the Host: `topic rename`, `topic note` or `topic tag set`. */
export type TopicChange =
  | { field: 'title'; title: string }
  | { field: 'note'; note: string | null }
  | { field: 'tags'; tags: readonly string[] };

/** What one write came to. */
export type TopicWrite = { kind: 'changed' } | { kind: 'failed'; error: string };

/** The Host's reason, under the field whose write it refused. */
export type FieldErrors = Partial<Record<TopicField, string>>;

/** The fields as the user typed them, as the Host keeps them: trimmed, and an empty Note is no Note. */
export function typedFields(title: string, note: string, tags: readonly string[]): TopicFields {
  const trimmedNote = note.trim();
  return {
    title: title.trim(),
    note: trimmedNote === '' ? null : trimmedNote,
    tags,
  };
}

/** The writes that make `saved` into `wanted`, in field order. */
export function changes(saved: TopicFields, wanted: TopicFields): TopicChange[] {
  const writes: TopicChange[] = [];
  if (wanted.title !== saved.title) writes.push({ field: 'title', title: wanted.title });
  if (wanted.note !== saved.note) writes.push({ field: 'note', note: wanted.note });
  if (!sameTags(wanted.tags, saved.tags)) writes.push({ field: 'tags', tags: wanted.tags });
  return writes;
}

/**
 * Sends each change, one at a time, and gives back what the Host now has. A
 * write that fails leaves its field as the Host had it, so the next Save with
 * the returned `saved` sends that field again and not the ones that went
 * through.
 */
export async function saveTopicEdit(
  saved: TopicFields,
  wanted: TopicFields,
  write: (change: TopicChange) => Promise<TopicWrite>,
): Promise<{ saved: TopicFields; errors: FieldErrors }> {
  let now = saved;
  const errors: FieldErrors = {};
  for (const change of changes(saved, wanted)) {
    const result = await write(change);
    if (result.kind === 'failed') errors[change.field] = result.error;
    else now = applied(now, change);
  }
  return { saved: now, errors };
}

/** Every change refused for one reason, as when the Host could not be reached and nothing was sent. */
export function unsent(saved: TopicFields, wanted: TopicFields, error: string): FieldErrors {
  return Object.fromEntries(changes(saved, wanted).map(({ field }) => [field, error]));
}

function applied(fields: TopicFields, change: TopicChange): TopicFields {
  switch (change.field) {
    case 'title':
      return { ...fields, title: change.title };
    case 'note':
      return { ...fields, note: change.note };
    case 'tags':
      return { ...fields, tags: change.tags };
  }
}

function sameTags(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  return left.size === new Set(b).size && b.every((tag) => left.has(tag));
}

/** The Topic's fields as a route param, from the Topic Screen to the Edit sheet. */
export function fieldsParam(fields: TopicFields): string {
  return JSON.stringify(fields);
}

/** A route param is open to any deep link, so a bad one gives null and the sheet does not open a form. */
export function fieldsFromParam(param: string | undefined): TopicFields | null {
  if (param === undefined) return null;
  try {
    const value: unknown = JSON.parse(param);
    const { title, note, tags } = value as Record<string, unknown>;
    if (typeof title !== 'string') return null;
    if (note !== null && typeof note !== 'string') return null;
    if (!Array.isArray(tags) || !tags.every((tag) => typeof tag === 'string')) return null;
    return { title, note, tags };
  } catch {
    return null;
  }
}
