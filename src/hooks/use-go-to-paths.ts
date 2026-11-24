import { useCallback, useEffect, useRef, useState } from 'react';

import { deviceGoToCache, deviceHostStore, deviceRankedGoToCache } from '@/storage/device-store';
import type { GoToCache } from '@/storage/go-to-cache';
import type { Host } from '@/storage/records';
import { describeConnectionFailure } from '@/tmux/disconnect-reason';
import { appConnections } from '@/tmux/ssh-connection';
import { parseGoToSections, type GoToSection } from '@/topics/go-to-answer';
import { rankedSessionPaths } from '@/topics/host-session-paths';
import type { SessionPathRow } from '@/topics/session-paths';

export type PathsReading =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | { kind: 'waiting' }
  | { kind: 'failed'; error: string };

const folderKeys = (rows: SessionPathRow[]) => rows.map((row) => row.directory);
const sectionKeys = (sections: GoToSection[]) => sections.flatMap((section) => [
  section.id, ...section.rows.map((row) => row.id),
]);

export function useGoToPaths(hostId: string, enabled: boolean, still: boolean) {
  const { list, reading, ask } = useGoToList(hostId, enabled, still, rankedSessionPaths, deviceGoToCache, folderKeys, true);
  return { paths: list, reading, ask };
}

export function useHostGoTo(hostId: string, enabled: boolean, still: boolean, session: string | undefined, tag: string | null) {
  const fetch = useCallback(async (host: Host, query: string) => {
    const answer = await appConnections().onServer(host, (server) => server.request({
      go_to: { query, ...(session === undefined ? {} : { current_session: session }), ...(tag === null ? {} : { tag }) },
    }));
    return parseGoToSections(answer);
  }, [session, tag]);
  return useGoToList(hostId, enabled, still, fetch, deviceRankedGoToCache, sectionKeys, tag === null);
}

/** An empty-field answer that would move visible rows waits until the user types or leaves. */
function useGoToList<Row>(
  hostId: string, enabled: boolean, still: boolean, fetch: (host: Host, query: string) => Promise<Row[]>,
  cache: () => GoToCache<Row>, keys: (rows: Row[]) => string[], unfiltered: boolean,
) {
  type List = { query: string; rows: Row[] };
  const [list, setList] = useState<List>({ query: '', rows: [] });
  const [reading, setReading] = useState<PathsReading>({ kind: 'idle' });
  const scope = JSON.stringify([hostId, enabled, unfiltered]);
  const [lastScope, setLastScope] = useState(scope);
  if (lastScope !== scope) {
    setLastScope(scope);
    setList({ query: '', rows: [] });
    setReading({ kind: 'idle' });
  }
  const asked = useRef<symbol | null>(null);
  const shown = useRef(list);
  const mayShowCache = useRef(false);
  const waiting = useRef<List | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stillNow = useRef(still);
  const show = useCallback((next: List) => {
    shown.current = next;
    setList(next);
  }, []);

  useEffect(() => {
    stillNow.current = still;
    if (!still && waiting.current) {
      show(waiting.current);
      waiting.current = null;
      setReading({ kind: 'idle' });
    }
  }, [still, show]);

  useEffect(() => {
    let active = true;
    mayShowCache.current = true;
    shown.current = { query: '', rows: [] };
    waiting.current = null;
    if (enabled && unfiltered) {
      void cache().load(hostId).then((rows) => {
        if (active && mayShowCache.current && rows.length) show({ query: '', rows });
      });
    }
    return () => {
      active = false;
      asked.current = null;
      clearTimeout(timer.current);
    };
  }, [hostId, enabled, unfiltered, cache, show]);

  const ask = useCallback((query: string) => {
    if (!enabled) return;
    clearTimeout(timer.current);
    const turn = Symbol();
    asked.current = turn;
    const text = query.trim();
    if (text !== '') mayShowCache.current = false;
    waiting.current = null;
    setReading({ kind: 'reading' });
    async function read() {
      try {
        const host = (await deviceHostStore().load()).hosts.find((entry) => entry.id === hostId);
        if (!host) throw new Error('This Host is no longer saved.');
        const rows = await fetch(host, text);
        if (asked.current !== turn) return;
        mayShowCache.current = false;
        const next = { query: text, rows };
        if (text === '' && unfiltered) {
          void cache().save(hostId, rows).catch(() => {});
          const old = keys(shown.current.rows);
          const fresh = keys(rows);
          if (stillNow.current && shown.current.query === '' && old.length && (old.length !== fresh.length || old.some((key, i) => key !== fresh[i]))) {
            waiting.current = next;
            setReading({ kind: 'waiting' });
            return;
          }
        }
        show(next);
        setReading({ kind: 'idle' });
      } catch (error) {
        if (asked.current === turn) setReading({ kind: 'failed', error: describeConnectionFailure(error) });
      }
    }
    if (text === '') void read();
    else timer.current = setTimeout(() => void read(), 150);
  }, [enabled, hostId, fetch, unfiltered, cache, keys, show]);

  return { list, reading, ask };
}
