import {
  clampFontSize,
  DEFAULT_SETTINGS,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  parseSettings,
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
    expect(parseSettings({ fontSize: 14, theme: 'mocha', zoomMultipaneWindows: false })).toEqual({
      fontSize: 14,
      theme: 'mocha',
      zoomMultipaneWindows: false,
    });
  });

  it('defaults a file that is not there', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('defaults a file that is not an object, rather than throwing', () => {
    expect(parseSettings('nonsense')).toEqual(DEFAULT_SETTINGS);
  });

  it('reads a missing font size as the Surface picking, not as zero', () => {
    expect(parseSettings({ theme: 'latte' }).fontSize).toBeNull();
  });

  it('clamps a font size from a version with different bounds', () => {
    expect(parseSettings({ fontSize: 400 }).fontSize).toBe(MAX_FONT_SIZE);
  });

  it('falls back to the default Theme for one it does not know', () => {
    expect(parseSettings({ theme: 'solarized' }).theme).toBe('default');
  });

  it('keeps each field independent, so one bad value loses only itself', () => {
    expect(parseSettings({ fontSize: 13, theme: 42, zoomMultipaneWindows: 'yes' })).toEqual({
      fontSize: 13,
      theme: 'default',
      zoomMultipaneWindows: true,
    });
  });
});
