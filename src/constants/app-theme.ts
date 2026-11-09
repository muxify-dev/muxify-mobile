/**
 * The app's chrome colours, and the terminal Themes the user can pick between.
 *
 * Taken from remux, whose screens these copy. Both appearances are here because
 * the chosen Theme decides which one is used: Solarized is a light terminal, and a
 * dark list wrapped around a light terminal reads as two apps stitched
 * together. The phone's own light/dark setting does not come into it — the
 * Theme is the setting.
 */
export interface Appearance {
  /** Behind a grouped list. */
  background: string;
  /** A row sitting on it. */
  rowSurface: string;
  /** Between rows. */
  separator: string;
  /** A section's title, above its rows. */
  sectionHeader: string;
  /** Navigation bar buttons and titles. */
  toolbarTint: string;
  /** Switches, steppers, links: anything the user can act on. */
  controlAccent: string;
  /** A row's leading glyph. */
  rowIcon: string;
  /** Secondary text inside a row. */
  secondaryLabel: string;
  /** Something destructive. */
  destructive: string;
}

export const AppPalettes: Record<'light' | 'dark', Appearance> = {
  dark: {
    background: '#262b36',
    rowSurface: '#363b47',
    separator: '#484d58',
    sectionHeader: '#b8bdcc',
    toolbarTint: '#e8edfa',
    controlAccent: '#63a3ff',
    rowIcon: '#c9d4e8',
    secondaryLabel: '#9aa1b2',
    destructive: '#ff6b6b',
  },
  light: {
    background: '#f2f2f7',
    rowSurface: '#ffffff',
    separator: '#c6c6c8',
    sectionHeader: '#6c6c70',
    toolbarTint: '#000000',
    controlAccent: '#007aff',
    rowIcon: '#6c6c70',
    secondaryLabel: '#8e8e93',
    destructive: '#d70015',
  },
};

/**
 * The Terminal Screen's sheets, which are their own small world of colour.
 *
 * Separate from `Appearance` because a sheet is not a grouped list: it has a
 * well behind the Pane diagram, tiles that are and are not the current one, and
 * a scrim for a label sitting over a preview. None of those have a counterpart
 * in a Form, and borrowing the nearest one gave a sheet that looked like a
 * settings screen that had fallen over.
 */
export interface SheetPalette {
  /** The sheet itself. */
  sheet: string;
  /** Behind the Pane diagram: a well, a shade off the sheet. */
  well: string;
  /** A tile that is not the current one. */
  tile: string;
  /** A tile that is. */
  tileSelected: string;
  stroke: string;
  accent: string;
  primary: string;
  secondary: string;
  /** Behind a label sitting over a preview, so it stays readable. */
  scrim: string;
}

export const SheetPalettes: Record<'light' | 'dark', SheetPalette> = {
  dark: {
    sheet: '#15171d',
    well: '#11131a',
    tile: '#33353c',
    tileSelected: '#232f4c',
    stroke: '#3f424a',
    accent: '#5b8def',
    primary: '#eaeaea',
    secondary: '#9096a3',
    scrim: '#0b0d11',
  },
  light: {
    sheet: '#f4f4f8',
    // A well is *darker* than its sheet in the dark palette and lighter would
    // read as a raised panel here, so it stays darker: a recess is a recess in
    // both appearances.
    well: '#e4e4ec',
    tile: '#ffffff',
    tileSelected: '#dce9ff',
    stroke: '#cfcfd6',
    accent: '#007aff',
    primary: '#1c1c1e',
    secondary: '#6c6c70',
    // Light rather than dark, and nearly opaque: a scrim exists to keep a
    // label readable over a preview, and over light terminal output that means
    // lightening it rather than darkening it.
    scrim: '#ffffff',
  },
};

/** The picker colours a Theme is drawn with. */
export function sheetPaletteFor(theme: ThemeId): SheetPalette {
  return SheetPalettes[appearanceFor(theme)];
}

/** What the Surface is painted with. One of these per Theme. */
export interface TerminalPalette {
  background: string;
  foreground: string;
  cursor: string;
  /** The dim tone the app draws its own terminal-ish text in. */
  dim: string;
  /**
   * The few ANSI colours the Theme preview needs, by their usual names. Not the
   * whole palette: this is a five-line sample, not a terminal.
   */
  blue: string;
  green: string;
  yellow: string;
  /** Bright black — line numbers, and the right half of the status line. */
  grey: string;
  /** ANSI 0 and 7: what the sample's status line is written in. */
  black: string;
  white: string;
}

export type ThemeId = 'default' | 'dracula' | 'solarized';

/**
 * The sixteen colours a terminal application actually paints with.
 *
 * Without these a Theme only reaches the background, the foreground and the
 * cursor — every prompt, every `ls`, every diff keeps ghostty's own colours,
 * and picking Dracula changes almost nothing. Ordered as ANSI has them: the
 * eight normal colours, then the eight bright ones.
 *
 * Omitted for the Default Theme, whose whole point is ghostty's own palette.
 */
export type AnsiPalette = readonly [
  string, string, string, string, string, string, string, string,
  string, string, string, string, string, string, string, string,
];

/**
 * The Themes, in the order the picker shows them.
 *
 * `name` is what the picker segment says; `displayName` is the full name shown
 * beside the preview, because "Solarized" alone does not say which half of it.
 */
export const Themes: Record<ThemeId, {
  name: string;
  displayName: string;
  palette: TerminalPalette;
  ansi?: AnsiPalette;
}> = {
  default: {
    name: 'Default',
    displayName: 'Ghostty Default',
    palette: {
      background: '#11131a',
      foreground: '#e6e6e6',
      cursor: '#5aa9ff',
      dim: '#5a6072',
      blue: '#81a2be',
      green: '#b5bd68',
      yellow: '#f0c674',
      grey: '#666666',
      black: '#1d1f21',
      white: '#c5c8c6',
    },
  },
  dracula: {
    name: 'Dracula',
    displayName: 'Dracula',
    // The official terminal spec: draculatheme.com. Dracula's "blue" is its
    // purple, and the cursor is the foreground, as the spec has them.
    palette: {
      background: '#282a36',
      foreground: '#f8f8f2',
      cursor: '#f8f8f2',
      dim: '#6272a4',
      blue: '#bd93f9',
      green: '#50fa7b',
      yellow: '#f1fa8c',
      grey: '#6272a4',
      black: '#21222c',
      white: '#f8f8f2',
    },
    ansi: [
      '#21222c', '#ff5555', '#50fa7b', '#f1fa8c',
      '#bd93f9', '#ff79c6', '#8be9fd', '#f8f8f2',
      '#6272a4', '#ff6e6e', '#69ff94', '#ffffa5',
      '#d6acff', '#ff92df', '#a4ffff', '#ffffff',
    ],
  },
  solarized: {
    name: 'Solarized',
    displayName: 'Solarized Light',
    // Ethan Schoonover's palette with its standard ANSI mapping, which puts the
    // base tones in the bright slots: bright black is base03, the darkest of
    // them, so line numbers come out near-black on the cream ground. That is
    // how Solarized Light looks in every terminal, not a slip here.
    palette: {
      background: '#fdf6e3',
      foreground: '#657b83',
      cursor: '#657b83',
      dim: '#93a1a1',
      blue: '#268bd2',
      green: '#859900',
      yellow: '#b58900',
      grey: '#002b36',
      black: '#073642',
      white: '#eee8d5',
    },
    ansi: [
      '#073642', '#dc322f', '#859900', '#b58900',
      '#268bd2', '#d33682', '#2aa198', '#eee8d5',
      '#002b36', '#cb4b16', '#586e75', '#657b83',
      '#839496', '#6c71c4', '#93a1a1', '#fdf6e3',
    ],
  },
};

/** The Themes in picker order. */
export const THEME_IDS: ThemeId[] = ['default', 'dracula', 'solarized'];

/**
 * Which appearance a Theme wants the app drawn in.
 *
 * Solarized is the one light terminal, so it is the one light app. This is what
 * makes the Theme picker a light/dark switch as well: there is no separate
 * setting for it, because there is no sensible pairing of a light terminal with
 * dark chrome.
 */
export function appearanceFor(theme: ThemeId): 'light' | 'dark' {
  return theme === 'solarized' ? 'light' : 'dark';
}

/** The chrome colours a Theme is drawn with. */
export function paletteFor(theme: ThemeId): Appearance {
  return AppPalettes[appearanceFor(theme)];
}
