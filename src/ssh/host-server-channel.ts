import { systemClock, type Clock, type Timer } from '@/lib/clock';
import { describeError } from '@/lib/describe-error';
import { bytesToUtf8 } from '@/lib/utf8';

/**
 * One `muxify server` on one exec channel: the wire of the Host Server
 * protocol as the phone speaks it. It skips the shell's output before
 * `MUXIFY-PROTOCOL`, waits for the server's `hello`, answers it, numbers its
 * own requests from 1, matches each `item` and `end` to its request, and pings
 * a server it has sent nothing for a while. It mirrors MuxifyCore's
 * `ProtocolClient` and `ProtocolLineReader`, whose JSON is the contract.
 *
 * It knows nothing of the Connection, the install or restarts: that is the
 * Host Server link's (`host-server.ts`), which opens one of these per start.
 */

/** The server's first line. What the shell prints before it is skipped. */
export const MAGIC_LINE = 'MUXIFY-PROTOCOL';
/** The longest frame, without its newline. A longer line closes the channel. */
export const MAX_FRAME_BYTES = 16 * 1024 * 1024;
/** The most shell output skipped before the magic line. */
export const MAX_PREAMBLE_BYTES = 64 * 1024;
/** How long the server's `hello` may take. */
export const HELLO_TIMEOUT_MS = 10_000;
/** A `ping` goes out after this long with nothing sent: the server exits after 45 s of silence. */
export const PING_AFTER_MS = 15_000;
/**
 * The protocols the phone speaks. Protocol 2 adds only `colours` and `focus`,
 * for a Mac on a Remote Environment, and the phone uses neither: it writes its
 * Theme's colours on its own Control Connection.
 */
export const PROTOCOLS = { lowest: 1, highest: 2 } as const;
/** How many of the server's stderr lines are kept for the Log. */
export const STDERR_LINES = 50;

/** The events of an exec channel that keeps stderr apart from stdout. */
export interface ServerChannelEvents {
  onData(data: ArrayBuffer): void;
  onStderr(data: ArrayBuffer): void;
  /** Exactly once. `exitCode` is undefined when the Host gave none. */
  onClosed(exitCode?: number): void;
}

export interface ServerChannel {
  write(bytes: Uint8Array): void;
  close(): Promise<void>;
}

/** Opens a non-PTY exec channel for `command`: `connection.openShell({ term: '', command }, events)`. */
export type OpenServerChannel = (command: string, events: ServerChannelEvents) => Promise<ServerChannel>;

/** Why a request ended without `ok`. A code a newer server adds reads as `failed`. */
export type HostServerErrorCode = 'unsupported' | 'invalid' | 'cancelled' | 'unavailable' | 'failed';

const ERROR_CODES: readonly HostServerErrorCode[] = ['unsupported', 'invalid', 'cancelled', 'unavailable', 'failed'];

/** The `error` of a request's `end`, or `unavailable` when its channel ended first. */
export class HostServerError extends Error {
  readonly code: HostServerErrorCode;
  /** MuxifyCore's `TopicFailure` of a failed `environment` request, as it came. */
  readonly topic_failure?: unknown;

  constructor(code: HostServerErrorCode, message: string, topicFailure?: unknown) {
    super(message);
    this.name = 'HostServerError';
    this.code = code;
    if (topicFailure !== undefined) this.topic_failure = topicFailure;
  }
}

/** Every waiting request fails with this when its channel ends. Nothing is replayed. */
export function channelEnded(): HostServerError {
  return new HostServerError('unavailable', 'the connection to the Host Server ended');
}

/** A request on its way: it resolves with the `ok` of its `end`, or rejects with a `HostServerError`. */
export type HostServerCall<T> = Promise<T> & {
  /** Sends `cancel`. The request still ends, `cancelled` unless it had started changing something. */
  cancel(): void;
};

/** The server's `hello`, as the phone answered it. */
export interface ServerHello {
  /** The protocol both sides speak, which the phone's `hello` carries. */
  protocol: number;
  /** The server's `muxify --version` line. Never compared: it goes to the Log and to a reason. */
  build: string;
  capabilities: string[];
}

/** The side too old for the other: the phone, or the Host's muxify. */
export type OldSide = 'phone' | 'host';

/** How a channel ended. */
export type SessionEndCause =
  /** The Host closed the channel. */
  | { kind: 'closed' }
  /** This side closed it. */
  | { kind: 'local' }
  /** The channel did not open. */
  | { kind: 'open-failed'; message: string }
  /** The magic line did not come in the first 64 KiB, or the channel ended before it. */
  | { kind: 'no-magic-line'; printed: number; firstLine: string }
  /** No `hello` within 10 s. */
  | { kind: 'no-hello' }
  /** The server's `hello` offers no protocol the phone speaks. `tooOld` is the side whose protocols are all below the other's. */
  | { kind: 'no-shared-protocol'; build: string; tooOld: OldSide }
  /** A line that is not a frame, or one too long. */
  | { kind: 'protocol'; message: string };

export interface SessionEnd {
  cause: SessionEndCause;
  /** The channel's exit status, when the Host gave one. */
  exitCode?: number;
  /** Whether the server's `hello` was answered before the end. */
  answered: boolean;
}

export interface HostServerSession {
  /** The server's `hello`, once the phone has answered it. Rejects with the end when the handshake fails. */
  readonly hello: Promise<ServerHello>;
  /** Resolves once, when the channel ends for any reason. */
  readonly ended: Promise<SessionEnd>;
  /**
   * Sends a request, `{ <case>: payload }`. Before the handshake it waits, and
   * goes out after the phone's `hello`. `onItem` hears each `item` of a
   * subscription or a stream.
   */
  request(payload: object, onItem?: (item: unknown) => void): HostServerCall<unknown>;
  /** The last lines the server wrote to stderr, oldest first. */
  stderr(): string[];
  /** Ends the channel. Every waiting request fails with `unavailable`. */
  close(): void;
}

/** A line of the end that the Log carries: what happened, in a few words. */
export function describeEnd(end: SessionEnd): string {
  const exit = end.exitCode === undefined ? '' : `, exit ${end.exitCode}`;
  const { cause } = end;
  switch (cause.kind) {
    case 'closed':
      return `the channel closed${exit}`;
    case 'local':
      return `the phone closed the channel${exit}`;
    case 'open-failed':
      return `the channel did not open: ${cause.message}`;
    case 'no-magic-line':
      return (
        `the Host Server did not start: the shell printed ${cause.printed} bytes before it` +
        (cause.firstLine ? `, first "${cause.firstLine}"` : '') +
        exit
      );
    case 'no-hello':
      return `the Host Server did not answer within ${HELLO_TIMEOUT_MS / 1000} s`;
    case 'no-shared-protocol':
      return `no shared protocol with ${cause.build}`;
    case 'protocol':
      return `${cause.message}${exit}`;
  }
}

/** A failure of the reader: it closes the channel. */
class ReaderFailure extends Error {
  constructor(readonly cause: SessionEndCause) {
    super(cause.kind);
  }
}

const NEWLINE = 0x0a;
const RETURN = 0x0d;
const MAGIC_BYTES = new TextEncoder().encode(MAGIC_LINE);

/**
 * Splits a channel's bytes into frame lines, skipping the shell's output
 * before the magic line first. Each line is decoded with the phone's own UTF-8
 * decoder: Hermes has no `TextDecoder`.
 */
export function createFrameReader(limits: { maxFrame?: number; maxPreamble?: number } = {}) {
  const maxFrame = limits.maxFrame ?? MAX_FRAME_BYTES;
  const maxPreamble = limits.maxPreamble ?? MAX_PREAMBLE_BYTES;
  let awaitingMagic = true;
  let pending: Uint8Array[] = [];
  let pendingLength = 0;
  let skipped = 0;
  let firstLine: string | null = null;

  function take(tail: Uint8Array): Uint8Array {
    if (pending.length === 0) return tail;
    const line = new Uint8Array(pendingLength + tail.length);
    let at = 0;
    for (const part of pending) {
      line.set(part, at);
      at += part.length;
    }
    line.set(tail, at);
    pending = [];
    pendingLength = 0;
    return line;
  }

  function isMagic(line: Uint8Array): boolean {
    return line.length === MAGIC_BYTES.length && line.every((byte, at) => byte === MAGIC_BYTES[at]);
  }

  function noMagic(extra: number): ReaderFailure {
    const first = firstLine ?? bytesToUtf8(take(new Uint8Array()).slice(0, 200));
    return new ReaderFailure({ kind: 'no-magic-line', printed: skipped + extra, firstLine: first.slice(0, 200) });
  }

  return {
    /** The complete frame lines in `bytes` and what came before them. Blank lines are skipped. Throws a `ReaderFailure`. */
    feed(bytes: Uint8Array): string[] {
      const lines: string[] = [];
      let start = 0;
      for (let newline = bytes.indexOf(NEWLINE); newline >= 0; newline = bytes.indexOf(NEWLINE, start)) {
        let line = take(bytes.subarray(start, newline));
        const length = line.length + 1;
        start = newline + 1;
        if (line[line.length - 1] === RETURN) line = line.subarray(0, line.length - 1);
        if (awaitingMagic) {
          if (isMagic(line)) {
            awaitingMagic = false;
          } else {
            firstLine ??= bytesToUtf8(line.slice(0, 200));
            skipped += length;
            if (skipped > maxPreamble) throw noMagic(0);
          }
          continue;
        }
        if (line.length > maxFrame) throw new ReaderFailure({ kind: 'protocol', message: 'a frame was longer than 16 MiB' });
        if (line.length > 0) lines.push(bytesToUtf8(line));
      }
      if (start < bytes.length) {
        pending.push(bytes.slice(start));
        pendingLength += bytes.length - start;
      }
      if (awaitingMagic) {
        // The partial line can still be the magic line only while it is no longer than it.
        const partial = pendingLength > MAGIC_BYTES.length + 1 ? pendingLength : 0;
        if (skipped + partial > maxPreamble) throw noMagic(pendingLength);
      } else if (pendingLength > maxFrame + 1) {
        throw new ReaderFailure({ kind: 'protocol', message: 'a frame was longer than 16 MiB' });
      }
      return lines;
    },

    /** The failure when the channel ends while the reader still waits for the magic line. */
    endFailure(): SessionEndCause | null {
      return awaitingMagic ? noMagic(pendingLength).cause : null;
    },
  };
}

/** The last lines of the server's stderr. Never parsed: only quoted in the Log. */
function createStderrTail() {
  const kept: string[] = [];
  let partial: Uint8Array[] = [];

  function keep(bytes: Uint8Array) {
    const line = bytesToUtf8(bytes).trim();
    if (!line) return;
    kept.push(line);
    if (kept.length > STDERR_LINES) kept.splice(0, kept.length - STDERR_LINES);
  }

  function joined(tail: Uint8Array): Uint8Array {
    if (partial.length === 0) return tail;
    const total = partial.reduce((sum, part) => sum + part.length, tail.length);
    const out = new Uint8Array(total);
    let at = 0;
    for (const part of [...partial, tail]) {
      out.set(part, at);
      at += part.length;
    }
    partial = [];
    return out;
  }

  return {
    feed(bytes: Uint8Array) {
      let start = 0;
      for (let newline = bytes.indexOf(NEWLINE); newline >= 0; newline = bytes.indexOf(NEWLINE, start)) {
        keep(joined(bytes.subarray(start, newline)));
        start = newline + 1;
      }
      if (start < bytes.length) partial.push(bytes.slice(start));
    },
    finish() {
      if (partial.length > 0) keep(joined(new Uint8Array()));
    },
    lines: () => [...kept],
  };
}

interface Waiting {
  payload: object;
  onItem?: (item: unknown) => void;
  resolve(value: unknown): void;
  reject(error: HostServerError): void;
  /** Set once the request has gone out. */
  id?: number;
  cancelled: boolean;
}

function asError(raw: unknown): HostServerError {
  const error = (raw ?? {}) as { code?: unknown; message?: unknown; topic_failure?: unknown };
  const code = ERROR_CODES.find((known) => known === error.code) ?? 'failed';
  const message = typeof error.message === 'string' ? error.message : 'the Host Server gave no reason';
  return new HostServerError(code, message, error.topic_failure);
}

/** The server's `hello` as it came: the protocols it speaks, `lowest` to `highest`, and what it is. */
interface ServerOffer {
  lowest: number;
  highest: number;
  build: string;
  capabilities: string[];
}

function readHello(raw: unknown): ServerOffer | null {
  if (!raw || typeof raw !== 'object') return null;
  const hello = raw as { protocol?: unknown; min_protocol?: unknown; build?: unknown; capabilities?: unknown };
  if (typeof hello.protocol !== 'number') return null;
  return {
    // A server with no `min_protocol` speaks `protocol` alone.
    lowest: typeof hello.min_protocol === 'number' ? hello.min_protocol : hello.protocol,
    highest: hello.protocol,
    build: typeof hello.build === 'string' ? hello.build : '',
    capabilities: Array.isArray(hello.capabilities)
      ? hello.capabilities.filter((name): name is string => typeof name === 'string')
      : [],
  };
}

/**
 * The highest protocol that both the phone and the server speak. With none,
 * the side that is too old: the phone when the server's lowest protocol is
 * above the phone's highest, else the Host.
 */
function agree(server: ServerOffer): { protocol: number } | { tooOld: OldSide } {
  const protocol = Math.min(server.highest, PROTOCOLS.highest);
  if (protocol >= Math.max(server.lowest, PROTOCOLS.lowest)) return { protocol };
  return { tooOld: server.lowest > PROTOCOLS.highest ? 'phone' : 'host' };
}

/**
 * Opens one channel running `command` and speaks the protocol on it. The
 * phone's `hello` carries the protocol both sides speak, `build` and
 * `capabilities`, and no `nonce`: its Control Connection can never be the
 * server's own Client.
 */
export function openHostServerSession(options: {
  open: OpenServerChannel;
  command: string;
  build: string;
  capabilities: readonly string[];
  clock?: Clock;
}): HostServerSession {
  const clock = options.clock ?? systemClock;
  const encoder = new TextEncoder();
  const reader = createFrameReader();
  const errors = createStderrTail();
  const waiting = new Map<number, Waiting>();
  const queued: Waiting[] = [];
  let channel: ServerChannel | null = null;
  let nextId = 1;
  let answered = false;
  let finished = false;
  let helloTimer: Timer | null = null;
  let pingTimer: Timer | null = null;

  let settleHello!: { resolve(hello: ServerHello): void; reject(end: SessionEnd): void };
  const hello = new Promise<ServerHello>((resolve, reject) => {
    settleHello = { resolve, reject };
  });
  // A handshake that fails is also an end, which the owner hears there.
  hello.catch(() => {});
  let settleEnd!: (end: SessionEnd) => void;
  const ended = new Promise<SessionEnd>((resolve) => {
    settleEnd = resolve;
  });

  /** Bytes written before the channel has opened: a fast server can answer before `open` resolves. */
  const outbox: Uint8Array[] = [];

  function write(bytes: Uint8Array): void {
    try {
      channel?.write(bytes);
    } catch {
      // The channel's own end says why.
    }
  }

  function send(frame: object): void {
    if (finished) return;
    const bytes = encoder.encode(`${JSON.stringify(frame)}\n`);
    if (channel) write(bytes);
    else outbox.push(bytes);
    if (answered) armPing();
  }

  function armPing(): void {
    clock.cancel(pingTimer);
    pingTimer = clock.after(PING_AFTER_MS, () => {
      pingTimer = null;
      void call({ ping: {} }).catch(() => {});
    });
  }

  function dispatch(entry: Waiting): void {
    if (entry.cancelled) return;
    const id = nextId;
    nextId += 1;
    entry.id = id;
    waiting.set(id, entry);
    send({ id, kind: 'request', request: entry.payload });
  }

  function call(payload: object, onItem?: (item: unknown) => void): HostServerCall<unknown> {
    let entry!: Waiting;
    const promise = new Promise<unknown>((resolve, reject) => {
      entry = { payload, onItem, resolve, reject, cancelled: false };
    });
    if (finished) entry.reject(channelEnded());
    else if (answered) dispatch(entry);
    else queued.push(entry);
    return Object.assign(promise, {
      cancel() {
        if (entry.id !== undefined) {
          if (waiting.has(entry.id)) send({ id: entry.id, kind: 'cancel' });
          return;
        }
        if (entry.cancelled || finished) return;
        entry.cancelled = true;
        queued.splice(queued.indexOf(entry), 1);
        entry.reject(new HostServerError('cancelled', 'cancelled before it was sent'));
      },
    });
  }

  function finish(cause: SessionEndCause, exitCode?: number): void {
    if (finished) return;
    finished = true;
    clock.cancel(helloTimer);
    clock.cancel(pingTimer);
    helloTimer = null;
    pingTimer = null;
    errors.finish();
    const end: SessionEnd = { cause, answered, ...(exitCode === undefined ? {} : { exitCode }) };
    if (!answered) settleHello.reject(end);
    const failing = [...waiting.values(), ...queued];
    waiting.clear();
    queued.length = 0;
    for (const entry of failing) entry.reject(channelEnded());
    settleEnd(end);
  }

  /** Ends the channel from this side, for `cause`. */
  function abandon(cause: SessionEndCause): void {
    const open = channel;
    finish(cause);
    void open?.close().catch(() => {});
  }

  function receiveHello(raw: unknown): void {
    if (answered) return;
    const server = readHello(raw);
    if (!server) {
      abandon({ kind: 'protocol', message: 'the server sent a hello that does not decode' });
      return;
    }
    clock.cancel(helloTimer);
    helloTimer = null;
    const agreed = agree(server);
    if ('tooOld' in agreed) {
      abandon({ kind: 'no-shared-protocol', build: server.build, tooOld: agreed.tooOld });
      return;
    }
    const { protocol } = agreed;
    send({ id: 0, kind: 'hello', hello: { protocol, build: options.build, capabilities: options.capabilities } });
    answered = true;
    armPing();
    settleHello.resolve({ protocol, build: server.build, capabilities: server.capabilities });
    for (const entry of queued.splice(0)) dispatch(entry);
  }

  function receive(line: string): void {
    let frame: unknown;
    try {
      frame = JSON.parse(line);
    } catch {
      abandon({ kind: 'protocol', message: 'the server sent a line that is not JSON' });
      return;
    }
    const { id, kind } = (frame ?? {}) as { id?: unknown; kind?: unknown };
    if (typeof id !== 'number' || !Number.isInteger(id)) {
      abandon({ kind: 'protocol', message: 'the server sent a frame with no id' });
      return;
    }
    const body = (frame as Record<string, unknown>)[typeof kind === 'string' ? kind : ''];
    switch (kind) {
      case 'hello':
        receiveHello(body);
        return;
      case 'item': {
        const entry = waiting.get(id);
        if (entry?.onItem) entry.onItem(body);
        return;
      }
      case 'end': {
        const entry = waiting.get(id);
        if (!entry) return;
        waiting.delete(id);
        const end = (body ?? {}) as { ok?: unknown; error?: unknown };
        if ('error' in end && end.error !== undefined) entry.reject(asError(end.error));
        else if ('ok' in end) entry.resolve(end.ok);
        else entry.reject(new HostServerError('invalid', 'the end has neither ok nor error'));
        return;
      }
      case 'request':
        // The phone serves nothing the server asks for.
        if (!answered) return;
        send({
          id,
          kind: 'end',
          end: { error: { code: 'unsupported', message: 'the phone serves no request from the Host Server' } },
        });
        return;
      default:
        // `cancel` of a request the phone already answered, or a kind a newer server added.
        return;
    }
  }

  const events: ServerChannelEvents = {
    onData(data) {
      if (finished) return;
      let lines: string[];
      try {
        lines = reader.feed(new Uint8Array(data));
      } catch (error) {
        abandon(error instanceof ReaderFailure ? error.cause : { kind: 'protocol', message: describeError(error) });
        return;
      }
      for (const line of lines) {
        if (finished) return;
        receive(line);
      }
    },
    onStderr(data) {
      errors.feed(new Uint8Array(data));
    },
    onClosed(exitCode) {
      if (finished) return;
      finish(reader.endFailure() ?? { kind: 'closed' }, exitCode);
    },
  };

  helloTimer = clock.after(HELLO_TIMEOUT_MS, () => {
    helloTimer = null;
    if (!answered) abandon({ kind: 'no-hello' });
  });

  let opening: Promise<ServerChannel>;
  try {
    opening = options.open(options.command, events);
  } catch (error) {
    opening = Promise.reject(error);
  }
  opening.then(
    (opened) => {
      if (finished) {
        void opened.close().catch(() => {});
        return;
      }
      channel = opened;
      for (const bytes of outbox.splice(0)) write(bytes);
    },
    (error: unknown) => finish({ kind: 'open-failed', message: describeError(error) }),
  );

  return {
    hello,
    ended,
    request: call,
    stderr: errors.lines,
    close: () => abandon({ kind: 'local' }),
  };
}
