import { useCallback, useMemo } from 'react';

import { deviceHostStore } from '@/storage/device-store';
import type { RankedPaths } from '@/domain/go-to';
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

const sectionRows = (sections: GoToSection[]) => sections.reduce((count, section) => count + section.rows.length, 0);

const folderPaths = (host: Host, query: string, signal: AbortSignal) => rankedSessionPaths(host, query, appConnections(), signal);

export function useGoToPaths(hostId: string, enabled: boolean): GoToRead<SessionPathRow> {
  return useGoToList(hostId, enabled, folderPaths, (rows) => rows.length);
}

/** The folders of a Go to list, as `goToRows` takes them: the rows, and the text they answer. */
export function rankedPaths(read: GoToRead<SessionPathRow>): RankedPaths {
  return { query: read.dataKey ?? '', rows: read.data ?? [] };
}

export function useHostGoTo(
  hostId: string, enabled: boolean, session: string | undefined, tag: string | null,
): GoToRead<GoToSection> {
  const fetch = useCallback(async (host: Host, query: string, signal: AbortSignal) => {
    const answer = await appConnections().onServer(host, (server) => cancelOnAbort(server.request({
      go_to: { query, ...(session === undefined ? {} : { current_session: session }), ...(tag === null ? {} : { tag }) },
    }), signal));
    return parseGoToSections(answer);
  }, [session, tag]);
  return useGoToList(hostId, enabled, fetch, sectionRows);
}

/**
 * The list keeps its rows while the next answer of the same search is on its
 * way. `ask` changes when the question does (the Host, the Session, the Tag),
 * so a screen can ask again for the new question.
 */
function useGoToList<Row>(
  hostId: string, enabled: boolean,
  fetch: (host: Host, query: string, signal: AbortSignal) => Promise<Row[]>,
  count: (rows: Row[]) => number,
): GoToRead<Row> {
  const read = useHostRead<string, Row[]>({
    read: async (text, signal) => {
      const host = (await deviceHostStore().load()).hosts.find((entry) => entry.id === hostId);
      if (!host) throw new Error('This Host is no longer saved.');
      return fetch(host, text, signal);
    },
    debounceMs: (text) => (text === '' ? 0 : GO_TO_DEBOUNCE_MS),
    announce: (rows) => {
      const n = count(rows);
      return n === 1 ? '1 result' : `${n} results`;
    },
  });

  const { ask: askRead } = read;
  const ask = useCallback((query: string) => {
    if (enabled) askRead(query.trim());
    // `fetch` changes with the question (the Session, the Tag), and `ask` with it, so a screen can ask again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, askRead, fetch]);

  return useMemo(() => ({ ...read, ask }), [read, ask]);
}
