/**
 * Byte-level base64, for moving terminal traffic between the SSH transport and
 * the Surface.
 *
 * Both sides of that wire speak base64 deliberately. The Surface's input event
 * also exposes a decoded-text form, and the transport can hand back strings —
 * but a multi-byte character split across two network reads is corrupted by
 * text decoding and survives byte handling. Everything here works on bytes.
 *
 * Implemented in plain JS rather than reaching for `btoa`/`atob` or `Buffer`:
 * neither is guaranteed on Hermes, and the global `btoa` is defined over
 * latin-1 code units, which silently mangles bytes above 0x7f. `TextEncoder`
 * is a different matter — Hermes has it, and `utf8.ts` says why the decoder
 * still has to be written out while the encoder does not.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const WHITESPACE = /\s/;

const DECODE_TABLE = /* @__PURE__ */ (() => {
  const table = new Uint8Array(128).fill(0xff);
  for (let i = 0; i < ALPHABET.length; i += 1) {
    table[ALPHABET.charCodeAt(i)] = i;
  }
  return table;
})();

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';

  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const triple = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out +=
      ALPHABET[(triple >> 18) & 0x3f] +
      ALPHABET[(triple >> 12) & 0x3f] +
      ALPHABET[(triple >> 6) & 0x3f] +
      ALPHABET[triple & 0x3f];
  }

  const remaining = bytes.length - i;
  if (remaining === 1) {
    const chunk = bytes[i] << 16;
    out += ALPHABET[(chunk >> 18) & 0x3f] + ALPHABET[(chunk >> 12) & 0x3f] + '==';
  } else if (remaining === 2) {
    const chunk = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out +=
      ALPHABET[(chunk >> 18) & 0x3f] +
      ALPHABET[(chunk >> 12) & 0x3f] +
      ALPHABET[(chunk >> 6) & 0x3f] +
      '=';
  }

  return out;
}

/**
 * Decodes base64 to bytes.
 *
 * Whitespace is skipped rather than rejected: base64 arriving over a wire is
 * commonly line-wrapped, and throwing on a newline would be a needless failure.
 * Any other character outside the alphabet is still an error.
 */
export function base64ToBytes(base64: string): Uint8Array {
  const bytes = new Uint8Array(Math.floor((base64.length * 3) / 4));

  let byte = 0;
  let accumulator = 0;
  let bits = 0;

  for (let i = 0; i < base64.length; i += 1) {
    const character = base64[i];
    if (character === '=') {
      break;
    }
    if (WHITESPACE.test(character)) {
      continue;
    }

    const code = base64.charCodeAt(i);
    const value = code < 128 ? DECODE_TABLE[code] : 0xff;
    if (value === 0xff) {
      throw new Error(`Invalid base64 character at index ${i}: ${JSON.stringify(character)}`);
    }

    accumulator = (accumulator << 6) | value;
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      bytes[byte] = (accumulator >> bits) & 0xff;
      byte += 1;
    }
  }

  return bytes.subarray(0, byte);
}
