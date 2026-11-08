import {
  clampFontSize,
  DEFAULT_SETTINGS,
  hostScreenListRows,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  moveHostScreenLists,
  parseSettings,
  switchHostScreenList,
  type HostScreenLists,
} from './settings';

describe('clampFontSize', () => {
  it('keeps a size the Surface will accept', () => {
    expect(clampFontSize(12)).toBe(12);
  });

  it('pulls a size back inside the bounds rather than refusing it', () => {
    expect(clampFontSize(MIN_FONT_SIZE - 3)).toBe(MIN_FONT_SIZE);
    expect(clampFontSize(MAX_FONT_SIZE + 9)).toBe(MAX_FONT_SIZE);
  });

  it('rounds, because the stepper is whole numbers and the file may not be', () => {
    expect(clampFontSize(11.6)).toBe(12);
  });

  it('falls back for a number that is not one', () => {
    expect(clampFontSize(Number.NaN)).toBe(10);
  });
});

describe('parseSettings', () => {
  it('reads settings written by this version', () => {
    expect(
      parseSettings({
        fontSize: 14,
        theme: 'dracula',
        zoomMultipaneWindows: false,
        hostScreenLists: ['topics', 'sessions'],
      }),
    ).toEqual({
      fontSize: 14,
      theme: 'dracula',
      zoomMultipaneWindows: false,
      hostScreenLists: ['topics', 'sessions'],
    });
  });

  it('defaults a file that is not there', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('defaults a file that is not an object, rather than throwing', () => {
    expect(parseSettings('nonsense')).toEqual(DEFAULT_SETTINGS);
  });

  it('reads a missing font size as the Surface picking, not as zero', () => {
    expect(parseSettings({ theme: 'solarized' }).fontSize).toBeNull();
  });

  it('clamps a font size from a version with different bounds', () => {
    expect(parseSettings({ fontSize: 400 }).fontSize).toBe(MAX_FONT_SIZE);
  });

  it('falls back to the default Theme for one it does not know', () => {
    expect(parseSettings({ theme: 'nord' }).theme).toBe('default');
  });

  it('carries a Catppuccin choice over to the Theme of the same appearance', () => {
    // Mocha and Latte were the dark and light Themes before Dracula and
    // Solarized; a phone that picked the light one should not turn dark on
    // update.
    expect(parseSettings({ theme: 'mocha' }).theme).toBe('dracula');
    expect(parseSettings({ theme: 'latte' }).theme).toBe('solarized');
  });

  it('keeps each field independent, so one bad value loses only itself', () => {
    expect(
      parseSettings({ fontSize: 13, theme: 42, zoomMultipaneWindows: 'yes', hostScreenLists: 7 }),
    ).toEqual({
      fontSize: 13,
      theme: 'default',
      zoomMultipaneWindows: true,
      hostScreenLists: ['sessions'],
    });
  });

  it.each<[string, unknown, HostScreenLists]>([
    ['missing, as in a file from before the setting', undefined, ['sessions']],
    ['not an array', 'topics', ['sessions']],
    ['empty', [], ['sessions']],
    ['only unknown entries', ['bench', 3, null], ['sessions']],
    ['one list', ['topics'], ['topics']],
    ['both lists, in their order', ['topics', 'sessions'], ['topics', 'sessions']],
    ['unknown entries among known ones', ['bench', 'topics', 42], ['topics']],
    [
      'a repeated entry, kept where it first came',
      ['topics', 'sessions', 'topics'],
      ['topics', 'sessions'],
    ],
  ])('reads Host Screen lists that are %s', (_, saved, lists) => {
    expect(parseSettings({ hostScreenLists: saved }).hostScreenLists).toEqual(lists);
  });
});

describe('Host Screen lists in Settings', () => {
  it.each<[HostScreenLists, string[]]>([
    [['sessions'], ['sessions', 'topics']],
    [['topics'], ['topics', 'sessions']],
    [['topics', 'sessions'], ['topics', 'sessions']],
  ])('shows %j as the rows %j: the lists that are on, then the rest', (lists, rows) => {
    expect(hostScreenListRows(lists)).toEqual(rows);
  });

  it('turns a list on at the bottom of the Host Screen', () => {
    expect(switchHostScreenList(['sessions'], 'topics', true)).toEqual(['sessions', 'topics']);
  });

  it('turns a list off', () => {
    expect(switchHostScreenList(['topics', 'sessions'], 'topics', false)).toEqual(['sessions']);
  });

  it('keeps the last list on', () => {
    expect(switchHostScreenList(['topics'], 'topics', false)).toEqual(['topics']);
  });

  it('moves a list that is on above another', () => {
    expect(moveHostScreenLists(['sessions', 'topics'], [1], 0)).toEqual(['topics', 'sessions']);
    expect(moveHostScreenLists(['sessions', 'topics'], [0], 2)).toEqual(['topics', 'sessions']);
  });

  it('gives a list that is off no place, so moving it changes nothing', () => {
    expect(moveHostScreenLists(['sessions'], [1], 0)).toEqual(['sessions']);
    expect(moveHostScreenLists(['sessions'], [0], 2)).toEqual(['sessions']);
  });
});
