import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActionSheetIOS, Alert } from 'react-native';

import { actionLabel } from '@/domain/cover';
import type { BoardSessionRow } from '@/domain/host-screen';
import { ended, IDLE, reached, send, type HostWrite } from '@/domain/host-write';
import { describeError } from '@/lib/describe-error';
import { deviceHostStore } from '@/storage/device-store';
import type { Host, PlaceTab } from '@/storage/records';
import { useAttachHolder, useOpenSession } from '@/tmux/attach-context';
import { captureAttachOrigin, type AttachOrigin } from '@/tmux/attach-holder';
import { sendCardOrder } from '@/topics/act-on-card';
import { cardKey } from '@/topics/board-card';
import type { TopicId } from '@/topics/environment';
import { wakeBoardSession, type BoardSessionWake } from '@/topics/host-writes';
import { chooseTopicSession } from '@/topics/open-topic';
import { readTopic } from '@/topics/read-topic';
import { newRequestId } from '@/topics/request';
import { topicSeedParam, type TopicDetail } from '@/topics/topic-detail';
import type { TopicWrite } from '@/topics/topic-edit';
import { markTopicRead } from '@/topics/unread-on-visit';
import { WAKE_LABEL, type Wake } from '@/topics/wake-topic';

import { alertCardWrite } from './use-card-writes';
import { endOfThrow } from './use-host-write';

interface EntryFeedback {
  isCurrent: () => boolean;
  onError: (error: unknown) => void;
}

interface Delivery {
  origin: AttachOrigin;
  isCurrent: () => boolean;
}

/**
 * `onAttached` gets the Tab of the Place the Attach goes back to, when it has
 * one: the screen then shows the Terminal Screen and the Web View in one move.
 */
export function useHostEntry(hostId: string, onAttached: (tab: PlaceTab | null) => void, fromAttach = false) {
  const router = useRouter();
  const holder = useAttachHolder();
  const deliverSession = useOpenSession();
  const [busyCard, setBusyCard] = useState<string | null>(null);
  const running = useRef<symbol | null>(null);
  const focused = useRef(false);
  const focusRevision = useRef(0);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    return () => {
      focused.current = false;
      focusRevision.current += 1;
      running.current = null;
      setBusyCard(null);
    };
  }, []));

  const attachTopic = useCallback(async (topic: TopicDetail, delivery: Delivery) => {
    const store = deviceHostStore();
    const [recent, place] = await Promise.all([store.recentSessionsFor(hostId), store.placeFor(hostId, { kind: 'topic', topicId: topic.id })]);
    if (!delivery.isCurrent()) return;
    const session = chooseTopicSession(topic, hostId, recent, place);
    if (!session) throw new Error('This Topic has no live Session. Return Home and read it again.');
    const restore = place?.session === session.name ? place : null;
    await deliverSession({ hostId, destination: { sessionName: session.name, topic: { id: topic.id, seed: topic }, restore },
      ...delivery });
    if (delivery.isCurrent()) onAttached(restore?.tab ?? null);
  }, [hostId, onAttached, deliverSession]);

  const readAndAttach = useCallback(async (id: TopicId, delivery: Delivery) => {
    const result = await readTopic(hostId, id);
    if (!delivery.isCurrent()) return;
    if (result.kind === 'failed') throw new Error(result.error);
    await attachTopic(result.topic, delivery);
  }, [hostId, attachTopic]);

  /**
   * `card` is the card that shows the spinner, by its `cardKey`, and whether
   * it is a Topic, which the failure alert names. Null for a plain Session.
   */
  const run = useCallback((card: { key: string; topic: boolean } | null, work: (delivery: Delivery) => Promise<void>, retry?: () => void, feedback?: EntryFeedback) => {
    if (running.current || !focused.current) return;
    const operation = Symbol();
    const revision = focusRevision.current;
    running.current = operation;
    const isCurrent = () => focused.current && focusRevision.current === revision && running.current === operation && (feedback?.isCurrent() ?? true);
    const delivery = { origin: captureAttachOrigin(holder.current()), isCurrent };
    setBusyCard(card?.key ?? null);
    void work(delivery).catch((error) => {
      if (!isCurrent()) return;
      if (feedback) { feedback.onError(error); return; }
      Alert.alert(card?.topic ? 'Could not open Topic' : 'Could not open Session', describeError(error), [
        ...(retry ? [{ text: actionLabel('try-again'), onPress: retry }] : []), { text: 'OK' },
      ]);
    }).finally(() => {
      if (running.current !== operation) return;
      running.current = null;
      setBusyCard(null);
    });
  }, [holder]);

  /** The action sheet of a tap on a Dormant card: Reopen, Start Fresh or Cancel. A screen left meanwhile hears nothing. */
  const askWake = useCallback((title: string, message: string, onWake: (wake: Wake) => void) => {
    const revision = focusRevision.current;
    ActionSheetIOS.showActionSheetWithOptions({
      title, message, options: [WAKE_LABEL.reopen, WAKE_LABEL['start-fresh'], 'Cancel'], cancelButtonIndex: 2,
    }, (index) => {
      if (!focused.current || focusRevision.current !== revision) return;
      const wake: Wake | undefined = index === 0 ? 'reopen' : index === 1 ? 'start-fresh' : undefined;
      if (wake) onWake(wake);
    });
  }, []);

  const openTopic = useCallback((topic: TopicDetail, feedback?: EntryFeedback) => {
    if (running.current || !focused.current) return;
    if (topic.state === 'empty') {
      // Add a Session is the phone's Empty Topic page: opening it is the Mac's visit to that page.
      markTopicRead(hostId, topic.id);
      router.push({ pathname: '/topic-add-session', params: { hostId, topicId: topic.id,
        seed: topicSeedParam(topic), ...(fromAttach ? { fromAttach: '1' } : {}) } });
      return;
    }
    const card = { key: topic.id, topic: true };
    const retryRead = () => run(card, (delivery) => readAndAttach(topic.id, delivery), retryRead);
    if (topic.state === 'dormant') {
      askWake(topic.label, 'This Topic remembers Sessions but has none running.', (wake) => {
        run(card, async (delivery) => {
          const { end } = await wakeOnce(hostId, (host, sending) =>
            sendCardOrder(host, { kind: 'topic', id: topic.id }, { kind: 'wake', wake }, sending));
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
    run(card, (delivery) => topic.sessions.length ? attachTopic(topic, delivery) : readAndAttach(topic.id, delivery), undefined, feedback);
  }, [hostId, router, run, attachTopic, readAndAttach, fromAttach, askWake]);

  const attachSession = useCallback(async (sessionName: string, delivery: Delivery) => {
    const place = await deviceHostStore().placeFor(hostId, { kind: 'session', session: sessionName });
    if (!delivery.isCurrent()) return;
    const attach = await deliverSession({ hostId, destination: { sessionName, topic: null, restore: place }, ...delivery });
    // A Topic held now that lists the Session keeps it, and the Session Place does not apply.
    if (delivery.isCurrent()) onAttached(attach.state().topic === null ? place?.tab ?? null : null);
  }, [hostId, deliverSession, onAttached]);

  const openSession = useCallback((sessionName: string) => {
    run(null, (delivery) => attachSession(sessionName, delivery));
  }, [run, attachSession]);

  /**
   * Opens a Board Session's card. A live one opens its Session. A Dormant one
   * asks to Reopen or Start Fresh it, and then opens the Session the Host
   * names in its answer.
   */
  const openBoardSession = useCallback((row: BoardSessionRow) => {
    const { card } = row;
    if (card.kind === 'live-session') {
      run({ key: cardKey(card), topic: false }, (delivery) => attachSession(row.name, delivery));
      return;
    }
    askWake(row.name, 'This Board Session has no live Session.', (wake) => {
      run({ key: cardKey(card), topic: false }, async (delivery) => {
        const { end, session } = await wakeOnce(hostId, (host, sending) =>
          wakeBoardSession(host, card.id, wake, newRequestId(), sending));
        if (!delivery.isCurrent()) return;
        if (session === null) {
          alertCardWrite(WAKE_LABEL[wake], end);
          return;
        }
        await attachSession(session, delivery);
      });
    });
  }, [hostId, run, attachSession, askWake]);

  return { openTopic, openSession, openBoardSession, busyCard };
}

/** One wake from a card tap, ended, with the Session the Host names when it names one. */
interface WakeEnd {
  end: HostWrite;
  session: string | null;
}

/**
 * One wake from a card tap, as a Host Write, ended. The tap has its own
 * spinner and its own one-at-a-time rule, so it moves the Host Write itself
 * rather than through a runner.
 */
async function wakeOnce(hostId: string, wake: (host: Host, sending: () => void) => Promise<TopicWrite | BoardSessionWake>): Promise<WakeEnd> {
  let write = send(IDLE, 0)!;
  try {
    const host = (await deviceHostStore().load()).hosts.find((candidate) => candidate.id === hostId);
    if (!host) return { end: ended(write, { kind: 'refused', reason: 'This Host is no longer saved.' }), session: null };
    const result = await wake(host, () => { write = reached(write, 'sending'); });
    switch (result.kind) {
      case 'changed':
        return { end: ended(write, { kind: 'done' }), session: null };
      case 'woke':
        return { end: ended(write, { kind: 'done' }), session: result.session };
      case 'failed':
        return { end: ended(write, { kind: 'refused', reason: result.error }), session: null };
      case 'unknown':
        return { end: ended(write, { kind: 'unknown', reason: result.message }), session: null };
    }
  } catch (error) {
    return { end: ended(write, endOfThrow(error)), session: null };
  }
}
