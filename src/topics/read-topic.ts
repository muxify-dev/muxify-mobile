import { deviceLog } from '@/diagnostics/device-log';
import { speakingAs } from '@/diagnostics/log';
import { describeConnectionFailure } from '@/ssh/connect-host';
import { deviceHostStore } from '@/storage/device-store';
import { appConnections } from '@/tmux/ssh-connection';

import type { TopicId } from './environment';
import type { TopicRead } from './topic-detail';

const say = speakingAs(deviceLog(), 'topic');

/**
 * One read of a Topic from its Host, on the Host's Connection.
 *
 * The Topic Screen and the Terminal Screen's Title Sheet both ask this. It
 * never throws: a Host that is no longer saved, a Host that refuses and a
 * Topic the Host cannot show are each a failed read that carries its reason.
 */
export async function readTopic(hostId: string, topicId: TopicId): Promise<TopicRead> {
  const host = (await deviceHostStore().load()).hosts.find((candidate) => candidate.id === hostId);
  if (!host) return { kind: 'failed', error: 'This Host is no longer saved.' };
  try {
    const read = await appConnections().read(host, (transport, muxify) =>
      muxify.show((command) => transport.exec(command), topicId),
    );
    say(
      read.kind === 'shown'
        ? `${host.displayName} showed a Topic`
        : `${host.displayName} could not show a Topic: ${read.error}`,
    );
    return read;
  } catch (error) {
    const message = describeConnectionFailure(error);
    say(`${host.displayName} refused the Topic: ${message}`);
    return { kind: 'failed', error: message };
  }
}
