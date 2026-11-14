import type { KeyPress } from '@/tmux/key-press';

/**
 * Bracketed paste markers, which tell a shell "what follows was pasted, do not
 * act on it" — `ESC[200~` and `ESC[201~`.
 */
const PASTE_START = [0x1b, 0x5b, 0x32, 0x30, 0x30, 0x7e];
const PASTE_END = [0x1b, 0x5b, 0x32, 0x30, 0x31, 0x7e];

const LF = 0x0a;
const CR = 0x0d;

/**
 * Turns what the Surface emits into what a shell expects.
 *
 * iOS delivers every keystroke through `insertText`, so ghostty cannot tell
 * typing from pasting and wraps each one as a paste: pressing `l` sends
 * `ESC[200~ l ESC[201~`, and Enter sends `ESC[200~ LF ESC[201~`. A shell with
 * bracketed paste on — which is to say any modern one — then does exactly what
 * it is told and inserts the newline as text instead of running the line. That
 * is the "Enter just makes a new line" bug, and no amount of looking at the
 * Enter key would have found it, because the problem is the wrapper around it.
 *
 * So the markers are stripped and LF is turned into CR, which is what a real
 * terminal sends for Return.
 *
 * The cost is real and worth naming: pasting multiple lines now runs every one
 * of them, because nothing downstream can tell a paste from typing any more.
 * Bracketed paste exists to prevent exactly that. It is the right trade here
 * only because the alternative is a terminal that cannot run a command.
 */
export function toShellInput(input: Uint8Array): Uint8Array {
  const output: number[] = [];

  for (let index = 0; index < input.length; ) {
    if (matchesAt(input, index, PASTE_START)) {
      index += PASTE_START.length;
      continue;
    }
    if (matchesAt(input, index, PASTE_END)) {
      index += PASTE_END.length;
      continue;
    }
    output.push(input[index] === LF ? CR : input[index]);
    index += 1;
  }

  return Uint8Array.from(output);
}

function matchesAt(input: Uint8Array, at: number, marker: number[]): boolean {
  if (at + marker.length > input.length) return false;
  return marker.every((byte, offset) => input[at + offset] === byte);
}

/** tmux answers Pane queries. The Surface's duplicate replies are not typed input. */
export function withoutTerminalReplies(input: Uint8Array): Uint8Array {
  const output: number[] = [];

  for (let index = 0; index < input.length; ) {
    const end = terminalReplyEnd(input, index);
    if (end > index) index = end;
    else output.push(input[index++]);
  }

  return Uint8Array.from(output);
}

function terminalReplyEnd(input: Uint8Array, start: number): number {
  if (input[start] !== 0x1b) return start;
  const introducer = input[start + 1];

  if (introducer === 0x5d || introducer === 0x50) {
    for (let end = start + 2; end < input.length; end += 1) {
      if (introducer === 0x5d && input[end] === 0x07) return end + 1;
      if (input[end] === 0x1b && input[end + 1] === 0x5c) return end + 2;
    }
    return start;
  }

  if (introducer !== 0x5b) return start;
  let end = start + 2;
  let sequence = '';
  while (input[end] >= 0x30 && input[end] <= 0x3f) {
    sequence += String.fromCharCode(input[end++]);
  }
  while (input[end] >= 0x20 && input[end] <= 0x2f) {
    sequence += String.fromCharCode(input[end++]);
  }
  if (!(input[end] >= 0x40 && input[end] <= 0x7e)) return start;
  sequence += String.fromCharCode(input[end]);

  const reply =
    /^[?>][\d;]+c$/.test(sequence) ||
    /^\?[\d;]+\$y$/.test(sequence) ||
    /^\?\d+u$/.test(sequence) ||
    /^[03]n$/.test(sequence) ||
    /^\d+(;\d+)+t$/.test(sequence) ||
    // Row-one cursor reports share their encoding with modified F3.
    (/^\d+;\d+R$/.test(sequence) && !/^1;\d+R$/.test(sequence));
  return reply ? end + 1 : start;
}

/**
 * Sets the Surface's kitty keyboard flags to 1, "disambiguate", replacing
 * whatever the Pane last asked for.
 *
 * The Surface reads Pane output raw, so a program that asks its terminal for
 * kitty keys — Claude Code sends `CSI > 5 u` — turned them on in the Surface
 * too. tmux 3.8 never honours that request, so a Pane behind tmux never gets a
 * kitty key from a real terminal. A Pane behind Muxify got one for every
 * hardware ctrl key, and a shell printed the tail of `ESC [ 114 ; 5 u` for
 * ctrl-r. tmux owns the encoding: see toTypedParts.
 *
 * Flag 1 and not 0, because 0 is legacy, where shift-Return is a bare CR and
 * there is no S-Enter left to name.
 */
export const KEYBOARD_PIN = Uint8Array.from([0x1b, 0x5b, 0x3d, 0x31, 0x3b, 0x31, 0x75]);

/**
 * Whether output can leave the Surface's kitty flags somewhere other than
 * KEYBOARD_PIN: a push, pop or set, a full reset, or a switch of screen, which
 * carries flags of its own.
 */
export function movesKeyboardFlags(output: Uint8Array): boolean {
  // Only a short run after each ESC becomes a string: a paint can be far
  // longer than the arguments one call may spread.
  for (let start = output.indexOf(0x1b); start !== -1; start = output.indexOf(0x1b, start + 1)) {
    const sequence = String.fromCharCode(...output.subarray(start, start + KEYBOARD_FLAG_MOVE_MAX));
    if (KEYBOARD_FLAG_MOVE.test(sequence)) return true;
  }
  return false;
}

const KEYBOARD_FLAG_MOVE = /^\x1b(?:\[[<>=][\d;]*u|c|\[\?(?:1049|1047|47)[hl])/;
/** Longer than any sequence KEYBOARD_FLAG_MOVE matches. */
const KEYBOARD_FLAG_MOVE_MAX = 16;

/** Typed input, cut where the Surface reported a key by its kitty code. */
export type TypedPart = { kind: 'bytes'; bytes: Uint8Array } | { kind: 'press'; press: KeyPress };

/**
 * Cuts the Surface's kitty keys out of typed input as KeyPresses, so tmux
 * picks the bytes for what the Pane is running: ctrl-r is 0x12 to a shell,
 * and shift-Return is `ESC [ 13 ; 2 u` to a Pane that asked tmux for extended
 * keys and CR to one that did not. See renderPress. Everything else is passed
 * through as bytes.
 *
 * A kitty key with a modifier tmux has no name for, such as super, is dropped:
 * its bytes would only print as text.
 */
export function toTypedParts(input: Uint8Array): TypedPart[] {
  const parts: TypedPart[] = [];
  let run: number[] = [];
  const endRun = () => {
    if (run.length > 0) parts.push({ kind: 'bytes', bytes: Uint8Array.from(run) });
    run = [];
  };

  for (let index = 0; index < input.length; ) {
    const key = kittyKeyAt(input, index);
    if (key === null) {
      run.push(input[index++]);
      continue;
    }
    endRun();
    if (key.press !== undefined) parts.push({ kind: 'press', press: key.press });
    index = key.end;
  }
  endRun();
  return parts;
}

const KITTY_KEY = /^\x1b\[(\d+)(?::\d*)*(?:;(\d+)(?::\d+)?)?(?:;[\d:]*)?u/;

const KITTY_NAMES: Record<number, string> = {
  8: 'BSpace',
  9: 'Tab',
  13: 'Enter',
  27: 'Escape',
  32: 'Space',
  127: 'BSpace',
};

const SHIFT = 1;
const ALT = 2;
const CTRL = 4;
const LOCKS = 64 | 128;

/** The press a kitty key code and its modifier bits stand for, or undefined. */
function kittyPress(code: number, modifiers: number): KeyPress | undefined {
  if ((modifiers & ~(SHIFT | ALT | CTRL | LOCKS)) !== 0) return undefined;
  const key = KITTY_NAMES[code] ?? (code > 32 && code <= 0x10ffff ? String.fromCodePoint(code) : undefined);
  if (key === undefined) return undefined;
  return { key, ctrl: (modifiers & CTRL) !== 0, alt: (modifiers & ALT) !== 0, shift: (modifiers & SHIFT) !== 0 };
}

function kittyKeyAt(input: Uint8Array, start: number): { press: KeyPress | undefined; end: number } | null {
  if (input[start] !== 0x1b || input[start + 1] !== 0x5b) return null;
  let end = start + 2;
  while (end < input.length && end - start < 32 && input[end] !== 0x75 && input[end] >= 0x30 && input[end] <= 0x3b) {
    end += 1;
  }
  const match = KITTY_KEY.exec(String.fromCharCode(...input.subarray(start, end + 1)));
  if (match === null) return null;

  const modifiers = (match[2] === undefined ? 1 : Number(match[2])) - 1;
  return { press: kittyPress(Number(match[1]), modifiers), end: end + 1 };
}
