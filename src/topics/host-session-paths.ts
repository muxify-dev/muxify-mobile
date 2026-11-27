/**
 * The Session Paths of a Host as its Host Server ranks them, and the visit
 * that ranks a folder. The rows come in the Host's order; the phone keeps it.
 */
import { cancelOnAbort } from '@/ssh/host-server-channel';
import type { Host } from '@/storage/records';
import { appConnections } from '@/tmux/ssh-connection';

import type { TopicId } from './environment';
import type { ServerConnections } from './host-write-request';
import { parseSessionPathRows, parseSessionPaths, type SessionPathChoice, type SessionPathRow } from './session-paths';

/**
 * The Session Paths and Worktrees of the Host, with no Topic, for Go to:
 * `session_paths { query }`, or `session_paths {}` for an empty field. The
 * Host ranks them: for text with the Mac's match, with none by last visit,
 * newest first. A refusal, or a Host in Sessions only, throws with the reason.
 */
export async function rankedSessionPaths(
  host: Host,
  query: string,
  connections: ServerConnections = appConnections(),
  signal?: AbortSignal,
): Promise<SessionPathRow[]> {
  const text = query.trim();
  const answer = await connections.onServer(host, (server) => {
    const call = server.request({ session_paths: text === '' ? {} : { query: text } });
    return signal ? cancelOnAbort(call, signal) : call;
  });
  return parseSessionPathRows(answer);
}

/** The folder choices of one Topic, for Add a Session: `session_paths { topic }`. It throws as `rankedSessionPaths` does. */
export async function topicSessionPaths(
  host: Host,
  topic: TopicId,
  connections: ServerConnections = appConnections(),
  signal?: AbortSignal,
): Promise<SessionPathChoice[]> {
  const answer = await connections.onServer(host, (server) => {
    const call = server.request({ session_paths: { topic } });
    return signal ? cancelOnAbort(call, signal) : call;
  });
  return parseSessionPaths(answer, topic);
}
