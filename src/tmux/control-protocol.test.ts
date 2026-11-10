import { readFileSync } from 'fs';
import { join } from 'path';

import { bytesToUtf8 } from '@/lib/utf8';

import {
  createControlParser,
  escapeControlOutput,
  type ControlEvent,
} from './control-protocol';

/** A fixture as tmux wrote it: raw bytes, not all of them valid UTF-8. */
function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(__dirname, '__fixtures__', name)));
}

const ascii = (text: string) => new TextEncoder().encode(text);

/** Everything the parser makes of one complete feed. */
function parseAll(input: Uint8Array): ControlEvent[] {
  const parser = createControlParser();
  return parser.push(input);
}

/** Feeds the input one byte at a time, which is the worst case for framing. */
function parseByByte(input: Uint8Array): ControlEvent[] {
  const parser = createControlParser();
  const events: ControlEvent[] = [];
  for (const byte of input) events.push(...parser.push(Uint8Array.of(byte)));
  return events;
}

describe('a real tmux -C attach transcript', () => {
  const transcript = fixture('control-session.txt');
  const events = parseAll(transcript);

  it('reads the same events however the bytes are split across reads', () => {
    expect(parseByByte(transcript)).toEqual(events);
  });

  it('correlates every command reply by id', () => {
    const replies = events.filter((event) => event.kind === 'reply');
    // Thirteen commands were sent down the fixture's channel, and the attach
    // itself answers first.
    expect(replies.map((reply) => reply.id)).toEqual([
      352, 357, 358, 359, 360, 361, 362, 367, 369, 371, 372, 376, 382, 387, 392, 398,
    ]);
  });

  it('gives a command its own reply lines and nobody else’s', () => {
    const listing = events.find((event) => event.kind === 'reply' && event.id === 357);
    expect(listing).toMatchObject({ kind: 'reply', ok: true });
    expect(replyText(listing)).toEqual(['probe']);

    const layout = events.find((event) => event.kind === 'reply' && event.id === 358);
    expect(replyText(layout)).toEqual(['b25d,80x24,0,0,0']);
  });

  it('marks a failed command as failed, and keeps the message', () => {
    const failed = events.find((event) => event.kind === 'reply' && event.id === 359);
    expect(failed).toMatchObject({ kind: 'reply', ok: false });
    expect(replyText(failed)).toEqual(['parse error: unknown command: this-is-not-a-command']);
  });

  it('keeps a reply line that begins with a percent sign as content', () => {
    // The capture of a zsh prompt carries lines starting with `%`, which must
    // not be read as notifications and must not close the block early.
    const capture = events.find((event) => event.kind === 'reply' && event.id === 371);
    expect(capture).toMatchObject({ kind: 'reply', ok: true });
    expect(replyText(capture)?.some((line) => line.includes('echo hello'))).toBe(true);
    expect(replyText(capture)).toHaveLength(12);
  });

  it('reads pane output as the bytes the Pane actually wrote', () => {
    const outputs = events.filter((event) => event.kind === 'output');
    expect(outputs.length).toBeGreaterThan(5);
    expect(outputs[0]).toMatchObject({ kind: 'output', pane: '%0' });
    // `e\010echo hello\033[?2004l\015\015\012` — the echo of a keystroke, a
    // backspace, an escape sequence and a carriage return.
    expect([...outputs[0].bytes]).toEqual([
      ...ascii('e'),
      0x08,
      ...ascii('echo hello'),
      0x1b,
      ...ascii('[?2004l'),
      0x0d,
      0x0d,
      0x0a,
    ]);
  });

  it('routes output to the Pane that wrote it', () => {
    const panes = new Set(
      events.flatMap((event) => (event.kind === 'output' ? [event.pane] : [])),
    );
    expect(panes).toEqual(new Set(['%0', '%1', '%2', '%3']));
  });

  it('reads a layout change as the window and the layout string', () => {
    const layouts = events.filter((event) => event.kind === 'layout-change');
    expect(layouts[0]).toEqual({
      kind: 'layout-change',
      window: '@0',
      layout: '4196,80x24,0,0[80x12,0,0,0,80x11,0,13,2]',
      visibleLayout: '4196,80x24,0,0[80x12,0,0,0,80x11,0,13,2]',
      flags: '*',
    });
  });

  it('reads the Session, Window and Client notifications', () => {
    const kinds = events.map((event) => event.kind);
    expect(kinds).toContain('session-changed');
    expect(kinds).toContain('session-window-changed');
    expect(kinds).toContain('sessions-changed');
    expect(kinds).toContain('window-add');
    expect(kinds).toContain('window-renamed');
    expect(kinds).toContain('unlinked-window-add');
    expect(kinds).toContain('unlinked-window-close');
    expect(kinds).toContain('exit');

    expect(events.find((event) => event.kind === 'session-changed')).toEqual({
      kind: 'session-changed',
      session: '$0',
      name: 'probe',
    });
    expect(events.find((event) => event.kind === 'window-add')).toEqual({
      kind: 'window-add',
      window: '@1',
    });
    expect(events.find((event) => event.kind === 'window-renamed')).toEqual({
      kind: 'window-renamed',
      window: '@1',
      name: 'tmux',
    });
    expect(events.find((event) => event.kind === 'unlinked-window-close')).toEqual({
      kind: 'unlinked-window-close',
      window: '@1',
    });
  });

  it('ends with the exit the detach produced', () => {
    expect(events[events.length - 1]).toEqual({ kind: 'exit', reason: '' });
  });
});

describe('every byte a Pane can write', () => {
  const output = parseAll(fixture('control-all-bytes.txt'));

  it('decodes to exact bytes, backslash and high bytes included', () => {
    const payload = output.flatMap((event) =>
      event.kind === 'output' ? [...event.bytes] : [],
    );
    const seen = new Set(payload);
    for (let byte = 0; byte <= 0xff; byte += 1) {
      expect(seen.has(byte)).toBe(true);
    }
  });

  it('never decodes to a JS string on the way through', () => {
    // A round trip through UTF-8 would turn 0xff into U+FFFD and lose it. The
    // fixture holds bytes that are not valid UTF-8, so surviving them at all
    // is the proof.
    const payload = Uint8Array.from(
      output.flatMap((event) => (event.kind === 'output' ? [...event.bytes] : [])),
    );
    expect(bytesToUtf8(payload)).toContain('�');
    expect(payload).toContain(0xff);
  });
});

describe('escaping, which is the parser run backwards', () => {
  it('escapes exactly what tmux escapes and nothing else', () => {
    const all = Uint8Array.from({ length: 256 }, (_, byte) => byte);
    const escaped = escapeControlOutput(all);
    // Control bytes and backslash, three octal digits each; everything else
    // travels as itself, high bytes included. Measured against tmux 3.7c.
    expect(escaped.startsWith('\\000\\001')).toBe(true);
    expect(escaped).toContain('\\134');
    expect(escaped).toContain('');
    expect(escaped.match(/\\[0-7]{3}/g)).toHaveLength(33);
  });

  it('round-trips through the parser', () => {
    const all = Uint8Array.from({ length: 256 }, (_, byte) => byte);
    const line = `%output %7 ${escapeControlOutput(all)}\n`;
    const events = parseAll(Uint8Array.from(line, (character) => character.charCodeAt(0)));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'output', pane: '%7' });
    expect([...(events[0] as { bytes: Uint8Array }).bytes]).toEqual([...all]);
  });
});

describe('what tmux may send that this app has never seen', () => {
  it('ignores an unknown notification rather than throwing', () => {
    const events = parseAll(
      ascii('%something-new $0 whatever\n%output %0 hi\n'),
    );
    expect(events).toEqual([{ kind: 'output', pane: '%0', bytes: ascii('hi') }]);
  });

  it('ignores a notification it knows but cannot read', () => {
    expect(parseAll(ascii('%window-renamed\n'))).toEqual([]);
  });

  it('holds an incomplete line until the rest of it arrives', () => {
    const parser = createControlParser();
    expect(parser.push(ascii('%output %0 he'))).toEqual([]);
    expect(parser.push(ascii('llo\n'))).toEqual([
      { kind: 'output', pane: '%0', bytes: ascii('hello') },
    ]);
  });

  it('holds an unfinished command block until its end arrives', () => {
    const parser = createControlParser();
    expect(parser.push(ascii('%begin 1 7 1\nfirst\n'))).toEqual([]);
    const events = parser.push(ascii('second\n%end 1 7 1\n'));
    expect(events).toHaveLength(1);
    expect(replyText(events[0])).toEqual(['first', 'second']);
  });

  it('does not close a block on an end meant for another command', () => {
    const parser = createControlParser();
    const events = parser.push(ascii('%begin 1 7 1\n%end 1 8 1\nreal\n%end 1 7 1\n'));
    expect(replyText(events[0])).toEqual(['%end 1 8 1', 'real']);
  });

  it('tolerates a carriage return before the newline', () => {
    expect(parseAll(ascii('%window-add @4\r\n'))).toEqual([
      { kind: 'window-add', window: '@4' },
    ]);
  });

  it('reads an exit with a reason', () => {
    expect(parseAll(ascii('%exit server exited\n'))).toEqual([
      { kind: 'exit', reason: 'server exited' },
    ]);
  });

  it('reads a client detaching', () => {
    expect(parseAll(ascii('%client-detached /dev/ttys004\n'))).toEqual([
      { kind: 'client-detached', client: '/dev/ttys004' },
    ]);
  });

  it('reads the active Pane of a Window changing', () => {
    expect(parseAll(ascii('%window-pane-changed @2 %9\n'))).toEqual([
      { kind: 'window-pane-changed', window: '@2', pane: '%9' },
    ]);
  });

  it('keeps a Window name that contains spaces whole', () => {
    expect(parseAll(ascii('%window-renamed @2 my window\n'))).toEqual([
      { kind: 'window-renamed', window: '@2', name: 'my window' },
    ]);
  });
});

function replyText(event: ControlEvent | undefined): string[] | undefined {
  if (!event || event.kind !== 'reply') return undefined;
  return event.lines.map(bytesToUtf8);
}


describe('Session rename notifications', () => {
  it('reads current and sibling IDs and retains spaces and UTF-8 across split input', () => {
    const input = ascii('%session-renamed $1 sibling-renamed\n%session-renamed $0 café  work\n');
    const expected = [
      { kind: 'session-renamed', session: '$1', name: 'sibling-renamed' },
      { kind: 'session-renamed', session: '$0', name: 'café  work' },
    ];
    expect(parseAll(input)).toEqual(expected);
    expect(parseByByte(input)).toEqual(expected);
  });

  it.each(['', '$0', '$0 ', ' name', 'work name', '$ name'])(
    'rejects malformed rename fields %p', (fields) => {
      expect(parseAll(ascii(`%session-renamed ${fields}\n`))).toEqual([]);
    },
  );
});
