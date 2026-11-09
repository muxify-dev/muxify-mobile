import {
  clampFontSize,
  DEFAULT_SETTINGS,
  hostScreenListRows,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  moveHostScreenLists,
  mustStayOn,
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
        hostScreenLists: ['topics', 'recent', 'sessions'],
        reconnectOnStart: true,
        showStatusLines: false,
      }),
    ).toEqual({
      fontSize: 14,
      theme: 'dracula',
      zoomMultipaneWindows: false,
      hostScreenLists: ['topics', 'recent', 'sessions'],
      reconnectOnStart: true,
      showStatusLines: false,
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
      parseSettings({
        fontSize: 13,
        theme: 42,
        zoomMultipaneWindows: 'yes',
        hostScreenLists: 7,
        reconnectOnStart: 'yes',
        showStatusLines: 'off',
      }),
    ).toEqual({
      fontSize: 13,
      theme: 'default',
      zoomMultipaneWindows: true,
      hostScreenLists: ['recent', 'sessions'],
      reconnectOnStart: false,
      showStatusLines: true,
    });
  });

  it('keeps the Status Lines on for settings saved before they could be hidden', () => {
    expect(parseSettings({ theme: 'dracula' }).showStatusLines).toBe(true);
  });

  it.each<[string, unknown, boolean]>([
    ['missing, as in a file from before the setting', undefined, false],
    ['not a boolean', 'true', false],
    ['null', null, false],
    ['off', false, false],
    ['on', true, true],
  ])('reads Reconnect on start that is %s', (_, saved, on) => {
    expect(parseSettings({ reconnectOnStart: saved }).reconnectOnStart).toBe(on);
  });

  it.each<[string, unknown, HostScreenLists]>([
    ['missing', undefined, ['recent', 'sessions']],
    ['not an array', 'topics', ['recent', 'sessions']],
    ['empty', [], ['recent', 'sessions']],
    ['only unknown entries', ['bench', 3, null], ['recent', 'sessions']],
    ['only Recent Sessions, which cannot reach every Session', ['recent'], ['recent', 'sessions']],
    ['one list', ['topics'], ['topics']],
    ['every list, in their order', ['topics', 'sessions', 'recent'], ['topics', 'sessions', 'recent']],
    ['unknown entries among known ones', ['bench', 'topics', 42], ['topics']],
    [
      'a repeated entry, kept where it first came',
      ['topics', 'sessions', 'topics'],
      ['topics', 'sessions'],
    ],
  ])('reads Host Screen lists that are %s', (_, saved, lists) => {
    expect(parseSettings({ hostScreenLists: saved }).hostScreenLists).toEqual(lists);
  });

  // Settings saved before Recent Sessions was a list of its own. With Recent
  // Sessions first on, the Sessions list was two sections, the Recent ones on
  // top, so the Host Screen looks the same after the update.
  it.each<[string, Record<string, unknown>, HostScreenLists]>([
    [
      'Recent Sessions first on',
      { hostScreenLists: ['sessions'], recentSessionsFirst: true },
      ['recent', 'sessions'],
    ],
    [
      'Recent Sessions first on, below Topics',
      { hostScreenLists: ['topics', 'sessions'], recentSessionsFirst: true },
      ['topics', 'recent', 'sessions'],
    ],
    [
      'Recent Sessions first off',
      { hostScreenLists: ['sessions', 'topics'], recentSessionsFirst: false },
      ['sessions', 'topics'],
    ],
    [
      'Recent Sessions first on with the Sessions list off',
      { hostScreenLists: ['topics'], recentSessionsFirst: true },
      ['topics'],
    ],
    [
      'Recent Sessions first off, from before the lists could be chosen',
      { recentSessionsFirst: false },
      ['sessions'],
    ],
  ])('moves over settings saved with %s', (_, saved, lists) => {
    expect(parseSettings(saved).hostScreenLists).toEqual(lists);
  });
});

describe('Host Screen lists in Settings', () => {
  it.each<[HostScreenLists, string[]]>([
    [['sessions'], ['sessions', 'recent', 'topics']],
    [['topics'], ['topics', 'recent', 'sessions']],
    [['topics', 'recent', 'sessions'], ['topics', 'recent', 'sessions']],
  ])('shows %j as the rows %j: the lists that are on, then the rest', (lists, rows) => {
    expect(hostScreenListRows(lists)).toEqual(rows);
  });

  it('turns a list on at the bottom of the Host Screen', () => {
    expect(switchHostScreenList(['sessions'], 'topics', true)).toEqual(['sessions', 'topics']);
  });

  it('turns a list off', () => {
    expect(switchHostScreenList(['topics', 'sessions'], 'topics', false)).toEqual(['sessions']);
  });

  it('turns Recent Sessions off whatever else is on', () => {
    expect(switchHostScreenList(['recent', 'topics'], 'recent', false)).toEqual(['topics']);
  });

  it.each<[HostScreenLists, 'sessions' | 'topics']>([
    [['topics'], 'topics'],
    [['recent', 'sessions'], 'sessions'],
    [['topics', 'recent'], 'topics'],
  ])('keeps %j on with %s, the last list that reaches every Session', (lists, list) => {
    expect(switchHostScreenList(lists, list, false)).toEqual(lists);
    expect(mustStayOn(lists, list)).toBe(true);
  });

  it('lets either of Sessions and Topics go while the other is on', () => {
    expect(mustStayOn(['sessions', 'topics'], 'sessions')).toBe(false);
    expect(mustStayOn(['recent', 'sessions'], 'recent')).toBe(false);
  });

  it('moves a list that is on above another', () => {
    expect(moveHostScreenLists(['sessions', 'topics'], [1], 0)).toEqual(['topics', 'sessions']);
    expect(moveHostScreenLists(['sessions', 'topics'], [0], 2)).toEqual(['topics', 'sessions']);
  });

  it('moves one of three lists to the top', () => {
    expect(moveHostScreenLists(['topics', 'sessions', 'recent'], [2], 0)).toEqual([
      'recent',
      'topics',
      'sessions',
    ]);
  });

  it('gives a list that is off no place, so moving it changes nothing', () => {
    expect(moveHostScreenLists(['sessions'], [1], 0)).toEqual(['sessions']);
    expect(moveHostScreenLists(['sessions'], [0], 2)).toEqual(['sessions']);
  });
});
