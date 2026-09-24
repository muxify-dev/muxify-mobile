import { appearanceFor, AppPalettes, paletteFor, Themes, THEME_IDS } from './app-theme';

describe('appearanceFor', () => {
  it('draws the app light for the one light terminal', () => {
    expect(appearanceFor('latte')).toBe('light');
  });

  it('draws it dark for the dark ones', () => {
    expect(appearanceFor('default')).toBe('dark');
    expect(appearanceFor('mocha')).toBe('dark');
  });

  it('hands back the chrome for that appearance', () => {
    expect(paletteFor('latte')).toBe(AppPalettes.light);
    expect(paletteFor('mocha')).toBe(AppPalettes.dark);
  });
});

describe('Themes', () => {
  it('has one for every id the picker offers', () => {
    expect(THEME_IDS.map((id) => Themes[id].name)).toEqual(['Default', 'Mocha', 'Latte']);
  });

  it('gives every Theme a full terminal palette, so no colour falls back to black', () => {
    for (const id of THEME_IDS) {
      const palette = Themes[id].palette;
      for (const [field, value] of Object.entries(palette)) {
        expect(`${id}.${field}=${value}`).toMatch(/=#[0-9a-f]{6}$/);
      }
    }
  });

  it('keeps the app light only where the terminal is light', () => {
    // A light terminal in a dark app reads as two apps stitched together, so
    // these two have to agree; this catches a Theme added without an appearance.
    for (const id of THEME_IDS) {
      const background = Themes[id].palette.background;
      const light = parseInt(background.slice(1, 3), 16) > 0x7f;
      expect(appearanceFor(id)).toBe(light ? 'light' : 'dark');
    }
  });
});

describe('ANSI palettes', () => {
  it('gives every Theme but Default a full sixteen colours', () => {
    // Anything short of sixteen leaves some of the Host's output painted in
    // ghostty's colours and some in the Theme's, which reads as a bug.
    for (const id of THEME_IDS) {
      const { ansi } = Themes[id];
      if (id === 'default') {
        expect(ansi).toBeUndefined();
        continue;
      }
      expect(ansi).toHaveLength(16);
      for (const colour of ansi ?? []) {
        expect(colour).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it('keeps the preview and the terminal telling the same story', () => {
    // The preview names a few colours by hand; if they drifted from the real
    // palette the Settings screen would advertise a Theme nobody gets.
    for (const id of THEME_IDS) {
      const theme = Themes[id];
      if (!theme.ansi) continue;
      expect(theme.ansi[2]).toBe(theme.palette.green);
      expect(theme.ansi[3]).toBe(theme.palette.yellow);
      expect(theme.ansi[4]).toBe(theme.palette.blue);
      expect(theme.ansi[0]).toBe(theme.palette.black);
      expect(theme.ansi[8]).toBe(theme.palette.grey);
    }
  });
});
