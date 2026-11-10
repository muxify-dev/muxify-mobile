import { useCallback } from 'react';
import { Alert } from 'react-native';

import type { TopicId } from '@/topics/environment';
import { WAKE_LABEL, wakeTopic, type Wake } from '@/topics/wake-topic';

/**
 * What Reopen and Start Fresh do in the long-press menu of a Dormant card, on
 * Home and the Host Screen. The menu closes at once, so the Host's error comes
 * as an alert, and after a wake the screen reads the Host's Topics again so
 * the card shows live.
 */
export function useWakeFromMenu(
  hostId: string,
  readAgain: () => Promise<void> | void,
): (topicId: TopicId, wake: Wake) => void {
  return useCallback(
    (topicId, wake) => {
      void (async () => {
        const write = await wakeTopic(hostId, topicId, wake);
        if (write.kind === 'failed') Alert.alert(`Could not ${WAKE_LABEL[wake]}`, write.error);
        await readAgain();
      })();
    },
    [hostId, readAgain],
  );
}
