import { deviceLog } from '@/diagnostics/device-log';
import { speakingAs } from '@/diagnostics/log';
import type { Host } from '@/storage/records';

import type { BoardCard } from './board-card';
import type { TopicId } from './environment';
import type { EnvironmentCommand } from './host-write-request';
import { actionCommand, closingCommand, dropCommand, wakeCommand, writeCard, type ClosingAction } from './host-writes';
import { newRequestId } from './request';
import { TOPIC_ACTION_LABEL, type CardAction } from './topic-action';
import { DROP_LABEL, type Drop } from './topic-drop';
import type { TopicWrite } from './topic-edit';
import { WAKE_LABEL, type Wake } from './wake-topic';

const say = speakingAs(deviceLog(), 'topic');

/**
 * One write a card sends from its menu, a drop, or a wake of a Dormant card.
 * Settle and Forget are not among them: they close a Topic, so `closeTopic`
 * takes a Topic and nothing else.
 */
export type CardOrder =
  | { kind: 'action'; action: CardAction }
  | { kind: 'drop'; drop: Drop }
  | { kind: 'wake'; wake: Wake };

/** The order in the Mac's words, as a menu and an alert name it. */
export function orderLabel(order: CardOrder): string {
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
 * Sends one order for a card to its Host, as one `environment` request on the
 * Host Server that targets the card. The Host's refusal is a failed write, and
 * a Request in doubt an unknown one. A break of the Connection throws, because
 * only the caller knows whether the order had left the phone: `sending` is
 * called just before it does. Each call is one tap, so each has its own
 * Request id.
 */
export function sendCardOrder(host: Host, card: BoardCard, order: CardOrder, sending: () => void): Promise<TopicWrite> {
  return logged(host, orderLabel(order), () => writeCard(host, card, orderCommand(card, order), newRequestId(), sending));
}

/**
 * Settles or Forgets a Topic, as `sendCardOrder` sends an order. It first asks
 * the Host which Sessions the close offers, as the Host CLI's `topic settle`
 * and `topic forget` do, and keeps them or stops them all.
 */
export function closeTopic(host: Host, topic: TopicId, action: ClosingAction, sending: () => void): Promise<TopicWrite> {
  return logged(host, TOPIC_ACTION_LABEL[action], async () =>
    writeCard(host, { kind: 'topic', id: topic }, await closingCommand(host, topic, action), newRequestId(), sending));
}

function orderCommand(card: BoardCard, order: CardOrder): EnvironmentCommand {
  switch (order.kind) {
    case 'action':
      return actionCommand(order.action, card.kind);
    case 'drop':
      return dropCommand(order.drop);
    case 'wake':
      return wakeCommand(order.wake);
  }
}

async function logged(host: Host, label: string, write: () => Promise<TopicWrite>): Promise<TopicWrite> {
  try {
    const end = await write();
    say(describeWrite(host.displayName, label, end));
    return end;
  } catch (error) {
    say(`${host.displayName} broke off ${label}: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

function describeWrite(host: string, label: string, write: TopicWrite): string {
  switch (write.kind) {
    case 'changed':
      return `${host} did ${label} on a card`;
    case 'failed':
      return `${host} refused ${label}: ${write.error}`;
    case 'unknown':
      return `${host} did not finish ${label}, which may have changed the card: ${write.message}`;
  }
}
