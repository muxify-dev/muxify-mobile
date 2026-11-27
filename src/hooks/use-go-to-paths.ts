import { useCallback, useEffect, useMemo } from 'react';

import { deviceGoToCache, deviceHostStore, deviceRankedGoToCache } from '@/storage/device-store';
import type { RankedPaths } from '@/domain/go-to';
import type { GoToCache } from '@/storage/go-to-cache';
import type { Host } from '@/storage/records';
import { cancelOnAbort } from '@/ssh/host-server-channel';
import { appConnections } from '@/tmux/ssh-connection';
import { parseGoToSections, type GoToSection } from '@/topics/go-to-answer';
import { rankedSessionPaths } from '@/topics/host-session-paths';
import type { SessionPathRow } from '@/topics/session-paths';

import { useHostRead, type HostReadHandle } from './use-host-read';

/** One Go to list: a Host Read keyed by the trimmed text of the field. */
export type GoToRead<Row> = HostReadHandle<string, Row[]>;

/** The wait after a keystroke before the Host is asked. An empty field is asked at once. */
export const GO_TO_DEBOUNCE_MS = 150;

const folderKeys = (rows: SessionPathRow[]) => rows.map((row) => row.directory);
const sectionKeys = (sections: GoToSection[]) => sections.flatMap((section) => [
  section.id, ...section.rows.map((row) => row.id),
]);
const sectionRows = (sections: GoToSection[]) => sections.reduce((count, section) => count + section.rows.length, 0);

const folderPaths = (host: Host, query: string, signal: AbortSignal) => rankedSessionPaths(host, query, appConnections(), signal);

export function useGoToPaths(hostId: string, enabled: boolean, still: boolean): GoToRead<SessionPathRow> {
  return useGoToList(hostId, enabled, still, folderPaths, deviceGoToCache, folderKeys, (rows) => rows.length, true);
}

/** The folders of a Go to list, as `goToRows` takes them: the rows, and the text they answer. */
export function rankedPaths(read: GoToRead<SessionPathRow>): RankedPaths {
  return { query: read.dataKey ?? '', rows: read.data ?? [] };
}

export function useHostGoTo(
  hostId: string, enabled: boolean, still: boolean, session: string | undefined, tag: string | null,
): GoToRead<GoToSection> {
  const fetch = useCallback(async (host: Host, query: string, signal: AbortSignal) => {
    const answer = await appConnections().onServer(host, (server) => cancelOnAbort(server.request({
      go_to: { query, ...(session === undefined ? {} : { current_session: session }), ...(tag === null ? {} : { tag }) },
    }), signal));
    return parseGoToSections(answer);
  }, [session, tag]);
  return useGoToList(hostId, enabled, still, fetch, deviceRankedGoToCache, sectionKeys, sectionRows, tag === null);
}

/**
 * The list keeps its rows while the next answer is on its way. An
 * empty-field answer that would move rows on screen waits in `held` while
 * the field is still, until the user types or the field stops being still.
 * `ask` changes when the question does (the Host, the Session, the Tag), so
 * a screen that asks on focus asks again for the new question.
 */
function useGoToList<Row>(
  hostId: string, enabled: boolean, still: boolean,
  fetch: (host: Host, query: string, signal: AbortSignal) => Promise<Row[]>,
  cache: () => GoToCache<Row>, keys: (rows: Row[]) => string[], count: (rows: Row[]) => number, unfiltered: boolean,
): GoToRead<Row> {
  const read = useHostRead<string, Row[]>({
    read: async (text, signal) => {
      const host = (await deviceHostStore().load()).hosts.find((entry) => entry.id === hostId);
      if (!host) throw new Error('This Host is no longer saved.');
      const rows = await fetch(host, text, signal);
      if (text === '' && unfiltered) void cache().save(hostId, rows).catch(() => {});
      return rows;
    },
    debounceMs: (text) => (text === '' ? 0 : GO_TO_DEBOUNCE_MS),
    hold: (shown, next) => {
      if (!still || !unfiltered || next.key !== '' || shown?.key !== '') return false;
      const old = keys(shown.data);
      const fresh = keys(next.data);
      return old.length > 0 && (old.length !== fresh.length || old.some((key, i) => key !== fresh[i]));
    },
    announce: (rows) => {
      const n = count(rows);
      return n === 1 ? '1 result' : `${n} results`;
    },
  });

  const { seed, release, ask: askRead } = read;
  useEffect(() => {
    if (!enabled || !unfiltered) return;
    let active = true;
    void cache().load(hostId).then((rows) => {
      if (active && rows.length) seed('', rows);
    });
    return () => { active = false; };
  }, [hostId, enabled, unfiltered, cache, seed]);

  useEffect(() => {
    if (!still) release();
  }, [still, release]);

  const ask = useCallback((query: string) => {
    if (enabled) askRead(query.trim());
    // `fetch` changes with the question (the Session, the Tag), and `ask` with it, so a screen that asks on focus asks again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, askRead, fetch]);

  return useMemo(() => ({ ...read, ask }), [read, ask]);
}
