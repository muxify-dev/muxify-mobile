import type { TopicId } from './environment';
import { array, object, string } from './json-shape';

export interface SessionPathChoice {
  kind: 'session_path' | 'worktree';
  name: string;
  label: string;
  directory: string;
  worktree: { path: string; branch: string | null } | null;
  inThisTopic: boolean;
  alsoIn: { id: string; label: string }[];
}

export type SessionPathsRead =
  | { kind: 'listed'; choices: SessionPathChoice[] }
  | { kind: 'old' }
  | { kind: 'failed'; error: string };

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
    if (row.kind !== 'session_path' && row.kind !== 'worktree') throw new Error(`${at}.kind: expected a Session Path or Worktree`);
    if (typeof row.in_this_topic !== 'boolean') throw new Error(`${at}.in_this_topic: expected a boolean`);
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
      inThisTopic: row.in_this_topic,
      alsoIn: array(row.also_in, `${at}.also_in`).map((entry, i) => {
        const where = `${at}.also_in[${i}]`;
        const other = object(entry, where);
        return { id: string(other.id, `${where}.id`), label: string(other.label, `${where}.label`) };
      }),
    };
  });
}

export function sessionPathSections(choices: SessionPathChoice[], query: string): SessionPathSection[] {
  const sections: SessionPathSection[] = [
    { id: 'in-topic', title: 'In this Topic', choices: [] },
    { id: 'paths', title: 'Session Paths', choices: [] },
    { id: 'worktrees', title: 'Worktrees', choices: [] },
  ];
  const search = query.trim().toLocaleLowerCase();
  for (const choice of choices) {
    const fields = [choice.name, choice.label, choice.directory, choice.worktree?.branch ?? '', ...choice.alsoIn.map((topic) => topic.label)];
    if (!fields.some((field) => field.toLocaleLowerCase().includes(search))) continue;
    const index = choice.inThisTopic ? 0 : choice.kind === 'session_path' ? 1 : 2;
    sections[index].choices.push(choice);
  }
  return sections.filter((section) => section.choices.length > 0);
}
