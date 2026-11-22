import { Alert } from 'react-native';

import type { HostWrite } from '@/domain/host-write';
import { closeTopic, orderLabel, sendCardOrder, type CardOrder } from '@/topics/act-on-card';
import { cardKey, type BoardCard } from '@/topics/board-card';
import type { TopicId } from '@/topics/environment';
import type { ClosingAction } from '@/topics/host-writes';
import { TOPIC_ACTION_LABEL } from '@/topics/topic-action';
import type { TopicWrite } from '@/topics/topic-edit';

import { useHostWrites, type HostWriteRun } from './use-host-write';

/** The sends a card's writes go through. A test passes its own. */
export interface CardSends {
  order: typeof sendCardOrder;
  close: typeof closeTopic;
}

const HOST_SENDS: CardSends = { order: sendCardOrder, close: closeTopic };

/**
 * The writes a card sends on the Host Screen: a menu order, a drop, a wake,
 * and a Topic's Settle and Forget. The card shows a spinner while its write
 * runs, and a second order for it is ignored. The menu has closed by then, so
 * the end comes as an alert. Nothing is read after the write: the Host Server
 * pushes the Listing that shows where the Mac put the card, which is also the
 * check of an unsure write.
 */
export function useCardWrites(hostId: string, sends: CardSends = HOST_SENDS) {
  const writes = useHostWrites(hostId);
  const report = async (card: BoardCard, label: string, send: (run: HostWriteRun) => Promise<TopicWrite>) => {
    const end = await writes.sendAndReport(cardKey(card), async (run) => {
      const write = await send(run);
      if (write.kind === 'failed') run.refuse(write.error);
      if (write.kind === 'unknown') run.unsure(write.message);
    });
    if (end === undefined) return;
    alertCardWrite(label, end);
  };
  const order = (card: BoardCard, order: CardOrder) =>
    report(card, orderLabel(order), ({ host, step }) => sends.order(host, card, order, () => step('sending')));
  const close = (topic: TopicId, action: ClosingAction) =>
    report({ kind: 'topic', id: topic }, TOPIC_ACTION_LABEL[action], ({ host, step }) =>
      sends.close(host, topic, action, () => step('sending')));
  return { order, close, writing: (key: string) => writes.state(key).kind === 'running' };
}

/**
 * The alert for how a card's write ended. Nothing when it went through.
 * `look` is a button for an unsure end, for a caller that does not read the
 * Listing again by itself.
 */
export function alertCardWrite(label: string, end: HostWrite, look?: { text: string; onPress: () => void }) {
  if (end.kind === 'failed') Alert.alert(`Could not ${label}`, end.reason);
  if (end.kind === 'unsure') {
    const body = `${end.reason} It may still be working: look at the Topic again in a moment.`;
    if (look) Alert.alert(`${label} may have happened`, body, [look, { text: 'OK' }]);
    else Alert.alert(`${label} may have happened`, body);
  }
}
