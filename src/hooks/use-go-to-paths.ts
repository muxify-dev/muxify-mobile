import { useCallback, useEffect, useRef, useState } from 'react';

import type { RankedPaths } from '@/domain/go-to';
import { describeConnectionFailure } from '@/tmux/disconnect-reason';
import { deviceGoToCache, deviceHostStore } from '@/storage/device-store';
import { rankedSessionPaths } from '@/topics/host-session-paths';

/** Where the read of the paths stands, for the line above the list. */
export type PathsReading = { kind: 'idle' } | { kind: 'reading' } | { kind: 'failed'; error: string };

const ASK_DEBOUNCE_MS = 150;

/**
 * The Session Paths of a Host for a Go to list, and the way to ask the Host
 * for them.
 *
 * The phone keeps the Host's last answer for an empty field, so the list is
 * there before the Host answers. `ask` asks the Host Server for the text in
 * the field (`session_paths`), and only the answer for the newest text is
 * kept, in the Host's order.
 *
 * A new answer for an empty field is not put under the user's finger: while
 * `still` is true and rows are on show, the answer waits, and it shows when
 * `still` goes false.
 */
export function useGoToPaths(hostId: string, enabled: boolean, still: boolean) {
  const [paths, setPaths] = useState<RankedPaths>({ query: '', rows: [] });
  const [reading, setReading] = useState<PathsReading>({ kind: 'idle' });
  const asked = useRef(0);
  const present = useRef(true);
  const shown = useRef(paths);
  const stillNow = useRef(still);
  const waiting = useRef<RankedPaths | null>(null);

  const show = useCallback((next: RankedPaths) => {
    shown.current = next;
    setPaths(next);
  }, []);

  useEffect(() => {
    present.current = true;
    return () => { present.current = false; };
  }, []);

  useEffect(() => {
    stillNow.current = still;
    if (!still && waiting.current) {
      show(waiting.current);
      waiting.current = null;
    }
  }, [still, show]);

  useEffect(() => {
    if (!enabled) return;
    void deviceGoToCache().load(hostId).then((rows) => {
      if (present.current && asked.current === 0 && rows.length > 0) show({ query: '', rows });
    });
  }, [hostId, enabled, show]);

  const read = useCallback(async (query: string) => {
    const turn = ++asked.current;
    const current = () => present.current && asked.current === turn;
    setReading({ kind: 'reading' });
    try {
      const host = (await deviceHostStore().load()).hosts.find((entry) => entry.id === hostId);
      if (!host) throw new Error('This Host is no longer saved.');
      const rows = await rankedSessionPaths(host, query);
      if (query === '') void deviceGoToCache().save(hostId, rows);
      if (!current()) return;
      const next = { query, rows };
      if (query === '' && stillNow.current && shown.current.rows.length > 0) waiting.current = next;
      else show(next);
      setReading({ kind: 'idle' });
    } catch (error) {
      if (current()) setReading({ kind: 'failed', error: describeConnectionFailure(error) });
    }
  }, [hostId, show]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  /** Reads the Host for this text, after the field has been still for a moment. Text typed in between is not asked. */
  const ask = useCallback((query: string) => {
    if (!enabled) return;
    if (timer.current) clearTimeout(timer.current);
    const text = query.trim();
    if (text === '') {
      void read('');
      return;
    }
    timer.current = setTimeout(() => void read(text), ASK_DEBOUNCE_MS);
  }, [enabled, read]);

  return { paths, reading, ask };
}
