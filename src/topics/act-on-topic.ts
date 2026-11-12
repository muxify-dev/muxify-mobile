import { deviceLog } from '@/diagnostics/device-log';
import { speakingAs } from '@/diagnostics/log';
import { describeConnectionFailure } from '@/ssh/connect-host';
import { deviceHostStore } from '@/storage/device-store';
import { appConnections } from '@/tmux/ssh-connection';
import type { TmuxTransport } from '@/tmux/transport';

import type { TopicId } from './environment';
import type { MuxifyCli } from './muxify-cli';
import { TOPIC_ACTION_LABEL, type TopicAction } from './topic-action';
import { DROP_LABEL, type Drop } from './topic-drop';
import type { TopicWrite } from './topic-edit';

const say = speakingAs(deviceLog(), 'topic');

/**
 * Sends one menu order for a Topic to its Host, on the Host's Connection. It
 * never throws: a Host that is no longer saved and a Connection that breaks
 * are each a failed write that carries its reason.
 */
export function actOnTopic(hostId: string, topicId: TopicId, action: TopicAction): Promise<TopicWrite> {
  return orderHost(hostId, TOPIC_ACTION_LABEL[action], (exec, muxify) => muxify.act(exec, topicId, action));
}

/** Sends one drop of a dragged Topic card to its Host, as `actOnTopic` sends a menu order. */
export function dropTopic(hostId: string, topicId: TopicId, drop: Drop): Promise<TopicWrite> {
  return orderHost(hostId, DROP_LABEL[drop.kind], (exec, muxify) => muxify.drop(exec, topicId, drop));
}

async function orderHost(
  hostId: string,
  label: string,
  send: (exec: TmuxTransport['exec'], muxify: MuxifyCli) => Promise<TopicWrite>,
): Promise<TopicWrite> {
  const host = (await deviceHostStore().load()).hosts.find((candidate) => candidate.id === hostId);
  if (!host) return { kind: 'failed', error: 'This Host is no longer saved.' };
  try {
    const write = await appConnections().write(host, (transport, muxify) =>
      send((command) => transport.exec(command), muxify),
    );
    say(
      write.kind === 'changed'
        ? `${host.displayName} did ${label} on a Topic`
        : `${host.displayName} refused ${label}: ${write.error}`,
    );
    return write;
  } catch (error) {
    const message = describeConnectionFailure(error);
    say(`${host.displayName} could not do ${label}: ${message}`);
    return { kind: 'failed', error: message };
  }
}
