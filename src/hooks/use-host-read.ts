import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import {
  answered, ask, ANNOUNCE_AFTER_MS, cancel, failed, isPending, release, retry, seed, unasked,
  type HostRead, type HostReadAnswer, type HostReadError,
} from '@/domain/host-read';
import { HostProblem } from '@/ssh/failures';
import { describeConnectionFailure } from '@/tmux/disconnect-reason';

export interface HostReadOptions<K, D> {
  /**
   * Asks the Host. When `signal` aborts, it cancels its Host Server call
   * (`cancelOnAbort`), so the Host stops the work of a replaced read.
   */
  read(key: K, signal: AbortSignal): Promise<D>;
  /** How long an ask of `key` waits before the read is sent. The progress line does not wait. Try again never waits. */
  debounceMs?(key: K): number;
  /** True when `next` must wait in `held` instead of replacing `shown`, because it would move rows under the finger. */
  hold?(shown: HostReadAnswer<K, D> | null, next: HostReadAnswer<K, D>): boolean;
  /** What VoiceOver says when a slow read ends with `data`, such as "4 results". A slow failure says its reason. */
  announce?(data: D): string | null;
}

export interface HostReadHandle<K, D> {
  /** True from the render of the ask until the answer or the failure. */
  isPending: boolean;
  /** The last answer, which stays on screen through a newer ask. */
  data: D | undefined;
  /** The key that `data` answers. */
  dataKey: K | undefined;
  held: HostReadAnswer<K, D> | null;
  error: HostReadError<K> | null;
  /** Asks from the event handler of the tap or keystroke, so `isPending` is true in its render. */
  ask(key: K): void;
  /** Asks the newest key again at once. Ignored while a read runs. */
  retry(): void;
  /** Stops the read that runs, as when the screen loses the focus. */
  cancel(): void;
  /** Puts the held answer on screen. */
  release(): void;
  /** Shows an answer the phone kept, until the Host answers. */
  seed(key: K, data: D): void;
  /** Gives the answer to the newest ask when it comes, or now when nothing runs. A newer ask, a cancel or a failure drops it. */
  whenAnswered(pick: (data: D) => void): void;
}

/**
 * One Host Read that a screen owns. The hook owns the timing: the debounce,
 * the ticket of the newest ask, the request in flight, and its cancel on a
 * newer ask, a cancel or an unmount. A screen that owns two reads calls it
 * two times, and each read has its own `isPending`.
 */
export function useHostRead<K extends string | number, D>(options: HostReadOptions<K, D>): HostReadHandle<K, D> {
  const [read, setRead] = useState<HostRead<K, D>>(unasked);
  const current = useRef(read);
  const latest = useRef(options);
  const present = useRef(true);
  const inFlight = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const queued = useRef<((data: D) => void) | null>(null);

  useLayoutEffect(() => {
    latest.current = options;
  });

  const move = useCallback((next: HostRead<K, D>) => {
    if (next === current.current) return;
    current.current = next;
    if (present.current) setRead(next);
  }, []);

  const stop = useCallback(() => {
    clearTimeout(timer.current);
    inFlight.current?.abort();
    inFlight.current = null;
  }, []);

  useEffect(() => {
    present.current = true;
    return () => {
      present.current = false;
      queued.current = null;
      stop();
    };
  }, [stop]);

  const run = useCallback((delay: number) => {
    stop();
    const { ticket, pending } = current.current;
    if (pending === null) return;
    const controller = new AbortController();
    inFlight.current = controller;
    const go = async () => {
      const outcome = await latest.current.read(pending.key, controller.signal).then(
        (data) => ({ ok: true as const, data }),
        (error: unknown) => ({ ok: false as const, reason: describeConnectionFailure(error), hostProblem: error instanceof HostProblem }),
      );
      if (!present.current) return;
      const before = current.current;
      const next = outcome.ok
        ? answered(before, ticket, outcome.data, latest.current.hold?.(before.answer, { key: pending.key, data: outcome.data }) ?? false)
        : failed(before, ticket, outcome.reason, outcome.hostProblem);
      // A newer ask or a cancel replaced this one.
      if (next === before) return;
      inFlight.current = null;
      move(next);
      const pick = queued.current;
      queued.current = null;
      if (outcome.ok) pick?.(outcome.data);
      if (Date.now() - pending.since >= ANNOUNCE_AFTER_MS) {
        const words = outcome.ok ? latest.current.announce?.(outcome.data) : outcome.reason;
        if (words) AccessibilityInfo.announceForAccessibility(words);
      }
    };
    if (delay > 0) timer.current = setTimeout(() => void go(), delay);
    else void go();
  }, [move, stop]);

  const askKey = useCallback((key: K) => {
    queued.current = null;
    move(ask(current.current, key, Date.now()));
    run(latest.current.debounceMs?.(key) ?? 0);
  }, [move, run]);

  const retryKey = useCallback(() => {
    const next = retry(current.current, Date.now());
    if (next === null) return;
    move(next);
    run(0);
  }, [move, run]);

  const cancelRead = useCallback(() => {
    queued.current = null;
    stop();
    move(cancel(current.current));
  }, [move, stop]);

  const releaseHeld = useCallback(() => move(release(current.current)), [move]);

  const seedAnswer = useCallback((key: K, data: D) => move(seed(current.current, { key, data })), [move]);

  const whenAnswered = useCallback((pick: (data: D) => void) => {
    const now = current.current;
    if (now.pending !== null) {
      queued.current = pick;
      return;
    }
    const shown = now.held ?? now.answer;
    if (now.error === null && shown !== null) pick(shown.data);
  }, []);

  return useMemo(() => ({
    isPending: isPending(read),
    data: read.answer?.data,
    dataKey: read.answer?.key,
    held: read.held,
    error: read.error,
    ask: askKey,
    retry: retryKey,
    cancel: cancelRead,
    release: releaseHeld,
    seed: seedAnswer,
    whenAnswered,
  }), [read, askKey, retryKey, cancelRead, releaseHeld, seedAnswer, whenAnswered]);
}
