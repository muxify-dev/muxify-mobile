import { base64ToBytes, bytesToBase64, utf8ToBytes } from './base64';

const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

describe('bytesToBase64', () => {
  it('encodes an empty input', () => {
    expect(bytesToBase64(new Uint8Array())).toBe('');
  });

  it('encodes input needing no padding', () => {
    expect(bytesToBase64(ascii('abc'))).toBe('YWJj');
  });

  it('encodes input needing one pad character', () => {
    expect(bytesToBase64(ascii('ab'))).toBe('YWI=');
  });

  it('encodes input needing two pad characters', () => {
    expect(bytesToBase64(ascii('a'))).toBe('YQ==');
  });

  it('encodes bytes above the ASCII range', () => {
    // UTF-8 for "é" — the case that breaks naive string-based encoders.
    expect(bytesToBase64(Uint8Array.from([0xc3, 0xa9]))).toBe('w6k=');
  });

  it('encodes the full byte range without loss', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(base64ToBytes(bytesToBase64(all))).toEqual(all);
  });
});

describe('base64ToBytes', () => {
  it('decodes an empty input', () => {
    expect(base64ToBytes('')).toEqual(new Uint8Array());
  });

  it('decodes input with no padding', () => {
    expect(base64ToBytes('YWJj')).toEqual(ascii('abc'));
  });

  it('decodes input with one pad character', () => {
    expect(base64ToBytes('YWI=')).toEqual(ascii('ab'));
  });

  it('decodes input with two pad characters', () => {
    expect(base64ToBytes('YQ==')).toEqual(ascii('a'));
  });

  it('decodes to bytes above the ASCII range', () => {
    expect(base64ToBytes('w6k=')).toEqual(Uint8Array.from([0xc3, 0xa9]));
  });
});

describe('round-tripping terminal output', () => {
  it('survives a multi-byte sequence split across two chunks', () => {
    // A single "é" (0xc3 0xa9) arriving as two separate reads. Decoding each
    // chunk as UTF-8 text would corrupt it; byte-level handling must not.
    const first = Uint8Array.from([0xc3]);
    const second = Uint8Array.from([0xa9]);

    const rejoined = Uint8Array.from([
      ...base64ToBytes(bytesToBase64(first)),
      ...base64ToBytes(bytesToBase64(second)),
    ]);

    expect(rejoined).toEqual(Uint8Array.from([0xc3, 0xa9]));
  });

  it('preserves ANSI escape sequences', () => {
    const ESC = String.fromCharCode(27);
    const escape = ascii(`${ESC}[31mred${ESC}[0m`);
    expect(base64ToBytes(bytesToBase64(escape))).toEqual(escape);
  });
});

describe('utf8ToBytes', () => {
  it('encodes ASCII as one byte per character', () => {
    expect(utf8ToBytes('abc')).toEqual(ascii('abc'));
  });

  it('encodes a two-byte character', () => {
    expect(utf8ToBytes('\u00e9')).toEqual(Uint8Array.from([0xc3, 0xa9]));
  });

  it('encodes a three-byte character', () => {
    expect(utf8ToBytes('\u65e5')).toEqual(Uint8Array.from([0xe6, 0x97, 0xa5]));
  });

  it('encodes a four-byte character outside the basic plane', () => {
    // U+1F600, which JavaScript stores as a surrogate pair.
    expect(utf8ToBytes('\u{1f600}')).toEqual(Uint8Array.from([0xf0, 0x9f, 0x98, 0x80]));
  });

  it('survives a round trip through base64', () => {
    const text = 'unicode CJK block';
    expect(base64ToBytes(bytesToBase64(utf8ToBytes(text)))).toEqual(utf8ToBytes(text));
  });
});

describe('base64ToBytes tolerance', () => {
  it('ignores line breaks, since wrapped base64 is common on the wire', () => {
    expect(base64ToBytes('YWJj\nYWJj')).toEqual(ascii('abcabc'));
  });

  it('ignores surrounding whitespace', () => {
    expect(base64ToBytes('  YWJj  ')).toEqual(ascii('abc'));
  });

  it('still rejects a genuinely invalid character', () => {
    expect(() => base64ToBytes('YW!j')).toThrow();
  });
});
