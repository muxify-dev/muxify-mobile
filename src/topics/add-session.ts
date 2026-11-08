import { shellQuote } from '@/tmux/commands';

import { object, string } from './json-shape';

/** What one `topic add-session` came to: the new Session's name, or the Host's reason it made none. */
export type AddSessionRead = { kind: 'added'; session: string } | { kind: 'failed'; error: string };

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
