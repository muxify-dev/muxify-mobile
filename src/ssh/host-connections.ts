import { attachmentUpload } from '@/composer/host-upload';
import { silentLog, speakingAs, type Log } from '@/diagnostics/log';
import { systemClock, type Clock, type Timer } from '@/lib/clock';
import { HostProblem } from '@/ssh/failures';
import type { KeyVerdict } from '@/ssh/host-key';
import { followListing, type ListingFeed, type LiveListing } from '@/ssh/host-listing-feed';
import { createHostServer, type HostServer, type OpenServerChannel } from '@/ssh/host-server';
import type { Host } from '@/storage/records';
import type { HostStore } from '@/storage/store';
import type { ConnectStep, HostConnection, LifecyclePhase, OpenConnection } from '@/tmux/attach';
import { shellQuote } from '@/tmux/commands';
import { reasonForConnectFailure, type DisconnectReason } from '@/tmux/disconnect-reason';
import type { TmuxTransport } from '@/tmux/transport';
import {
  installHostCli,
  type HostCliInstall,
  type HostCliState,
  type OpenCommandChannel,
} from '@/topics/host-cli-install';
import { topicsUnavailable } from '@/topics/host-topics';
import { createMuxifyPath, type MuxifyPath } from '@/topics/muxify-path';
import { WriteOutcomeUnknown } from '@/topics/request';

/** How long a Connection with no Attach stays open after its last screen read. */
export const IDLE_MS = 60_000;
/** How long one screen exec may take before its Connection is suspect. */
export const EXEC_DEADLINE_MS = 8_000;

/** How the Log names each connect step a dial reports. */
const STEP_WORDS: Record<ConnectStep, string> = {
  connecting: 'connecting',
  'checking-host-key': 'checking the Host key',
  'signing-in': 'signing in',
  attaching: 'attaching',
};

/** A new SSH Connection to a Host, as the registry needs it. */
export interface Dialed {
  transport: TmuxTransport;
  upload?: HostConnection['upload'];
  /** Opens a non-PTY channel for one command, outside the screen exec and its deadline. */
  openChannel?: OpenCommandChannel;
  /** Opens a non-PTY channel whose stderr stays apart from its stdout: the Host Server's. */
  openServerChannel?: OpenServerChannel;
  fingerprint: string;
  verdict: KeyVerdict;
  isConnected(): boolean;
  disconnect(): Promise<void>;
}

/**
 * Opens a new SSH Connection. `dropped` is called when the library finds the
 * Connection dead, which its keepalive does when the Host stops answering.
 * `progress` hears each SSH step as it starts.
 */
export type Dial = (host: Host, dropped: () => void, progress?: (step: ConnectStep) => void) => Promise<Dialed>;

/**
 * What a screen does with a Connection's commands: tmux's own, as Sessions
 * only and the Session form read and write them. Topics go on the Host Server.
 */
export type ScreenUse<T> = (transport: TmuxTransport) => Promise<T>;

export interface ScreenOptions {
  /**
   * Asked before the Connection is used, with the verdict of its Host key.
   * False closes the Connection and fails with HOST_KEY_REJECTED.
   */
  onHostKey?: (verdict: KeyVerdict, fingerprint: string) => boolean;
}

export interface HostConnections {
  /** The Attach's way to a Connection: the seam it already takes. */
  openConnection: OpenConnection;
  /**
   * A screen's read. When the Connection fails it, the read is sent one more
   * time, on a Connection that works.
   */
  read<T>(host: Host, use: ScreenUse<T>, options?: ScreenOptions): Promise<T>;
  /**
   * A screen's write. When it goes out and no answer comes back, it fails with
   * `WriteOutcomeUnknown`: it may have reached the Host, so it is not sent
   * again. A failure with another error means that nothing reached the Host.
   */
  write<T>(host: Host, use: ScreenUse<T>, options?: ScreenOptions): Promise<T>;
  /** React Native's app-state, forwarded as a fact. */
  lifecycleChanged(phase: LifecyclePhase): void;
  /**
   * The Host CLI install of the Host's latest Connection: not started, running,
   * or what it answered. The answer stays after its Connection closes, until a
   * new Connection installs again.
   */
  hostCli(hostId: string): HostCliState;
  /** Hears every change of a Host's install. Answers the way to stop hearing. */
  subscribeHostCli(listener: (hostId: string, state: HostCliState) => void): () => void;
  /** The Host Server of the Host's open Connection, or null when none runs. */
  hostServer(hostId: string): HostServer | null;
  /**
   * Runs `work` on the Host Server of the Host's Connection, opening one when
   * none is open, and holds the Connection while it runs. A Host Server that
   * starts again on the Connection takes the requests that wait for it. With
   * no Host Server, as in Sessions only, it fails with the reason before `work`
   * runs, so nothing reached the Host.
   */
  onServer<T>(host: Host, work: (server: HostServer) => Promise<T>, options?: ScreenOptions): Promise<T>;
  /**
   * What the Host Server of the Host's latest Connection says: where it
   * stands, and the latest Listing it pushed. It stays after its Connection
   * closes, with the server `closed`, until a new Connection starts one. Null
   * before the Host has had a Host Server.
   */
  listing(hostId: string): LiveListing | null;
  /** Hears every change of a Host's `listing`. Answers the way to stop hearing. */
  subscribeListing(listener: (hostId: string) => void): () => void;
  /**
   * A screen that shows the Host holds its Connection, opening one when none
   * is open, until it calls what this answers. The Connection does not close
   * for idle while it is held, and its idle minute starts when it is let go.
   * Unlike an Attach, a hold does not keep the Connection over a return from
   * the background.
   */
  hold(host: Host, options?: ScreenOptions): Promise<() => void>;
  /**
   * The Host Problem: why the last try to use the Host could not, or null.
   * Any use that reaches the Host clears it.
   */
  problem(hostId: string): DisconnectReason | null;
  /** Hears every change of a Host's Host Problem. Answers the way to stop hearing. */
  subscribeProblem(listener: (hostId: string) => void): () => void;
}

/** An exec that passed its deadline. Its Connection is suspect. */
export class ExecDeadlineError extends Error {
  constructor() {
    super('The Host did not answer in time.');
    this.name = 'ExecDeadlineError';
  }
}

interface Entry {
  host: Host;
  dialed: Promise<Dialed>;
  /** Where `muxify` is on the Host, which the Host Server runs. */
  muxify: MuxifyPath;
  /** The Host CLI install on this Connection, once it has started. It never rejects. */
  install: Promise<HostCliInstall> | null;
  /** The Host Server of this Connection, once it has started. */
  server: HostServer | null;
  /** Attaches that hold it. */
  attaches: number;
  /** Screen reads and writes in flight on it, and the screens that hold it. */
  uses: number;
  idle: Timer | null;
  /** What the Attaches on it run when a screen exec passes its deadline. */
  suspects: Set<() => void>;
  gone: boolean;
}

/**
 * The app's SSH Connections: at most one per Host, shared by the Attach and
 * the screens. See ADR 0012.
 *
 * A Connection opens on the first request for its Host. It closes when no
 * Attach holds it and no screen has used it for IDLE_MS, when the library's
 * keepalive finds it dead, when a screen exec passes EXEC_DEADLINE_MS with no
 * Attach on it, and when the app comes back from the background with no
 * Attach on it. The Attach decides about a Connection it holds.
 */
export function createHostConnections(options: {
  dial: Dial;
  store: Pick<HostStore, 'rememberFingerprint'>;
  clock?: Clock;
  log?: Log;
  /** The phone's build line, which its Host Server `hello` carries. */
  build?: string;
}): HostConnections {
  const { dial, store } = options;
  const clock = options.clock ?? systemClock;
  const log = options.log ?? silentLog;
  const say = speakingAs(log, 'connections');
  const entries = new Map<string, Entry>();
  /** Each Host's latest install, and the Connection it runs on. */
  const installs = new Map<string, { entry: Entry; state: HostCliState }>();
  const hostCliListeners = new Set<(hostId: string, state: HostCliState) => void>();
  /** Each Host's latest Listing feed, and the Connection whose Host Server it follows. */
  const feeds = new Map<string, { entry: Entry; feed: ListingFeed }>();
  const listingListeners = new Set<(hostId: string) => void>();
  /** One value, so a reader that compares snapshots sees no change. */
  const NOT_STARTED: HostCliState = { kind: 'idle' };
  const problems = new Map<string, DisconnectReason>();
  const problemListeners = new Set<(hostId: string) => void>();
  let backgrounded = false;

  function open(host: Host, progress?: (step: ConnectStep) => void): Entry {
    say(`${host.displayName}: connecting to ${host.address}:${host.port}`);
    let self: Entry | undefined;
    const dialed = (async () => {
      const started = clock.now();
      let reached: ConnectStep = 'connecting';
      let opened: Dialed;
      try {
        opened = await dial(host, () => {
          if (self) void drop(self, 'the keepalive found it dead');
        }, (step) => {
          reached = step;
          if (step !== 'connecting') say(`${host.displayName}: ${STEP_WORDS[step]}`);
          progress?.(step);
        });
      } catch (error) {
        const seconds = ((clock.now() - started) / 1000).toFixed(1);
        say(
          `${host.displayName}: the dial failed after ${seconds} s at ${STEP_WORDS[reached]}: ` +
            reasonForConnectFailure(error).detail,
        );
        throw error;
      }
      if (opened.verdict.kind === 'first-sight') {
        await store.rememberFingerprint(host.id, opened.fingerprint);
      }
      say(`${host.displayName}: open; Host key ${opened.verdict.kind}`);
      return opened;
    })();
    const entry: Entry = {
      host,
      dialed,
      muxify: createMuxifyPath((line) => say(`${host.displayName}: ${line}`)),
      install: null,
      server: null,
      attaches: 0,
      uses: 0,
      idle: null,
      suspects: new Set(),
      gone: false,
    };
    self = entry;
    entry.dialed.then(
      (opened) => {
        // A changed Host key waits for a screen to accept it: see acquireForScreen().
        if (opened.verdict.kind !== 'changed') begin(entry, opened);
      },
      () => {
        entry.gone = true;
        if (entries.get(host.id) === entry) entries.delete(host.id);
      },
    );
    entries.set(host.id, entry);
    return entry;
  }

  /**
   * Records or clears the Host Problem of `host`. Every use of a Connection
   * ends here, so each screen reads one account of the Host, and not one per
   * reader that met the same fault.
   */
  function setProblem(host: Host, reason: DisconnectReason | null): void {
    const held = problems.get(host.id) ?? null;
    if (held === reason || (held && reason && held.kind === reason.kind && held.detail === reason.detail)) return;
    if (reason) problems.set(host.id, reason);
    else problems.delete(host.id);
    say(`${host.displayName}: ${reason ? `Host Problem: ${reason.kind}: ${reason.detail}` : 'Host Problem cleared'}`);
    for (const listener of [...problemListeners]) listener(host.id);
  }

  /** Records `error` as the Host Problem, and answers the error a use throws for it. */
  function unusable(host: Host, error: unknown): HostProblem {
    const problem = new HostProblem(reasonForConnectFailure(error));
    setProblem(host, problem.reason);
    return problem;
  }

  function publish(entry: Entry, state: HostCliState): void {
    const hostId = entry.host.id;
    const latest = installs.get(hostId);
    // An install on a Connection that a newer one replaced has nothing to say.
    if (state.kind !== 'running' && latest && latest.entry !== entry) return;
    installs.set(hostId, { entry, state });
    for (const listener of [...hostCliListeners]) listener(hostId, state);
  }

  /** What a Connection starts once its Host key is accepted: its Host Server and the Host CLI install. */
  function begin(entry: Entry, dialed: Dialed): void {
    serve(entry, dialed);
    install(entry, dialed);
  }

  /**
   * Starts the Host Server of the Connection, once, with the `muxify` that the
   * probe finds. It does not wait for the install, which tells it its answer.
   * It lives as long as the Connection. See ADR 0025.
   */
  function serve(entry: Entry, dialed: Dialed): void {
    if (entry.server || entry.gone || !dialed.openServerChannel) return;
    const { host } = entry;
    const exec = dialed.transport.exec;
    entry.server = createHostServer({
      open: dialed.openServerChannel,
      locate: () => entry.muxify.locate(exec),
      forget: () => entry.muxify.forget(),
      version: async (path) => (await exec(`${shellQuote(path)} --version`)).stdout.trim().split('\n')[0] ?? '',
      connected: () => !entry.gone && dialed.isConnected(),
      build: options.build ?? 'Muxify phone',
      clock,
      say: (line) => say(`${host.displayName}: Host Server: ${line}`),
    });
    const feed = followListing(entry.server, (line) => say(`${host.displayName}: Host Server: ${line}`));
    const changed = () => {
      // A Connection that a newer one replaced has nothing to say.
      if (feeds.get(host.id)?.feed !== feed) return;
      for (const listener of [...listingListeners]) listener(host.id);
    };
    feeds.set(host.id, { entry, feed });
    feed.onChange(changed);
    changed();
  }

  /**
   * Installs or updates the Host CLI, once per Connection, on a channel of its
   * own: it never goes through withDeadline, so a long download never makes
   * the Connection suspect, and its failure never closes the Connection. It
   * holds the Connection open as a screen's use does, so the idle minute does
   * not cut a download short. See ADR 0016.
   */
  function install(entry: Entry, dialed: Dialed): void {
    if (entry.install || entry.gone || !dialed.openChannel) return;
    const { host } = entry;
    entry.uses += 1;
    busy(entry);
    publish(entry, { kind: 'running' });
    entry.install = installHostCli(dialed.openChannel, { clock }).then((result) => {
      say(`${host.displayName}: Host CLI: ${result.line}`);
      // A new `muxify`: the Host Server forgets the path and starts on it.
      entry.server?.installAnswered(result);
      entry.uses -= 1;
      settle(entry);
      publish(entry, { kind: 'done', result });
      return result;
    });
  }

  /** Closes the Connection. Answers when the socket is shut. */
  function drop(entry: Entry, why: string): Promise<void> {
    if (entry.gone) return Promise.resolve();
    entry.gone = true;
    clock.cancel(entry.idle);
    entry.idle = null;
    entry.server?.close();
    if (entries.get(entry.host.id) === entry) entries.delete(entry.host.id);
    say(`${entry.host.displayName}: closed (${why})`);
    return entry.dialed.then((dialed) => dialed.disconnect()).catch(() => {});
  }

  function busy(entry: Entry): void {
    clock.cancel(entry.idle);
    entry.idle = null;
  }

  function settle(entry: Entry): void {
    if (entry.gone || entry.attaches > 0 || entry.uses > 0) return;
    entry.idle = clock.after(IDLE_MS, () => void drop(entry, 'idle'));
  }

  /** The Host's Connection, open and connected, made new when the one held is dead. */
  async function acquire(host: Host, progress?: (step: ConnectStep) => void): Promise<{ entry: Entry; dialed: Dialed }> {
    for (;;) {
      const held = entries.get(host.id);
      const entry = held ?? open(host, progress);
      const dialed = await entry.dialed;
      if (!entry.gone && dialed.isConnected()) return { entry, dialed };
      void drop(entry, 'it was no longer connected');
      if (!held) throw new Error('The Connection closed as it opened.');
    }
  }

  function checkHostKey(entry: Entry, dialed: Dialed, options: ScreenOptions | undefined): void {
    if (!options?.onHostKey || options.onHostKey(dialed.verdict, dialed.fingerprint)) return;
    void drop(entry, 'its Host key was refused');
    throw Object.assign(new Error('The Host key was rejected.'), { code: 'HOST_KEY_REJECTED' });
  }

  /**
   * The Host's Connection for a screen: its Host key checked first, and only
   * then its Host Server and the Host CLI install started on it.
   */
  async function acquireForScreen(host: Host, options: ScreenOptions | undefined): Promise<{ entry: Entry; dialed: Dialed }> {
    let entry: Entry;
    let dialed: Dialed;
    try {
      ({ entry, dialed } = await acquire(host));
      checkHostKey(entry, dialed, options);
    } catch (error) {
      throw unusable(host, error);
    }
    setProblem(host, null);
    begin(entry, dialed);
    return { entry, dialed };
  }

  function suspect(entry: Entry): void {
    if (entry.attaches > 0) {
      say(`${entry.host.displayName}: an exec passed its deadline; asking the Attach`);
      for (const check of [...entry.suspects]) check();
      return;
    }
    void drop(entry, 'an exec passed its deadline');
  }

  function withDeadline(entry: Entry, transport: TmuxTransport): TmuxTransport {
    return {
      ...transport,
      exec: (command) =>
        new Promise((resolve, reject) => {
          const timer = clock.after(EXEC_DEADLINE_MS, () => {
            suspect(entry);
            reject(new ExecDeadlineError());
          });
          transport.exec(command).then(
            (result) => {
              clock.cancel(timer);
              resolve(result);
            },
            (error: unknown) => {
              clock.cancel(timer);
              reject(error);
            },
          );
        }),
    };
  }

  /** One run of a screen's work on the Host's Connection: its value, or the error and if the Connection was the cause. */
  async function attempt<T>(
    host: Host,
    work: ScreenUse<T>,
    options: ScreenOptions | undefined,
  ): Promise<{ value: T } | { error: unknown; failedByConnection: boolean }> {
    const { entry, dialed } = await acquireForScreen(host, options);
    entry.uses += 1;
    busy(entry);
    try {
      return { value: await work(withDeadline(entry, dialed.transport)) };
    } catch (error) {
      return { error, failedByConnection: error instanceof ExecDeadlineError || !dialed.isConnected() };
    } finally {
      entry.uses -= 1;
      settle(entry);
    }
  }

  async function read<T>(host: Host, work: ScreenUse<T>, options: ScreenOptions | undefined): Promise<T> {
    const first = await attempt(host, work, options);
    if ('value' in first) return first.value;
    if (!first.failedByConnection) throw first.error;
    say(`${host.displayName}: the read failed on its Connection; reading again`);
    const second = await attempt(host, work, options);
    if ('value' in second) return second.value;
    throw second.failedByConnection ? unusable(host, second.error) : second.error;
  }

  /**
   * A write with no answer may have reached the Host, so a second send could
   * apply it two times. That is why a write is not sent again as a read is.
   * Host Writes with a Request id go on the Host Server, which sends them
   * again safely: see host-write-request.
   */
  async function write<T>(host: Host, work: ScreenUse<T>, options: ScreenOptions | undefined): Promise<T> {
    const first = await attempt(host, work, options);
    if ('value' in first) return first.value;
    if (first.failedByConnection) throw new WriteOutcomeUnknown(false, first.error);
    throw first.error;
  }

  return {
    async openConnection(host: Host, progress?: (step: ConnectStep) => void): Promise<HostConnection> {
      let opened: { entry: Entry; dialed: Dialed };
      try {
        opened = await acquire(host, progress);
      } catch (error) {
        throw unusable(host, error);
      }
      setProblem(host, null);
      const { entry, dialed } = opened;
      entry.attaches += 1;
      busy(entry);
      const mine = new Set<() => void>();
      let released = false;

      function release(discard: boolean): Promise<void> {
        if (released) return Promise.resolve();
        released = true;
        entry.attaches -= 1;
        for (const check of mine) entry.suspects.delete(check);
        if (discard || !dialed.isConnected()) {
          return drop(entry, discard ? 'the Attach let it go' : 'it was no longer connected');
        }
        settle(entry);
        return Promise.resolve();
      }

      return {
        transport: dialed.transport,
        // Through the Host Server, read when an upload starts; the script only in Sessions only.
        upload: attachmentUpload(() => entry.server, dialed.upload),
        fingerprint: dialed.fingerprint,
        verdict: dialed.verdict,
        close: () => release(false),
        discard: () => release(true),
        suspected(check: () => void): () => void {
          mine.add(check);
          entry.suspects.add(check);
          return () => {
            mine.delete(check);
            entry.suspects.delete(check);
          };
        },
      };
    },

    read,
    write,

    hostCli: (hostId) => installs.get(hostId)?.state ?? NOT_STARTED,

    hostServer: (hostId) => entries.get(hostId)?.server ?? null,

    async onServer(host, work, options) {
      const { entry } = await acquireForScreen(host, options);
      const { server } = entry;
      if (!server) throw new Error(topicsUnavailable(host.displayName, 'its Connection runs no Host Server.'));
      const state = server.state();
      if (state.kind === 'sessions-only') {
        const words = topicsUnavailable(host.displayName, state.reason);
        // A reason of more than one sentence, such as a phone too old for the Host, ends with its own full stop.
        throw new Error(words.endsWith('.') ? words : `${words}.`);
      }
      entry.uses += 1;
      busy(entry);
      try {
        return await work(server);
      } finally {
        entry.uses -= 1;
        settle(entry);
      }
    },

    listing: (hostId) => feeds.get(hostId)?.feed.current() ?? null,

    subscribeListing(listener) {
      listingListeners.add(listener);
      return () => {
        listingListeners.delete(listener);
      };
    },

    async hold(host, options) {
      const { entry } = await acquireForScreen(host, options);
      entry.uses += 1;
      busy(entry);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        entry.uses -= 1;
        settle(entry);
      };
    },

    problem: (hostId) => problems.get(hostId) ?? null,

    subscribeProblem(listener) {
      problemListeners.add(listener);
      return () => {
        problemListeners.delete(listener);
      };
    },

    subscribeHostCli(listener) {
      hostCliListeners.add(listener);
      return () => {
        hostCliListeners.delete(listener);
      };
    },

    lifecycleChanged(phase: LifecyclePhase): void {
      if (phase === 'background') {
        backgrounded = true;
        return;
      }
      if (phase !== 'active' || !backgrounded) return;
      backgrounded = false;
      // Keepalives stop while iOS suspends the app, so a Connection may have
      // died with nothing to say so. One that an Attach holds is the Attach's
      // to check.
      for (const entry of [...entries.values()]) {
        if (entry.attaches === 0) void drop(entry, 'the app came back from the background');
      }
    },
  };
}
