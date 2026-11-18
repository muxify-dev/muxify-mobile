import { deviceLog } from '@/diagnostics/device-log';
import { speakingAs } from '@/diagnostics/log';
import { describeConnectionFailure } from '@/tmux/disconnect-reason';
import { followTopic } from '@/ssh/topic-feed';
import { deviceHostStore } from '@/storage/device-store';
import { appConnections } from '@/tmux/ssh-connection';

import type { TopicId } from './environment';
import { topicsUnavailable } from './host-topics';
import { pushedTopic } from './host-writes';
import type { TopicRead } from './topic-detail';

const say = speakingAs(deviceLog(), 'topic');

/**
 * One read of a Topic from its Host: the first push of a `topic` subscription
 * on the Host Server of the Host's Connection.
 *
 * The Topic entry path asks this. It never throws: a Host that is no longer
 * saved, a Host that refuses, a Host in Sessions only and a Topic the Host
 * cannot show are each a failed read that carries its reason.
 */
export async function readTopic(hostId: string, topicId: TopicId): Promise<TopicRead> {
  const host = (await deviceHostStore().load()).hosts.find((candidate) => candidate.id === hostId);
  if (!host) return { kind: 'failed', error: 'This Host is no longer saved.' };
  try {
    const topic = await pushedTopic(host, topicId);
    say(`${host.displayName} showed a Topic`);
    return { kind: 'shown', topic };
  } catch (error) {
    const message = describeConnectionFailure(error);
    say(`${host.displayName} could not show a Topic: ${message}`);
    return { kind: 'failed', error: message };
  }
}

/**
 * The Attach's `topic` subscription, on the Host Server of the Host's open
 * Connection, until the answer is called. With no Host Server on that
 * Connection there is no Topic detail, and the read fails with the reason.
 */
export function followHostTopic(hostId: string, topicId: TopicId, onRead: (read: TopicRead) => void): () => void {
  const server = appConnections().hostServer(hostId);
  if (!server) {
    onRead({ kind: 'failed', error: topicsUnavailable('this Host', 'no Host Server runs on its Connection.') });
    return () => {};
  }
  return followTopic(server, topicId, onRead, (line) => say(`Host Server: ${line}`));
}
