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
