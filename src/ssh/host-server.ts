import { systemClock, type Clock } from '@/lib/clock';
import { describeError } from '@/lib/describe-error';
import { shellQuote } from '@/tmux/commands';
import type { HostCliInstall } from '@/topics/host-cli-install';

import {
  channelEnded,
  describeEnd,
  HostServerError,
  openHostServerSession,
  type HostServerCall,
  type HostServerSession,
  type OldSide,
  type OpenServerChannel,
  type SessionEnd,
} from './host-server-channel';

export { HostServerError, type HostServerCall, type OldSide, type OpenServerChannel } from './host-server-channel';

/** What the phone uses of the Host Server. A server whose `hello` lacks one is too old. */
export const PHONE_CAPABILITIES = ['request', 'snapshot', 'topic-detail', 'ranked-session-paths', 'browser-tabs', 'board'] as const;

/** A server that stops this many times… */
export const MAX_STOPS = 3;
/** …within this long leaves the Connection in Sessions only. */
export const STOP_WINDOW_MS = 60_000;

/** `muxify` exits 2 on a usage error: a Host CLI with no `server` verb. */
const USAGE_ERROR = 2;
/** The shell's "command not found": the probed `muxify` is gone. */
const NOT_FOUND = 127;

/** Where the link stands. */
export type HostServerState =
  /** Finding `muxify`, or waiting for the server's `hello`. */
  | { kind: 'starting' }
  /** No `muxify` on the Host yet: it waits for the Host CLI install. */
  | { kind: 'installing' }
  /** The server answered with every capability the phone uses, on `protocol`, the one both sides speak. */
  | { kind: 'live'; build: string; protocol: number }
  /** No Host Server for the rest of this Connection. */
  | ({ kind: 'sessions-only' } & Unavailable)
  /** Its Connection closed. */
  | { kind: 'closed' };

/**
 * Why no Host Server runs: `reason`, which the Host Screen shows as "Topics
 * are unavailable on <Host>: <reason>", and `tooOld`, the side too old for the
 * other when that is why.
 */
export interface Unavailable {
  reason: string;
  tooOld?: OldSide;
}

/** Why no Host Server runs, in the Mac's words, or the phone's own when the phone is too old. */
export const unavailable = {
  notInstalled: (line: string): Unavailable => ({ reason: `the Host CLI could not be installed (${line})` }),
  tooOld: (side: OldSide, build: string): Unavailable => ({
    reason:
      side === 'phone'
        ? `Muxify Mobile is too old for the Host's muxify (${build}). Update the app.`
        : `the Host's muxify is too old (${build})`,
    tooOld: side,
  }),
  noAnswer: (): Unavailable => ({ reason: 'the Host Server did not answer' }),
  stoppedRepeatedly: (line: string): Unavailable => ({
    reason: `the Host Server stopped ${MAX_STOPS} times in a minute (${line})`,
  }),
};

/**
 * The Host Server of one Connection, for every Host read and write of the
 * phone. See ADR 0025.
 */
export interface HostServer {
  state(): HostServerState;
  /** Hears every change of `state()`. Answers the way to stop hearing. */
  onState(listener: (state: HostServerState) => void): () => void;
  /**
   * One request, `{ <case>: payload }`. It resolves with the `ok` of its
   * `end`, or rejects with a `HostServerError` `{code, message, topic_failure?}`.
   * It waits while the server starts, and fails with `unavailable` when the
   * channel ends first or the link is in Sessions only. It has no timeout of
   * its own: the ping, the Connection's keepalive and the channel's end decide.
   */
  request(payload: object): HostServerCall<unknown>;
  /**
   * A subscription, `{ subscribe: payload }`. `onItem` hears its items, the
   * first holding the whole state, until it ends, as `request` does.
   */
  subscribe(payload: object, onItem: (item: unknown) => void): HostServerCall<unknown>;
  /** The Host CLI install of this Connection answered. */
  installAnswered(result: HostCliInstall): void;
  /** Its Connection closed: the channel ends, and every waiting request fails. */
  close(): void;
}

export interface HostServerOptions {
  open: OpenServerChannel;
  /** The path of `muxify` the probe finds, or null when the Host has none. */
  locate(): Promise<string | null>;
  /** Forgets the probed path, so the next `locate` probes again. */
  forget(): void;
  /** `'<muxify>' --version`'s line, or '' when it prints none. */
  version(path: string): Promise<string>;
  /** Whether the Connection still lives: a channel that ends with it is no stop. */
  connected(): boolean;
  /** The phone's build line, for its `hello`. */
  build: string;
  clock?: Clock;
  /** One line of the Log, about this Connection's Host Server. */
  say?: (line: string) => void;
}

interface Queued {
  payload: object;
  onItem?: (item: unknown) => void;
  resolve(value: unknown): void;
  reject(error: unknown): void;
  forwarded?: HostServerCall<unknown>;
}

/**
 * Starts the Host Server of one Connection at once with the `muxify` the
 * probe finds, and keeps one running for the Connection's life:
 *
 * - With no `muxify`, it waits for the install. An install that answers
 *   `installed` or `updated` sends `shutdown` to a running server, forgets the
 *   probed path and starts once more on the new binary.
 * - A server that stops while the Connection lives is started again. After 3
 *   stops within 60 s, or with no `hello` in 10 s, no shared protocol, a
 *   missing capability or a `muxify` with no `server` verb, the link stays in
 *   Sessions only. Nothing retries in the background: the next Connection
 *   tries again.
 */
export function createHostServer(options: HostServerOptions): HostServer {
  const clock = options.clock ?? systemClock;
  const say = options.say ?? (() => {});
  const listeners = new Set<(state: HostServerState) => void>();
  const queue: Queued[] = [];
  let current: HostServerState = { kind: 'starting' };
  let session: HostServerSession | null = null;
  /** Bumps on each start, so a start that a newer one replaced does nothing. */
  let generation = 0;
  let stops: number[] = [];
  let installed: HostCliInstall | null = null;
  let lastBuild: string | null = null;

  function become(next: HostServerState): void {
    current = next;
    for (const listener of [...listeners]) listener(next);
  }

  function failQueued(): void {
    for (const entry of queue.splice(0)) entry.reject(channelEnded());
  }

  /** Ends a session on purpose: nothing after it counts as a stop. */
  function retire(): void {
    const old = session;
    session = null;
    old?.close();
  }

  function sessionsOnly(why: Unavailable): void {
    generation += 1;
    retire();
    say(`Sessions only: ${why.reason}`);
    become({ kind: 'sessions-only', ...why });
    failQueued();
  }

  function forward(entry: Queued, to: HostServerSession): void {
    entry.forwarded = to.request(entry.payload, entry.onItem);
    entry.forwarded.then(entry.resolve, entry.reject);
  }

  async function start(): Promise<void> {
    generation += 1;
    const mine = generation;
    become({ kind: 'starting' });
    let path: string | null;
    try {
      path = await options.locate();
    } catch (error) {
      if (mine !== generation) return;
      stopped(describeError(error));
      return;
    }
    if (mine !== generation) return;
    if (path === null) {
      if (installed) sessionsOnly(unavailable.notInstalled(installed.line));
      else become({ kind: 'installing' });
      return;
    }
    const opened = openHostServerSession({
      open: options.open,
      command: `${shellQuote(path)} server`,
      build: options.build,
      capabilities: PHONE_CAPABILITIES,
      clock,
    });
    session = opened;
    const muxify = path;
    opened.hello.then(
      (hello) => {
        if (session !== opened) return;
        const missing = PHONE_CAPABILITIES.filter((name) => !hello.capabilities.includes(name));
        if (missing.length > 0) {
          say(`${hello.build} lacks the capabilities ${missing.join(', ')}`);
          sessionsOnly(unavailable.tooOld('host', hello.build));
          return;
        }
        if (hello.build !== lastBuild) say(`${hello.build}, protocol ${hello.protocol}`);
        lastBuild = hello.build;
        become({ kind: 'live', build: hello.build, protocol: hello.protocol });
        for (const entry of queue.splice(0)) forward(entry, opened);
      },
      () => {},
    );
    void opened.ended.then((end) => ended(opened, end, muxify));
  }

  async function ended(which: HostServerSession, end: SessionEnd, path: string): Promise<void> {
    if (session !== which) return;
    session = null;
    const lines = which.stderr();
    const last = lines[lines.length - 1] ?? '';
    say(`the channel failed: ${describeEnd(end)}; last stderr line: "${last}"`);
    failQueued();
    if (current.kind === 'closed' || !options.connected()) return;
    const mine = generation;
    if (!end.answered) {
      if (end.exitCode === USAGE_ERROR) {
        const build = await options.version(path).catch(() => '');
        if (mine !== generation) return;
        sessionsOnly(unavailable.tooOld('host', build || 'it prints no build line'));
        return;
      }
      if (end.exitCode === NOT_FOUND) {
        sessionsOnly(unavailable.notInstalled(installed?.line ?? 'no muxify was found'));
        return;
      }
      if (end.cause.kind === 'no-hello') {
        sessionsOnly(unavailable.noAnswer());
        return;
      }
      if (end.cause.kind === 'no-shared-protocol') {
        sessionsOnly(unavailable.tooOld(end.cause.tooOld, end.cause.build));
        return;
      }
    }
    stopped(last || describeEnd(end));
  }

  /** The server stopped while the Connection lives: it starts again, unless it keeps stopping. */
  function stopped(line: string): void {
    const now = clock.now();
    stops = [...stops.filter((at) => now - at < STOP_WINDOW_MS), now];
    if (stops.length >= MAX_STOPS) {
      sessionsOnly(unavailable.stoppedRepeatedly(line));
      return;
    }
    void start();
  }

  function enqueue(payload: object, onItem?: (item: unknown) => void): HostServerCall<unknown> {
    let entry!: Queued;
    const promise = new Promise<unknown>((resolve, reject) => {
      entry = { payload, onItem, resolve, reject };
    });
    if (current.kind === 'sessions-only' || current.kind === 'closed') entry.reject(channelEnded());
    else if (current.kind === 'live' && session) forward(entry, session);
    else queue.push(entry);
    return Object.assign(promise, {
      cancel() {
        if (entry.forwarded) {
          entry.forwarded.cancel();
          return;
        }
        const at = queue.indexOf(entry);
        if (at < 0) return;
        queue.splice(at, 1);
        entry.reject(new HostServerError('cancelled', 'cancelled before it was sent'));
      },
    });
  }

  void start();

  return {
    state: () => current,

    onState(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    request: (payload) => enqueue(payload),

    subscribe: (payload, onItem) => enqueue({ subscribe: payload }, onItem),

    installAnswered(result) {
      installed = result;
      if (current.kind === 'closed') return;
      if (result.kind === 'installed' || result.kind === 'updated') {
        const old = session;
        session = null;
        if (old) {
          const shutdown = old.request({ shutdown: {} });
          void shutdown.then(
            () => old.close(),
            () => old.close(),
          );
        }
        options.forget();
        stops = [];
        void start();
        return;
      }
      if (current.kind === 'installing') sessionsOnly(unavailable.notInstalled(result.line));
    },

    close() {
      if (current.kind === 'closed') return;
      generation += 1;
      retire();
      become({ kind: 'closed' });
      failQueued();
    },
  };
}
