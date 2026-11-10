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
