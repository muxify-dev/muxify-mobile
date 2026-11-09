import { silentLog, speakingAs, type Log } from '@/diagnostics/log';
import { systemClock, type Clock, type Timer } from '@/lib/clock';
import type { KeyVerdict } from '@/ssh/host-key';
import type { Host } from '@/storage/records';
import type { HostStore } from '@/storage/store';
import type { HostConnection, LifecyclePhase, OpenConnection } from '@/tmux/attach';
import type { TmuxTransport } from '@/tmux/transport';
import { createMuxifyCli, type MuxifyCli } from '@/topics/muxify-cli';

/** How long a Connection with no Attach stays open after its last screen read. */
export const IDLE_MS = 60_000;
/** How long one screen exec may take before its Connection is suspect. */
export const EXEC_DEADLINE_MS = 8_000;

/** A new SSH Connection to a Host, as the registry needs it. */
export interface Dialed {
  transport: TmuxTransport;
  upload?: HostConnection['upload'];
  fingerprint: string;
  verdict: KeyVerdict;
  isConnected(): boolean;
  disconnect(): Promise<void>;
}

/**
 * Opens a new SSH Connection. `dropped` is called when the library finds the
 * Connection dead, which its keepalive does when the Host stops answering.
 */
export type Dial = (host: Host, dropped: () => void) => Promise<Dialed>;

/** What a screen does with a Connection: its commands, and the Host's `muxify`. */
export type ScreenUse<T> = (transport: TmuxTransport, muxify: MuxifyCli) => Promise<T>;

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
  /** A screen's write. It is never sent again: it may have reached the Host. */
  write<T>(host: Host, use: ScreenUse<T>, options?: ScreenOptions): Promise<T>;
  /** React Native's app-state, forwarded as a fact. */
  lifecycleChanged(phase: LifecyclePhase): void;
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
  muxify: MuxifyCli;
  /** Attaches that hold it. */
  attaches: number;
  /** Screen reads and writes in flight on it. */
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
}): HostConnections {
  const { dial, store } = options;
  const clock = options.clock ?? systemClock;
  const log = options.log ?? silentLog;
  const say = speakingAs(log, 'connections');
  const entries = new Map<string, Entry>();
  let backgrounded = false;

  function open(host: Host): Entry {
    say(`${host.displayName}: connecting`);
    let self: Entry | undefined;
    const dialed = (async () => {
      const opened = await dial(host, () => {
        if (self) void drop(self, 'the keepalive found it dead');
      });
      if (opened.verdict.kind === 'first-sight') {
        await store.rememberFingerprint(host.id, opened.fingerprint);
      }
      say(`${host.displayName}: open; Host key ${opened.verdict.kind}`);
      return opened;
    })();
    const entry: Entry = {
      host,
      dialed,
      muxify: createMuxifyCli((line) => say(`${host.displayName}: ${line}`)),
      attaches: 0,
      uses: 0,
      idle: null,
      suspects: new Set(),
      gone: false,
    };
    self = entry;
    entry.dialed.catch(() => {
      entry.gone = true;
      if (entries.get(host.id) === entry) entries.delete(host.id);
    });
    entries.set(host.id, entry);
    return entry;
  }

  /** Closes the Connection. Answers when the socket is shut. */
  function drop(entry: Entry, why: string): Promise<void> {
    if (entry.gone) return Promise.resolve();
    entry.gone = true;
    clock.cancel(entry.idle);
    entry.idle = null;
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
  async function acquire(host: Host): Promise<{ entry: Entry; dialed: Dialed }> {
    for (;;) {
      const held = entries.get(host.id);
      const entry = held ?? open(host);
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

  async function run<T>(
    host: Host,
    use: ScreenUse<T>,
    retry: boolean,
    options: ScreenOptions | undefined,
  ): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      const { entry, dialed } = await acquire(host);
      checkHostKey(entry, dialed, options);
      entry.uses += 1;
      busy(entry);
      try {
        return await use(withDeadline(entry, dialed.transport), entry.muxify);
      } catch (error) {
        const failedByConnection = error instanceof ExecDeadlineError || !dialed.isConnected();
        if (!failedByConnection || !retry || attempt > 1) throw error;
        say(`${host.displayName}: the read failed on its Connection; reading again`);
      } finally {
        entry.uses -= 1;
        settle(entry);
      }
    }
  }

  return {
    async openConnection(host: Host): Promise<HostConnection> {
      const { entry, dialed } = await acquire(host);
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
        upload: dialed.upload,
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

    read: (host, use, options) => run(host, use, true, options),
    write: (host, use, options) => run(host, use, false, options),

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
