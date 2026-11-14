import {
  appearanceFor,
  AppPalettes,
  DARK_THEME_IDS,
  LIGHT_THEME_IDS,
  paletteFor,
  Themes,
  THEME_IDS,
} from './app-theme';

describe('appearanceFor', () => {
  it('draws the app in the Theme kind', () => {
    expect(appearanceFor('solarized-light')).toBe('light');
    expect(appearanceFor('gruvbox-light')).toBe('light');
    expect(appearanceFor('ghostty')).toBe('dark');
    expect(appearanceFor('dracula')).toBe('dark');
    expect(appearanceFor('gruvbox-dark-hard')).toBe('dark');
  });

  it('hands back the chrome for that appearance', () => {
    expect(paletteFor('solarized-light')).toBe(AppPalettes.light);
    expect(paletteFor('dracula')).toBe(AppPalettes.dark);
  });
});

describe('Themes', () => {
  it('lists every Theme in the picker of its own kind', () => {
    expect([...THEME_IDS].sort()).toEqual(Object.keys(Themes).sort());
    expect(LIGHT_THEME_IDS.map((id) => Themes[id].displayName)).toEqual(['Solarized Light', 'Gruvbox Light']);
    expect(DARK_THEME_IDS.map((id) => Themes[id].displayName))
      .toEqual(['Ghostty Default', 'Dracula', 'Gruvbox Dark Hard']);
  });

  it('gives every Theme a full terminal palette, so no colour falls back to black', () => {
    for (const id of THEME_IDS) {
      const palette = Themes[id].palette;
      for (const [field, value] of Object.entries(palette)) {
        expect(`${id}.${field}=${value}`).toMatch(/=#[0-9a-f]{6}$/);
      }
    }
  });

  it('calls a Theme light only where its background is light', () => {
    // A light terminal in a dark app reads as two apps stitched together, so
    // the kind has to agree with the colours it paints.
    for (const id of THEME_IDS) {
      const background = Themes[id].palette.background;
      const light = parseInt(background.slice(1, 3), 16) > 0x7f;
      expect(`${id}:${Themes[id].kind}`).toBe(`${id}:${light ? 'light' : 'dark'}`);
    }
  });
});

describe('ANSI palettes', () => {
  it('gives every Theme but Ghostty Default a full sixteen colours', () => {
    // Anything short of sixteen leaves some of the Host's output painted in
    // ghostty's colours and some in the Theme's, which reads as a bug.
    for (const id of THEME_IDS) {
      const { ansi } = Themes[id];
      if (id === 'ghostty') {
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
      expect(theme.ansi[7]).toBe(theme.palette.white);
      expect(theme.ansi[8]).toBe(theme.palette.grey);
    }
  });
});
