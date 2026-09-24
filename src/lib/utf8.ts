/**
 * UTF-8 decoding, written out rather than reached for.
 *
 * Hermes does not ship `TextDecoder` — the SSH library says so in its own
 * specs, which is why its `exec` decodes natively — so a decoder that works
 * under Jest's Node environment and not on the phone is the worst kind of
 * dependency: one that passes every test and fails on device.
 *
 * `TextEncoder` is a different matter and is used freely; Hermes has it.
 *
 * Malformed input decodes to U+FFFD rather than throwing. Everything decoded
 * here came off a wire — a Session name, a path, a captured line — and one bad
 * byte must not take a picker down.
 */

const REPLACEMENT = '�';

/** How many code units to build before joining, so no call list grows huge. */
const CHUNK = 4096;

export function bytesToUtf8(bytes: Uint8Array): string {
  const parts: string[] = [];
  let units: number[] = [];

  const emit = (code: number) => {
    if (code > 0xffff) {
      const offset = code - 0x10000;
      units.push(0xd800 + (offset >> 10), 0xdc00 + (offset & 0x3ff));
    } else {
      units.push(code);
    }
    if (units.length >= CHUNK) {
      parts.push(String.fromCharCode(...units));
      units = [];
    }
  };

  const bad = () => {
    if (units.length > 0) {
      parts.push(String.fromCharCode(...units));
      units = [];
    }
    parts.push(REPLACEMENT);
  };

  for (let at = 0; at < bytes.length; ) {
    const lead = bytes[at];

    if (lead < 0x80) {
      emit(lead);
      at += 1;
      continue;
    }

    // 0x80-0xc1 is a continuation byte on its own or an overlong two-byte
    // lead; 0xf5 and above is past the last code point. Neither starts a
    // sequence.
    const length = lead >= 0xf5 ? 0 : lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc2 ? 2 : 0;
    if (length === 0) {
      bad();
      at += 1;
      continue;
    }

    // A sequence cut off by the end of the input is one bad character, not one
    // per byte: the continuation bytes belong to it and are consumed with it.
    if (at + length > bytes.length) {
      bad();
      at += 1;
      while (at < bytes.length && (bytes[at] & 0xc0) === 0x80) at += 1;
      continue;
    }

    let code = lead & (length === 2 ? 0x1f : length === 3 ? 0x0f : 0x07);
    let valid = true;
    for (let offset = 1; offset < length; offset += 1) {
      const next = bytes[at + offset];
      if ((next & 0xc0) !== 0x80) {
        valid = false;
        break;
      }
      code = (code << 6) | (next & 0x3f);
    }

    // Overlong forms and surrogates encoded as three bytes are rejected: they
    // are how a decoder is talked into producing a character nobody wrote.
    if (
      !valid ||
      code > 0x10ffff ||
      (length === 3 && (code < 0x800 || (code >= 0xd800 && code <= 0xdfff))) ||
      (length === 4 && code < 0x10000)
    ) {
      bad();
      at += 1;
      continue;
    }

    emit(code);
    at += length;
  }

  if (units.length > 0) parts.push(String.fromCharCode(...units));
  return parts.join('');
}
