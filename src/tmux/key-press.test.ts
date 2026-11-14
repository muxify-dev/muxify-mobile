import { keyNamingFor, renderPress, type KeyNaming, type KeyPress } from './key-press';

function press(spec: string): KeyPress {
  const parts = spec.split('+');
  const key = parts.pop() as string;
  return { key, ctrl: parts.includes('ctrl'), alt: parts.includes('alt'), shift: parts.includes('shift') };
}

function rendered(spec: string, naming: KeyNaming): string {
  const out = renderPress(press(spec), naming);
  return 'key' in out ? out.key : `bytes ${[...out.bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ')}`;
}

describe('keyNamingFor', () => {
  it.each([
    ['3.0a', 'classic'],
    ['3.2a', 'classic'],
    ['3.4', 'classic'],
    ['3.5a', 'extended'],
    ['3.8', 'extended'],
    ['next-3.9', 'extended'],
    ['master', 'extended'],
    ['openbsd-6.8', 'classic'],
    ['', 'classic'],
  ])('reads tmux %p as %s', (version, naming) => {
    expect(keyNamingFor(version)).toBe(naming);
  });
});

// e2e/tmux-keys.test.ts delivers every such press to real tmux: on tmux 3.5a
// and 3.8 every extended name arrives, and on 3.0a to 3.4 every classic one does.
describe('renderPress', () => {
  it.each([
    ['ctrl+r', 'C-r', 'C-r'],
    ['shift+Enter', 'S-Enter', 'Enter'],
    ['ctrl+Enter', 'C-Enter', 'Enter'],
    ['alt+Enter', 'M-Enter', 'M-Enter'],
    ['shift+Tab', 'BTab', 'BTab'],
    ['ctrl+shift+Tab', 'C-BTab', 'Tab'],
    ['ctrl+shift+r', 'C-S-r', 'C-r'],
    ['alt+shift+a', 'M-S-a', 'M-A'],
    ['ctrl+BSpace', 'BSpace', 'BSpace'],
    ['ctrl+Escape', 'Escape', 'Escape'],
    ['ctrl+/', 'C-/', 'bytes 1f'],
    ['ctrl+alt+/', 'C-M-/', 'bytes 1b 1f'],
    ['ctrl+2', 'C-2', 'bytes 00'],
    ['ctrl+;', ';', ';'],
    ['ctrl+Space', 'C-Space', 'C-Space'],
    ['alt+b', 'M-b', 'M-b'],
  ])('%s is %p on tmux 3.5+ and %p before', (spec, extended, classic) => {
    expect(rendered(spec, 'extended')).toBe(extended);
    expect(rendered(spec, 'classic')).toBe(classic);
  });
});
