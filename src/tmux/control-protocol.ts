/**
 * tmux's control protocol, as a pure function of bytes.
 *
 * `tmux -C attach` speaks a line-oriented text protocol: notifications start
 * with `%`, and a command's reply is the lines between `%begin` and `%end` (or
 * `%error`) carrying the same id. That is the whole of it — see ADR 0006 for
 * why this is a few hundred lines of TypeScript rather than the Zig
 * reimplementation ADR 0001 declined to write.
 *
 * Nothing here connects, renders or imports anything native. Bytes in, events
 * out; `control-connection.ts` puts a channel behind it.
 *
 * Everything is done at byte level. A Pane's output is not text — it is VT
 * bytes, which may be a multi-byte character split across two network reads,
 * or not UTF-8 at all — and decoding it to a JS string on the way through
 * would turn every byte above 0x7f that is not valid UTF-8 into U+FFFD. The
 * fixture proves the point: it carries all 256 byte values out of a real Pane.
 */

import { bytesToUtf8 } from '@/lib/utf8';

/** What the parser makes of the stream. */
export type ControlEvent =
  /** A command's reply, complete. `ok` is false when tmux answered `%error`. */
  | { kind: 'reply'; id: number; ok: boolean; lines: Uint8Array[] }
  /** Bytes a Pane wrote. The only event on the hot path. */
  | { kind: 'output'; pane: string; bytes: Uint8Array }
  | { kind: 'layout-change'; window: string; layout: string; visibleLayout: string; flags: string }
  | { kind: 'session-changed'; session: string; name: string }
  | { kind: 'session-window-changed'; session: string; window: string }
  | { kind: 'sessions-changed' }
  | { kind: 'window-add'; window: string }
  | { kind: 'window-close'; window: string }
  | { kind: 'window-renamed'; window: string; name: string }
  | { kind: 'window-pane-changed'; window: string; pane: string }
  | { kind: 'pane-mode-changed'; pane: string }
  /**
   * A Window outside the attached Session. Muxify keeps them apart from the
   * linked ones because an add is none of its business — but a close is: tmux
   * unlinks a Window from its Session before killing it, so the Window that
   * just vanished from under the user arrives as `%unlinked-window-close`.
   */
  | { kind: 'unlinked-window-add'; window: string }
  | { kind: 'unlinked-window-close'; window: string }
  | { kind: 'unlinked-window-renamed'; window: string; name: string }
  | { kind: 'client-detached'; client: string }
  /** The control client is finished. Nothing more will arrive. */
  | { kind: 'exit'; reason: string }
  /**
   * A line that is not part of the protocol at all.
   *
   * tmux never writes one: outside a reply block every line it produces starts
   * with `%`. So anything arriving here came up the channel from somewhere
   * else — which, for a shell channel with no pty, means stderr. That is where
   * `tmux: command not found` and a failing `tmux -C attach` write, and it is
   * the most useful thing a Connection that never opened has to say. Dropped
   * silently until it was measured; see ADR 0007.
   */
  | { kind: 'notice'; text: string };

export interface ControlParser {
  /** Reads whatever has arrived, and returns every event it completed. */
  push(bytes: Uint8Array): ControlEvent[];
}

const LF = 0x0a;
const CR = 0x0d;
const BACKSLASH = 0x5c;
const ZERO = 0x30;
const SEVEN = 0x37;

export function createControlParser(): ControlParser {
  /** Bytes of a line that has not ended yet. */
  let partial: number[] = [];
  /** The command whose reply is being collected, if one is open. */
  let block: { id: number; lines: Uint8Array[] } | null = null;

  function readLine(line: Uint8Array, events: ControlEvent[]): void {
    if (block) {
      // Only the matching `%end` or `%error` closes the block. A reply line may
      // start with `%` — a captured zsh prompt does — and reading one as a
      // notification would end the reply early and leak the rest into the
      // stream.
      const closing = closes(line, block.id);
      if (closing) {
        events.push({ kind: 'reply', id: block.id, ok: closing === 'end', lines: block.lines });
        block = null;
        return;
      }
      block.lines.push(line);
      return;
    }

    if (line.length === 0) return;
    if (line[0] !== 0x25 /* % */) {
      events.push({ kind: 'notice', text: bytesToUtf8(line) });
      return;
    }

    // The name is read from the bytes rather than from a decoded line: output
    // is the hot path, and its payload must not be decoded to find out that it
    // is output.
    const space = indexOfByte(line, 0x20, 0);
    const name = latin1Of(space < 0 ? line : line.subarray(0, space));

    if (name === '%output') {
      const at = indexOfByte(line, 0x20, '%output'.length + 1);
      if (at < 0) return;
      const pane = latin1Of(line.subarray('%output'.length + 1, at));
      events.push({ kind: 'output', pane, bytes: unescapeOutput(line.subarray(at + 1)) });
      return;
    }

    // Everything else is small and may carry a name somebody typed, so it is
    // read as the UTF-8 it is. A space cannot appear inside a multi-byte
    // sequence, so splitting on one after decoding is safe.
    const rest = space < 0 ? '' : bytesToUtf8(line.subarray(space + 1));

    if (name === '%begin') {
      const id = commandId(rest);
      if (id !== undefined) block = { id, lines: [] };
      return;
    }

    const event = notification(name, rest);
    // An unknown notification is not an error. tmux adds them, and a client
    // that throws on one is a client that breaks on a tmux upgrade.
    if (event) events.push(event);
  }

  return {
    push(bytes: Uint8Array): ControlEvent[] {
      const events: ControlEvent[] = [];

      for (const byte of bytes) {
        if (byte !== LF) {
          partial.push(byte);
          continue;
        }
        // A control channel has no pty, so there is no CR to strip — but one
        // costs nothing to tolerate and a stray one would corrupt every field.
        if (partial.length > 0 && partial[partial.length - 1] === CR) partial.pop();
        readLine(Uint8Array.from(partial), events);
        partial = [];
      }

      return events;
    },
  };
}

/**
 * Whether this line ends the reply to `id`, and how.
 *
 * `%end <time> <id> <flags>` and `%error <time> <id> <flags>`. The id has to
 * match: a line that merely looks like an end belongs to the reply.
 */
function closes(line: Uint8Array, id: number): 'end' | 'error' | null {
  if (line.length === 0 || line[0] !== 0x25) return null;
  const text = latin1Of(line);
  const kind = text.startsWith('%end ') ? 'end' : text.startsWith('%error ') ? 'error' : null;
  if (!kind) return null;
  const rest = text.slice(kind === 'end' ? '%end '.length : '%error '.length);
  return commandId(rest) === id ? kind : null;
}

/** The id out of a `%begin`/`%end`/`%error` tail: `<time> <id> <flags>`. */
function commandId(rest: string): number | undefined {
  const fields = rest.split(' ');
  if (fields.length < 2) return undefined;
  const id = Number(fields[1]);
  return Number.isInteger(id) ? id : undefined;
}

function notification(name: string, rest: string): ControlEvent | null {
  const fields = rest === '' ? [] : rest.split(' ');

  switch (name) {
    case '%exit':
      return { kind: 'exit', reason: rest };
    case '%sessions-changed':
      return { kind: 'sessions-changed' };
    case '%session-changed':
      return fields.length < 2
        ? null
        : { kind: 'session-changed', session: fields[0], name: fields.slice(1).join(' ') };
    case '%session-window-changed':
      return fields.length < 2
        ? null
        : { kind: 'session-window-changed', session: fields[0], window: fields[1] };
    case '%window-add':
      return fields.length < 1 ? null : { kind: 'window-add', window: fields[0] };
    case '%window-close':
      return fields.length < 1 ? null : { kind: 'window-close', window: fields[0] };
    case '%unlinked-window-add':
      return fields.length < 1 ? null : { kind: 'unlinked-window-add', window: fields[0] };
    case '%unlinked-window-close':
      return fields.length < 1 ? null : { kind: 'unlinked-window-close', window: fields[0] };
    case '%window-renamed':
    case '%unlinked-window-renamed':
      // A Window name may hold spaces, and it is the last field, so the rest
      // of the line is the name however many spaces it has in it.
      return fields.length < 2
        ? null
        : {
            kind: name === '%window-renamed' ? 'window-renamed' : 'unlinked-window-renamed',
            window: fields[0],
            name: fields.slice(1).join(' '),
          };
    case '%window-pane-changed':
      return fields.length < 2
        ? null
        : { kind: 'window-pane-changed', window: fields[0], pane: fields[1] };
    case '%pane-mode-changed':
      return fields.length < 1 ? null : { kind: 'pane-mode-changed', pane: fields[0] };
    case '%client-detached':
      return fields.length < 1 ? null : { kind: 'client-detached', client: fields[0] };
    case '%layout-change':
      // `<window> <layout> <visible layout> <flags>`. Older tmux sends only the
      // window and one layout, so the rest is filled in from what is there.
      return fields.length < 2
        ? null
        : {
            kind: 'layout-change',
            window: fields[0],
            layout: fields[1],
            visibleLayout: fields[2] ?? fields[1],
            flags: fields[3] ?? '',
          };
    default:
      return null;
  }
}

/**
 * Undoes tmux's escaping of a Pane's output.
 *
 * Measured against tmux 3.7c by writing all 256 byte values through a Pane:
 * bytes below 0x20 and backslash arrive as `\NNN`, three octal digits; every
 * other byte arrives as itself, 0x7f and everything above 0x80 included. So
 * the stream is 1.26x its real size, and this loop is what un-inflates it.
 *
 * A backslash not followed by three octal digits cannot come from tmux, and is
 * kept as a backslash rather than dropped — losing a byte is worse than
 * keeping one that should not be there.
 */
export function unescapeOutput(escaped: Uint8Array): Uint8Array {
  // Nothing to undo is the common case for a Pane writing plain text.
  if (indexOfByte(escaped, BACKSLASH, 0) < 0) return escaped;

  const bytes = new Uint8Array(escaped.length);
  let length = 0;

  for (let at = 0; at < escaped.length; ) {
    if (escaped[at] !== BACKSLASH || at + 3 >= escaped.length) {
      bytes[length++] = escaped[at++];
      continue;
    }
    const first = escaped[at + 1];
    const second = escaped[at + 2];
    const third = escaped[at + 3];
    if (!octal(first) || !octal(second) || !octal(third)) {
      bytes[length++] = escaped[at++];
      continue;
    }
    bytes[length++] =
      ((first - ZERO) << 6) | ((second - ZERO) << 3) | (third - ZERO);
    at += 4;
  }

  return bytes.subarray(0, length);
}

/**
 * The same rule, applied forwards.
 *
 * Not on any path Muxify uses — tmux does the escaping — but it is what makes
 * the rule testable as a rule rather than as a handful of examples, and it is
 * the exact statement of what the parser above has to undo.
 */
export function escapeControlOutput(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    if (byte < 0x20 || byte === BACKSLASH) {
      out += `\\${byte.toString(8).padStart(3, '0')}`;
    } else {
      out += String.fromCharCode(byte);
    }
  }
  return out;
}

function octal(byte: number): boolean {
  return byte >= ZERO && byte <= SEVEN;
}

function indexOfByte(bytes: Uint8Array, byte: number, from: number): number {
  for (let at = from; at < bytes.length; at += 1) {
    if (bytes[at] === byte) return at;
  }
  return -1;
}

/**
 * A short run of bytes as one character each.
 *
 * Only for the two things that are ASCII by construction — a notification's
 * name and a Pane id — where reading byte for byte costs nothing and cannot
 * be thrown off by whatever follows on the line.
 */
function latin1Of(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return text;
}
