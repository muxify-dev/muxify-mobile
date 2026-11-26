import {
  clampFontSize,
  DEFAULT_SETTINGS,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  parseSettings,
  resolveTheme,
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
        ligatures: false,
        appearance: 'light',
        lightTheme: 'gruvbox-light',
        darkTheme: 'gruvbox-dark-hard',
        zoomMultipaneWindows: false,
        hostScreenTabs: { host1: 'sessions' },
        reconnectOnStart: true,
        hidePanesPicker: true,
      }),
    ).toEqual({
      fontSize: 14,
      ligatures: false,
      appearance: 'light',
      lightTheme: 'gruvbox-light',
      darkTheme: 'gruvbox-dark-hard',
      zoomMultipaneWindows: false,
      hostScreenTabs: { host1: 'sessions' },
      reconnectOnStart: true,
      hidePanesPicker: true,
    });
  });

  it('keeps empty Quick Action positions and drops repeated or unknown actions in place', () => {
    const raw = { quickActions: {
      ctrl: ['suspend', 'suspend', 'paste', 'interrupt', 'clear-screen'],
      cmd: ['clear-pane', null, 'copy-pane', 'removed-action'],
    } };
    expect(parseSettings(raw).quickActions).toEqual({
      ctrl: ['suspend', null, null, 'interrupt'],
      cmd: ['clear-pane', null, 'copy-pane', null],
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

  it('follows the phone on a fresh install', () => {
    expect(parseSettings({})).toMatchObject({
      appearance: 'system', lightTheme: 'solarized-light', darkTheme: 'ghostty',
    });
  });

  it.each<[unknown, object]>([
    ['solarized', { appearance: 'light', lightTheme: 'solarized-light' }],
    ['default', { appearance: 'dark', darkTheme: 'ghostty' }],
    ['dracula', { appearance: 'dark', darkTheme: 'dracula' }],
    // Mocha and Latte were the dark and light Themes before Dracula and
    // Solarized.
    ['mocha', { appearance: 'dark', darkTheme: 'dracula' }],
    ['latte', { appearance: 'light', lightTheme: 'solarized-light' }],
    ['nord', { appearance: 'system', lightTheme: 'solarized-light', darkTheme: 'ghostty' }],
  ])('keeps the look of a phone whose settings say theme %p', (theme, choice) => {
    const parsed = parseSettings({ theme });
    expect(parsed).toMatchObject(choice);
    expect(parsed).not.toHaveProperty('theme');
  });

  it('reads the appearance setting over a theme from before it', () => {
    expect(parseSettings({ theme: 'solarized', appearance: 'dark', darkTheme: 'dracula' }))
      .toMatchObject({ appearance: 'dark', lightTheme: 'solarized-light', darkTheme: 'dracula' });
  });

  it('refuses a Theme of the wrong kind for its slot', () => {
    expect(parseSettings({ appearance: 'light', lightTheme: 'dracula', darkTheme: 'gruvbox-light' }))
      .toMatchObject({ appearance: 'light', lightTheme: 'solarized-light', darkTheme: 'ghostty' });
  });

  it('keeps each field independent, so one bad value loses only itself', () => {
    expect(
      parseSettings({
        fontSize: 13,
        ligatures: 'no',
        appearance: 'dusk',
        lightTheme: 42,
        darkTheme: 'dracula',
        zoomMultipaneWindows: 'yes',
        hostScreenTabs: 7,
        reconnectOnStart: 'yes',
        hidePanesPicker: 'yes',
      }),
    ).toEqual({
      fontSize: 13,
      ligatures: true,
      appearance: 'system',
      lightTheme: 'solarized-light',
      darkTheme: 'dracula',
      zoomMultipaneWindows: true,
      reconnectOnStart: false,
      hidePanesPicker: false,
    });
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

  it('keeps the last Host Screen tab of each Host, and drops a tab it does not know', () => {
    expect(parseSettings({ hostScreenTabs: { host1: 'sessions', host2: 'board', host3: 'recent', host4: 7 } }).hostScreenTabs)
      .toEqual({ host1: 'sessions', host2: 'board' });
  });

  it('reads the Board tab saved under its old name', () => {
    expect(parseSettings({ hostScreenTabs: { host1: 'topics' } }).hostScreenTabs).toEqual({ host1: 'board' });
  });

  it('carries over none of the Host Screen lists of Configure panels', () => {
    expect(parseSettings({
      hostScreenLists: ['topics', 'recent'],
      recentSessionsFirst: true,
      hostListPreferences: { version: 1, byHost: { host1: ['sessions'] } },
    })).toEqual(DEFAULT_SETTINGS);
  });
});

describe('resolveTheme', () => {
  const choice = { lightTheme: 'gruvbox-light', darkTheme: 'dracula' } as const;

  it.each([
    ['system', 'light', 'gruvbox-light'],
    ['system', 'dark', 'dracula'],
    ['light', 'dark', 'gruvbox-light'],
    ['dark', 'light', 'dracula'],
  ] as const)('with appearance %s on a %s phone, uses %s', (appearance, phone, theme) => {
    expect(resolveTheme({ ...choice, appearance }, phone)).toBe(theme);
  });
});
