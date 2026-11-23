import { deviceLog } from '@/diagnostics/device-log';
import { speakingAs } from '@/diagnostics/log';
import { describeError } from '@/lib/describe-error';
import type { HostServer } from '@/ssh/host-server';
import { appConnections } from '@/tmux/ssh-connection';

import type { TopicId } from './environment';

const say = speakingAs(deviceLog(), 'topic');

/** The part of the Connections that Unread on visit uses: the Host Server of a Host's open Connection. */
export type VisitConnections = { hostServer(hostId: string): HostServer | null };

/**
 * Unread on visit for Panes the Attach shows: `mark_read { panes }`, which
 * makes the Agent in each of them read, as the Mac does when it shows them.
 * Answers whether it sent the read.
 */
export function markPanesRead(hostId: string, panes: readonly string[], connections: VisitConnections = appConnections()): boolean {
  return visitRead(hostId, { panes: [...panes] }, `Panes ${panes.join(' ')}`, connections);
}

/** Unread on visit for an Empty Topic, whose page shows no Session: `mark_read { topics }` clears its Unread. */
export function markTopicRead(hostId: string, topicId: TopicId, connections: VisitConnections = appConnections()): void {
  visitRead(hostId, { topics: [topicId] }, `Topic ${topicId}`, connections);
}

/**
 * Sends one `mark_read` on the Host Server of the Host's open Connection. It
 * is not a Host Write: nothing waits for it, it shows nothing, and a failure
 * is only logged. With no Host Server, or in Sessions only, nothing is sent,
 * and it answers false. The Host Server pushes what changed.
 */
function visitRead(hostId: string, read: { panes: string[] } | { topics: TopicId[] }, what: string, connections: VisitConnections): boolean {
  const server = connections.hostServer(hostId);
  if (!server || server.state().kind === 'sessions-only') return false;
  void Promise.resolve()
    .then(() => server.request({ mark_read: read }))
    .catch((error: unknown) => say(`the Host did not mark ${what} read on the visit: ${describeError(error)}`));
  return true;
}
