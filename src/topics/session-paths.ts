import type { TopicId } from './environment';
import { array, object, string } from './json-shape';

/** What every Session Path row of the Host Server says: a Session Path, or a Worktree of one. */
interface SessionPathFields {
  kind: 'session_path' | 'worktree';
  name: string;
  label: string;
  directory: string;
  worktree: { path: string; branch: string | null } | null;
  alsoIn: { id: string; label: string }[];
}

/** A row of `session_paths { topic }`: a folder choice for one Topic. */
export interface SessionPathChoice extends SessionPathFields {
  inThisTopic: boolean;
}

/** A row of `session_paths` with no Topic. `lastVisit` is ISO 8601, or null for a folder never visited. */
export interface SessionPathRow extends SessionPathFields {
  lastVisit: string | null;
}

export interface SessionPathSection {
  id: 'in-topic' | 'paths' | 'worktrees';
  title: string;
  choices: SessionPathChoice[];
}

export function parseSessionPaths(json: unknown, expectedTopic: TopicId): SessionPathChoice[] {
  const answer = object(json, 'session paths');
  const topic = object(answer.topic, 'topic');
  if (string(topic.id, 'topic.id') !== expectedTopic) throw new Error('topic.id: expected the requested Topic');
  return array(answer.rows, 'rows').map((value, index) => {
    const at = `rows[${index}]`;
    const row = object(value, at);
    if (typeof row.in_this_topic !== 'boolean') throw new Error(`${at}.in_this_topic: expected a boolean`);
    return { ...parseFields(row, at), inThisTopic: row.in_this_topic };
  });
}

/** The rows of a `session_paths` answer, in the order they came: the Host ranked them. */
export function parseSessionPathRows(json: unknown): SessionPathRow[] {
  return array(object(json, 'session paths').rows, 'rows').map((value, index) => {
    const at = `rows[${index}]`;
    const row = object(value, at);
    return { ...parseFields(row, at), lastVisit: row.last_visit === null ? null : string(row.last_visit, `${at}.last_visit`) };
  });
}

/** The rows as `session_paths` gives them, so that the phone's copy is read back by the same parse. */
export function sessionPathRowsJson(rows: readonly SessionPathRow[]): unknown {
  return {
    rows: rows.map((row) => ({
      kind: row.kind,
      name: row.name,
      label: row.label,
      directory: row.directory,
      worktree: row.worktree,
      also_in: row.alsoIn,
      last_visit: row.lastVisit,
    })),
  };
}

function parseFields(row: Record<string, unknown>, at: string): SessionPathFields {
  if (row.kind !== 'session_path' && row.kind !== 'worktree') throw new Error(`${at}.kind: expected a Session Path or Worktree`);
  const worktree = row.worktree === null ? null : object(row.worktree, `${at}.worktree`);
  return {
    kind: row.kind,
    name: string(row.name, `${at}.name`),
    label: string(row.label, `${at}.label`),
    directory: string(row.directory, `${at}.directory`),
    worktree: worktree === null ? null : {
      path: string(worktree.path, `${at}.worktree.path`),
      branch: worktree.branch === null ? null : string(worktree.branch, `${at}.worktree.branch`),
    },
    alsoIn: array(row.also_in, `${at}.also_in`).map((entry, i) => {
      const where = `${at}.also_in[${i}]`;
      const other = object(entry, where);
      return { id: string(other.id, `${where}.id`), label: string(other.label, `${where}.label`) };
    }),
  };
}

/** The words of a row that a search matches: its names, its path, its branch and the Topics it is also in. */
export function searchFields(row: SessionPathFields): string[] {
  return [row.name, row.label, row.directory, row.worktree?.branch ?? '', ...row.alsoIn.map((topic) => topic.label)];
}

export function sessionPathSections(choices: SessionPathChoice[], query: string): SessionPathSection[] {
  const sections: SessionPathSection[] = [
    { id: 'in-topic', title: 'In this Topic', choices: [] },
    { id: 'paths', title: 'Session Paths', choices: [] },
    { id: 'worktrees', title: 'Worktrees', choices: [] },
  ];
  const search = query.trim().toLocaleLowerCase();
  for (const choice of choices) {
    if (!searchFields(choice).some((field) => field.toLocaleLowerCase().includes(search))) continue;
    const index = choice.inThisTopic ? 0 : choice.kind === 'session_path' ? 1 : 2;
    sections[index].choices.push(choice);
  }
  return sections.filter((section) => section.choices.length > 0);
}
