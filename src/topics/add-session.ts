import { shellQuote } from '@/tmux/commands';

import type { EnvironmentSnapshot, TopicId } from './environment';
import { object, string } from './json-shape';
import type { UnknownOutcome } from './request';
import type { SessionPathChoice } from './session-paths';

/**
 * What one `topic add-session` came to: the new Session's name, the Host's
 * reason it made none, or no answer, when the Host may have made it.
 */
export type AddSessionRead = { kind: 'added'; session: string } | { kind: 'failed'; error: string } | UnknownOutcome;

/**
 * The name to send as `topic add-session --name` for a Session at `folder`,
 * which the Host makes `<name>/<slug of the Topic>`. With `--name` the Host
 * finds a live Session of the Topic that has the name and makes nothing, so
 * the name must be one that no Session of the Topic has. The rule is the
 * Host's own `SessionNaming.available`: the name of the folder's Session Path,
 * and `+2`, `+3` and so on when the Topic has that name.
 */
export function freeSessionName(
  folder: string,
  choices: readonly SessionPathChoice[],
  snapshot: EnvironmentSnapshot,
  topic: TopicId,
): string {
  const base = choices.find((choice) => choice.directory === folder)?.name ?? folderSessionName(folder);
  const taken = new Set(
    snapshot.sessions.filter((session) => session.topic === topic).map(({ name }) => withoutSlug(name)),
  );
  if (!taken.has(base)) return base;
  const stem = base.replace(/\+([2-9]|[1-9]\d+)$/, '');
  let number = 2;
  while (taken.has(`${stem}+${number}`)) number += 1;
  return `${stem}+${number}`;
}

/** The Host's `SessionPath.sessionName` of the folder's last part: no spaces, and `_` for `.` and `:`, which tmux refuses. */
function folderSessionName(folder: string): string {
  const last = folder.replace(/\/+$/, '').split('/').pop() ?? '';
  return last.replaceAll(' ', '').replace(/[.:]/g, '_');
}

/** A Session of a Topic is named `<name>/<slug>`, and a slug has no `/`. */
function withoutSlug(sessionName: string): string {
  const slash = sessionName.lastIndexOf('/');
  return slash < 0 ? sessionName : sessionName.slice(0, slash);
}

/** The Session in the answer of `topic add-session --json`: `{"changed":{"session_name":…}}`. */
export function parseAddedSession(json: unknown): string {
  const changed = object(object(json, 'answer').changed, 'changed');
  return string(changed.session_name, 'changed.session_name');
}

/**
 * The folder as one shell word. `muxify` does not expand `~`, and a quoted `~`
 * does not reach the shell's own expansion, so a leading `~` becomes `"$HOME"`.
 * The rest is quoted as is.
 */
export function folderArgument(folder: string): string {
  if (folder === '~') return '"$HOME"';
  if (folder.startsWith('~/')) {
    const rest = folder.slice(2);
    return rest === '' ? '"$HOME"/' : `"$HOME"/${shellQuote(rest)}`;
  }
  return shellQuote(folder);
}
