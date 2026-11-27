import { channelEnded, HostServerError } from '@/ssh/host-server-channel';
import type { HostServer } from '@/ssh/host-server';

/** One `environment` request as the Host Server got it. */
export interface SentWrite {
  command: Record<string, unknown>;
  target?: unknown;
  request: string;
  version: number;
}

/**
 * A live Host Server for screen tests. Each request is kept and answered by
 * `answer`, which a test sets: what it returns is the `ok` of the `end`, and
 * what it throws ends the request with that error. A request whose case is in
 * `on` (`session_paths`, `visit_session_path`, `browser_tabs`, `upload`) is answered there instead, with
 * the case's own payload. A subscription's first item is what `pushes` holds
 * for its kind (`snapshot`, `topic`).
 *
 * `onServer` is the part of the Connections that the Host Writes use.
 * `cancelled` holds each request whose call was cancelled, in that order.
 */
export function fakeHostServer() {
  const requests: object[] = [];
  const cancelled: object[] = [];
  const pushes: Record<string, unknown> = {};
  const on: Record<string, (value: unknown) => unknown> = {};
  const fake = {
    requests,
    cancelled,
    pushes,
    on,
    answer: ((): unknown => ({ changed: {} })) as (payload: Record<string, unknown>) => unknown,
    server: null as unknown as HostServer,
    onServer: <T,>(_host: unknown, work: (server: HostServer) => Promise<T>) => work(fake.server),
    /** The `environment` requests, in the order they went out. */
    writes: (): SentWrite[] =>
      requests.flatMap((payload) => ('environment' in payload ? [(payload as { environment: SentWrite }).environment] : [])),
  };
  fake.server = {
    state: () => ({ kind: 'live', build: 'muxify test', protocol: 1 }),
    onState: () => () => {},
    request: (payload) => {
      requests.push(payload);
      const [kind] = Object.keys(payload);
      const each = kind === undefined ? undefined : on[kind];
      const promise = Promise.resolve().then(() =>
        each ? each((payload as Record<string, unknown>)[kind!]) : fake.answer(payload as Record<string, unknown>));
      return Object.assign(promise, { cancel: () => { cancelled.push(payload); } });
    },
    subscribe: (payload, onItem) => {
      const [kind] = Object.keys(payload);
      let cancel = () => {};
      const promise = new Promise<unknown>((_resolve, reject) => {
        let cancelled = false;
        cancel = () => {
          cancelled = true;
          reject(new HostServerError('cancelled', 'cancelled'));
        };
        void Promise.resolve().then(() => {
          if (cancelled) return;
          if (kind !== undefined && kind in pushes) onItem(pushes[kind]);
          else reject(new HostServerError('unsupported', `no push of ${kind} in this test`));
        });
      });
      return Object.assign(promise, { cancel: () => cancel() });
    },
    installAnswered: () => {},
    tryAgain: () => {},
    close: () => {},
  };
  return fake;
}

/** What a Host Server that stops before it answers ends a request with. */
export const lost = () => channelEnded();

/** The `failed` end of a refusal, with its `topic_failure`. */
export function refused(message: string, kind = 'tag_undefined'): HostServerError {
  return new HostServerError('failed', message, { kind, message, phase: 'nothing_changed' });
}

/** The `failed` end of a Request that the Host has in doubt. */
export function inDoubt(message: string): HostServerError {
  return new HostServerError('failed', message, { kind: 'request_in_doubt', message, phase: 'record_saved' });
}

/**
 * A `snapshot` push, as the Host Server sends it: these Topics on the Bench,
 * and these Sessions, each in the Topic it names.
 */
export function snapshotPush(options: {
  topics?: { id: string; label: string; state?: string }[];
  sessions?: { id: string; name: string; topic?: string }[];
} = {}): object {
  const sessions = options.sessions ?? [];
  return {
    no_topic: sessions.filter((session) => !session.topic).map((session) => session.id),
    pinned: [],
    sessions: sessions.map((session) => ({
      activity: 1763100000, id: session.id, mark: null, name: session.name, topic: session.topic ?? null,
      windows: [{ active: true, id: '@1', index: 0, mark: null, name: 'shell' }],
    })),
    sidebar: { sessions: true, topics: true },
    tags: [],
    unpinned: {
      kind: 'in_play', limit: 3, places: [], guests: [],
      bench: (options.topics ?? []).map((topic) => ({
        kind: 'topic', mark: null,
        sessions: sessions.filter((session) => session.topic === topic.id).map((session) => session.id),
        topic: { id: topic.id, label: topic.label, note: null, state: topic.state ?? 'empty', tags: [] },
      })),
    },
  };
}

/** A `topic` push: the Topic with these Sessions, each with one Window. */
export function topicPush(id: string, label: string, sessions: { id: string; name: string }[] = []): object {
  return { topic: {
    created_at: null, id, label, note: null, slug: label.toLowerCase(), state: sessions.length > 0 ? 'live' : 'empty', tags: [], title: label,
    sessions: sessions.map((session) => ({
      base_name: session.name, directory: '/work', id: session.id, name: session.name, worktree: null,
      windows: [{ active: true, id: '@1', index: 0, mark: null, name: 'shell', panes: [] }],
    })),
  } };
}
