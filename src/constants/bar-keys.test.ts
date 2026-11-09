import { barKeyName, BAR_KEYS, type BarKey } from './bar-keys';
import { NO_MODIFIERS } from '@/lib/modifier-keys';

const key = (over: Partial<BarKey> = {}): BarKey => ({ key: 'Left', label: '←', ...over });

describe('what a Key Bar key sends', () => {
  it('sends the key on its own when nothing is armed', () => {
    expect(barKeyName(key(), NO_MODIFIERS)).toBe('Left');
  });

  it('carries whatever is armed', () => {
    expect(barKeyName(key(), { ctrl: true, alt: false })).toBe('C-Left');
    expect(barKeyName(key(), { ctrl: false, alt: true })).toBe('M-Left');
    expect(barKeyName(key(), { ctrl: true, alt: true })).toBe('C-M-Left');
  });

  it('drops a modifier the key has no form of', () => {
    // Measured on tmux 3.6: `C-Escape` is not a key tmux knows, and send-keys
    // types the eight characters into the Pane rather than refusing. Alt is
    // fine on the same key, so only ctrl is dropped.
    const esc = key({ key: 'Escape', takesCtrl: false });
    expect(barKeyName(esc, { ctrl: true, alt: false })).toBe('Escape');
    expect(barKeyName(esc, { ctrl: true, alt: true })).toBe('M-Escape');
    expect(barKeyName(esc, { ctrl: false, alt: true })).toBe('M-Escape');
  });
});

describe('the bar itself', () => {
  it('offers the keys a phone keyboard does not have', () => {
    const names = BAR_KEYS.map((each) => each.key);
    expect(names).toContain('Escape');
    expect(names).toContain('Tab');
    expect(names).toEqual(expect.arrayContaining(['Left', 'Down', 'Up', 'Right']));
    expect(names).toEqual(expect.arrayContaining(['PageUp', 'PageDown']));
  });

  it('leads with the three a hand reaches for, because only three are on screen', () => {
    expect(BAR_KEYS.slice(0, 3).map((each) => each.label)).toEqual(['ctrl', 'esc', 'tab']);
  });

  it('has both sticky modifiers, and nothing else claiming to be one', () => {
    expect(BAR_KEYS.filter((each) => each.modifier).map((each) => each.modifier)).toEqual([
      'ctrl',
      'alt',
    ]);
  });

  it('calls nothing what the Terminal Screen already calls something else', () => {
    // `press label="Home"` once matched this bar's `home` rather than the
    // Dock's Home button and tapped where the key would have been if the bar
    // were not scrolled — off the capsule entirely. Ambiguous to a reader too:
    // one goes to the Home screen and the other to the start of a line.
    const spoken = BAR_KEYS.map((each) => (each.spoken ?? each.label).toLowerCase());
    for (const taken of ['home', 'back', 'options', 'keyboard', 'panes', 'zoom']) {
      expect(spoken).not.toContain(taken);
    }
  });

  it('gives every glyph a word, so the bar can be read aloud and pressed by name', () => {
    for (const each of BAR_KEYS) {
      expect((each.spoken ?? each.label).trim()).not.toBe('');
      expect(/^[a-z ]+$/.test(each.spoken ?? each.label)).toBe(true);
    }
  });
});
