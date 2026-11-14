import {
  ARROW_KEYS,
  COMMAND_KEY,
  LEFT_KEYS,
  PAIR_KEYS,
  type RowKey,
} from './row-keys';

const ALL_KEYS: RowKey[] = [...LEFT_KEYS, ...PAIR_KEYS, ...Object.values(ARROW_KEYS), COMMAND_KEY];

describe('the Key Row itself', () => {
  it('has escape, control, option and tab at the left', () => {
    expect(LEFT_KEYS.map((each) => each.label)).toEqual(['⎋', '⌃', '⌥', '⇥']);
  });

  it('has the twelve pairs in the middle, main symbol first', () => {
    expect(PAIR_KEYS.map((each) => `${each.main} ${each.alternate}`)).toEqual([
      '- _', ': |', '/ \\', "~ '", '[ ]', '{ }', '< >', '( )', '" `', '= +', '* &', '$ #',
    ]);
  });

  it('has the four arrows and command at the right', () => {
    expect(Object.values(ARROW_KEYS).map((each) => each.key).sort()).toEqual([
      'Down', 'Left', 'Right', 'Up',
    ]);
    expect(COMMAND_KEY.label).toBe('⌘');
  });

  it('has no page up, page down, home or end', () => {
    const named = ALL_KEYS.flatMap((each) => (each.kind === 'named' ? [each.key] : []));
    for (const gone of ['PageUp', 'PageDown', 'Home', 'End']) expect(named).not.toContain(gone);
  });

  it('gives every key lowercase words, so it can be read aloud and pressed by name', () => {
    for (const each of ALL_KEYS) expect(each.spoken).toMatch(/^[a-z]+( [a-z]+)*$/);
    expect(new Set(ALL_KEYS.map((each) => each.spoken)).size).toBe(ALL_KEYS.length);
  });

  it('calls nothing what the Terminal Screen already calls something else', () => {
    // `press label="Home"` once matched a key named `home` rather than the
    // Home button, and tapped where the key would have been.
    const spoken = ALL_KEYS.map((each) => each.spoken);
    for (const taken of ['home', 'back', 'options', 'zoom', 'panes', 'keyboard']) {
      expect(spoken).not.toContain(taken);
    }
  });
});
