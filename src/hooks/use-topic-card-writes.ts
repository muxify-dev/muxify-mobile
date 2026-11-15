import { Alert } from 'react-native';

import type { HostWrite } from '@/domain/host-write';
import type { TopicId } from '@/topics/environment';
import { orderLabel, sendTopicOrder, type TopicOrder } from '@/topics/act-on-topic';

import { useHostWrites } from './use-host-write';

/**
 * The writes a Topic card sends on the Host Screen: a menu order, a drop and a
 * wake. The card shows a spinner while its write runs, and a second order for
 * it is ignored. The menu has closed by then, so the end comes as an alert.
 * After the write, pass or fail, the screen reads the Listing again: it shows
 * where the Mac put the card, and so it is also the check of an unsure write.
 */
export function useTopicCardWrites(
  hostId: string,
  readAgain: () => Promise<void> | void,
  send: typeof sendTopicOrder = sendTopicOrder,
) {
  const writes = useHostWrites(hostId);
  const order = async (topicId: TopicId, order: TopicOrder) => {
    const end = await writes.sendAndReport(topicId, async ({ host, step, refuse }) => {
      const write = await send(host, topicId, order, () => step('sending'));
      if (write.kind === 'failed') refuse(write.error);
    });
    if (end === undefined) return;
    alertCardWrite(orderLabel(order), end);
    await readAgain();
  };
  return { order, writing: (topicId: TopicId) => writes.state(topicId).kind === 'running' };
}

/** The alert for how a card's write ended. Nothing when it went through. */
export function alertCardWrite(label: string, end: HostWrite) {
  if (end.kind === 'failed') Alert.alert(`Could not ${label}`, end.reason);
  if (end.kind === 'unsure') {
    Alert.alert(`${label} may have happened`, `${end.reason} It may still be working: look at the Topic again in a moment.`);
  }
}
