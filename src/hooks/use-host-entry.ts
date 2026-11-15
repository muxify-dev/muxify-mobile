import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActionSheetIOS, Alert } from 'react-native';

import { ended, IDLE, reached, send, type HostWrite } from '@/domain/host-write';
import { describeError } from '@/lib/describe-error';
import { deviceHostStore } from '@/storage/device-store';
import { useAttachHolder, useOpenSession } from '@/tmux/attach-context';
import { captureAttachOrigin, type AttachOrigin } from '@/tmux/attach-holder';
import type { TopicId } from '@/topics/environment';
import { chooseTopicSession } from '@/topics/open-topic';
import { sendTopicOrder } from '@/topics/act-on-topic';
import { readTopic } from '@/topics/read-topic';
import { topicSeedParam, type TopicDetail } from '@/topics/topic-detail';
import { WAKE_LABEL, type Wake } from '@/topics/wake-topic';

import { endOfThrow } from './use-host-write';
import { alertCardWrite } from './use-topic-card-writes';

interface EntryFeedback {
  isCurrent: () => boolean;
  onError: (error: unknown) => void;
}

interface Delivery {
  origin: AttachOrigin;
  isCurrent: () => boolean;
}

export function useHostEntry(hostId: string, onAttached: () => void, fromAttach = false) {
  const router = useRouter();
  const holder = useAttachHolder();
  const deliverSession = useOpenSession();
  const [busyTopic, setBusyTopic] = useState<TopicId | null>(null);
  const running = useRef<symbol | null>(null);
  const focused = useRef(false);
  const focusRevision = useRef(0);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    return () => {
      focused.current = false;
      focusRevision.current += 1;
      running.current = null;
      setBusyTopic(null);
    };
  }, []));

  const attachTopic = useCallback(async (topic: TopicDetail, delivery: Delivery) => {
    const recent = await deviceHostStore().recentSessionsFor(hostId);
    if (!delivery.isCurrent()) return;
    const session = chooseTopicSession(topic, hostId, recent);
    if (!session) throw new Error('This Topic has no live Session. Return Home and read it again.');
    await deliverSession({ hostId, destination: { sessionName: session.name, topic: { id: topic.id, seed: topic } }, ...delivery });
    if (delivery.isCurrent()) onAttached();
  }, [hostId, onAttached, deliverSession]);

  const readAndAttach = useCallback(async (id: TopicId, delivery: Delivery) => {
    const result = await readTopic(hostId, id);
    if (!delivery.isCurrent()) return;
    if (result.kind === 'failed') throw new Error(result.error);
    await attachTopic(result.topic, delivery);
  }, [hostId, attachTopic]);

  const run = useCallback((id: TopicId | null, work: (delivery: Delivery) => Promise<void>, retry?: () => void, feedback?: EntryFeedback) => {
    if (running.current || !focused.current) return;
    const operation = Symbol();
    const revision = focusRevision.current;
    running.current = operation;
    const isCurrent = () => focused.current && focusRevision.current === revision && running.current === operation && (feedback?.isCurrent() ?? true);
    const delivery = { origin: captureAttachOrigin(holder.current()), isCurrent };
    setBusyTopic(id);
    void work(delivery).catch((error) => {
      if (!isCurrent()) return;
      if (feedback) { feedback.onError(error); return; }
      Alert.alert(id === null ? 'Could not open Session' : 'Could not open Topic', describeError(error), [
        ...(retry ? [{ text: 'Retry Read', onPress: retry }] : []), { text: 'OK' },
      ]);
    }).finally(() => {
      if (running.current !== operation) return;
      running.current = null;
      setBusyTopic(null);
    });
  }, [holder]);

  const openTopic = useCallback((topic: TopicDetail, feedback?: EntryFeedback) => {
    if (running.current || !focused.current) return;
    if (topic.state === 'empty') {
      router.push({ pathname: '/topic-add-session', params: { hostId, topicId: topic.id,
        seed: topicSeedParam(topic), ...(fromAttach ? { fromAttach: '1' } : {}) } });
      return;
    }
    const retryRead = () => run(topic.id, (delivery) => readAndAttach(topic.id, delivery), retryRead);
    if (topic.state === 'dormant') {
      const revision = focusRevision.current;
      ActionSheetIOS.showActionSheetWithOptions({
        title: topic.label,
        message: 'This Topic remembers Sessions but has none running.',
        options: ['Reopen', 'Start Fresh', 'Cancel'], cancelButtonIndex: 2,
      }, (index) => {
        if (!focused.current || focusRevision.current !== revision) return;
        const wake: Wake | undefined = index === 0 ? 'reopen' : index === 1 ? 'start-fresh' : undefined;
        if (!wake) return;
        run(topic.id, async (delivery) => {
          const end = await wakeOnce(hostId, topic.id, wake);
          if (!delivery.isCurrent()) return;
          if (end.kind !== 'idle') {
            alertCardWrite(WAKE_LABEL[wake], end, { text: 'Open Topic', onPress: retryRead });
            return;
          }
          await readAndAttach(topic.id, delivery);
        }, retryRead);
      });
      return;
    }
    run(topic.id, (delivery) => topic.sessions.length ? attachTopic(topic, delivery) : readAndAttach(topic.id, delivery), undefined, feedback);
  }, [hostId, router, run, attachTopic, readAndAttach, fromAttach]);

  const openSession = useCallback((sessionName: string) => {
    run(null, async (delivery) => {
      await deliverSession({ hostId, destination: { sessionName, topic: null }, ...delivery });
      if (delivery.isCurrent()) onAttached();
    });
  }, [hostId, run, deliverSession, onAttached]);

  return { openTopic, openSession, busyTopic };
}

/**
 * One wake from a card tap, as a Host Write, ended. The tap has its own
 * spinner and its own one-at-a-time rule, so it moves the Host Write itself
 * rather than through a runner.
 */
async function wakeOnce(hostId: string, topicId: TopicId, wake: Wake): Promise<HostWrite> {
  let write = send(IDLE, 0)!;
  try {
    const host = (await deviceHostStore().load()).hosts.find((candidate) => candidate.id === hostId);
    if (!host) return ended(write, { kind: 'refused', reason: 'This Host is no longer saved.' });
    const result = await sendTopicOrder(host, topicId, { kind: 'wake', wake }, () => { write = reached(write, 'sending'); });
    switch (result.kind) {
      case 'changed':
        return ended(write, { kind: 'done' });
      case 'failed':
        return ended(write, { kind: 'refused', reason: result.error });
      case 'unknown':
        return ended(write, { kind: 'unknown', reason: result.message });
    }
  } catch (error) {
    return ended(write, endOfThrow(error));
  }
}
