import { useCallback } from 'react';
import { Alert } from 'react-native';

import { dropTopic } from '@/topics/act-on-topic';
import type { TopicId } from '@/topics/environment';
import { DROP_LABEL, type Drop } from '@/topics/topic-drop';

/**
 * What the drop of a dragged Topic card does on the Host Screen: one write to
 * the Host, and then the screen reads the Host's Listing again, pass or fail,
 * so the card shows where the Mac put it. The Host's refusal comes as an
 * alert, as it does for a menu order.
 */
export function useTopicDrop(
  hostId: string,
  readAgain: () => Promise<void> | void,
  send: typeof dropTopic = dropTopic,
): (topicId: TopicId, drop: Drop) => Promise<void> {
  return useCallback(
    async (topicId, drop) => {
      const write = await send(hostId, topicId, drop);
      if (write.kind === 'failed') Alert.alert(`Could not ${DROP_LABEL[drop.kind]}`, write.error);
      await readAgain();
    },
    [hostId, readAgain, send],
  );
}
