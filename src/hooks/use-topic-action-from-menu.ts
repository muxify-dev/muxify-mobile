import { useCallback } from 'react';
import { Alert } from 'react-native';

import { actOnTopic } from '@/topics/act-on-topic';
import type { TopicId } from '@/topics/environment';
import { TOPIC_ACTION_LABEL, type TopicAction } from '@/topics/topic-action';

/**
 * What a menu order does when it is picked in the long-press menu of a Topic
 * card, on Home and the Host Screen. The menu closes at once, so the Host's
 * refusal comes as an alert. After the write, pass or fail, the screen reads
 * the Host's Listing again, so the card shows where the Mac put it.
 */
export function useTopicActionFromMenu(
  hostId: string,
  readAgain: () => Promise<void> | void,
  act: typeof actOnTopic = actOnTopic,
): (topicId: TopicId, action: TopicAction) => Promise<void> {
  return useCallback(
    async (topicId, action) => {
      const write = await act(hostId, topicId, action);
      if (write.kind === 'failed') Alert.alert(`Could not ${TOPIC_ACTION_LABEL[action]}`, write.error);
      await readAgain();
    },
    [act, hostId, readAgain],
  );
}
