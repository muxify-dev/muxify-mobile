import { deviceLog } from '@/diagnostics/device-log';
import { speakingAs } from '@/diagnostics/log';
import type { Host } from '@/storage/records';
import { appConnections } from '@/tmux/ssh-connection';

import type { TopicId } from './environment';
import { newRequestId } from './request';
import { TOPIC_ACTION_LABEL, type TopicAction } from './topic-action';
import { DROP_LABEL, type Drop } from './topic-drop';
import type { TopicWrite } from './topic-edit';
import { WAKE_LABEL, type Wake } from './wake-topic';

const say = speakingAs(deviceLog(), 'topic');

/** One write a Topic card sends from its menu, a drop, or a wake of a Dormant Topic. */
export type TopicOrder =
  | { kind: 'action'; action: TopicAction }
  | { kind: 'drop'; drop: Drop }
  | { kind: 'wake'; wake: Wake };

/** The order in the Mac's words, as a menu and an alert name it. */
export function orderLabel(order: TopicOrder): string {
  switch (order.kind) {
    case 'action':
      return TOPIC_ACTION_LABEL[order.action];
    case 'drop':
      return DROP_LABEL[order.drop.kind];
    case 'wake':
      return WAKE_LABEL[order.wake];
  }
}

/**
 * Sends one order for a Topic to its Host, on the Host's Connection. The
 * Host's refusal is a failed write, and a Request in doubt an unknown one. A
 * break of the Connection throws, because only the caller knows whether the
 * order had left the phone: `sending` is called just before it does. Each call
 * is one tap, so each has its own Request id.
 */
export async function sendTopicOrder(host: Host, topicId: TopicId, order: TopicOrder, sending: () => void): Promise<TopicWrite> {
  const label = orderLabel(order);
  const request = newRequestId();
  try {
    const write = await appConnections().write(host, (transport, muxify) => {
      const exec = (command: string) => transport.exec(command);
      sending();
      switch (order.kind) {
        case 'action':
          return muxify.act(exec, topicId, order.action, request);
        case 'drop':
          return muxify.drop(exec, topicId, order.drop, request);
        case 'wake':
          return order.wake === 'reopen'
            ? muxify.reopenTopic(exec, topicId, request)
            : muxify.startTopicFresh(exec, topicId, request);
      }
    });
    say(describeWrite(host.displayName, label, write));
    return write;
  } catch (error) {
    say(`${host.displayName} broke off ${label}: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

function describeWrite(host: string, label: string, write: TopicWrite): string {
  switch (write.kind) {
    case 'changed':
      return `${host} did ${label} on a Topic`;
    case 'failed':
      return `${host} refused ${label}: ${write.error}`;
    case 'unknown':
      return `${host} did not finish ${label}, which may have changed the Topic: ${write.message}`;
  }
}
