/**
 * The app's chrome colours, and the terminal Themes the user can pick between.
 *
 * Taken from remux, whose screens these copy. Both appearances are here because
 * the chosen Theme decides which one is used: Latte is a light terminal, and a
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

export type ThemeId = 'default' | 'mocha' | 'latte';

/**
 * The sixteen colours a terminal application actually paints with.
 *
 * Without these a Theme only reaches the background, the foreground and the
 * cursor — every prompt, every `ls`, every diff keeps ghostty's own colours,
 * and picking Mocha changes almost nothing. Ordered as ANSI has them: the
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
 * beside the preview, because "Mocha" alone does not tell you it is Catppuccin.
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
  mocha: {
    name: 'Mocha',
    displayName: 'Catppuccin Mocha',
    palette: {
      background: '#1e1e2e',
      foreground: '#cdd6f4',
      cursor: '#f5e0dc',
      dim: '#6c7086',
      blue: '#89b4fa',
      green: '#a6e3a1',
      yellow: '#f9e2af',
      grey: '#585b70',
      black: '#45475a',
      white: '#a6adc8',
    },
    ansi: [
      '#45475a', '#f38ba8', '#a6e3a1', '#f9e2af',
      '#89b4fa', '#f5c2e7', '#94e2d5', '#bac2de',
      '#585b70', '#f38ba8', '#a6e3a1', '#f9e2af',
      '#89b4fa', '#f5c2e7', '#94e2d5', '#a6adc8',
    ],
  },
  latte: {
    name: 'Latte',
    displayName: 'Catppuccin Latte',
    palette: {
      background: '#eff1f5',
      foreground: '#4c4f69',
      cursor: '#dc8a78',
      dim: '#8c8fa1',
      blue: '#1e66f5',
      green: '#40a02b',
      yellow: '#df8e1d',
      grey: '#6c6f85',
      black: '#5c5f77',
      white: '#acb0be',
    },
    ansi: [
      '#5c5f77', '#d20f39', '#40a02b', '#df8e1d',
      '#1e66f5', '#ea76cb', '#179299', '#acb0be',
      '#6c6f85', '#d20f39', '#40a02b', '#df8e1d',
      '#1e66f5', '#ea76cb', '#179299', '#bcc0cc',
    ],
  },
};

/** The Themes in picker order. */
export const THEME_IDS: ThemeId[] = ['default', 'mocha', 'latte'];

/**
 * Which appearance a Theme wants the app drawn in.
 *
 * Latte is the one light terminal, so it is the one light app. This is what
 * makes the Theme picker a light/dark switch as well: there is no separate
 * setting for it, because there is no sensible pairing of a light terminal with
 * dark chrome.
 */
export function appearanceFor(theme: ThemeId): 'light' | 'dark' {
  return theme === 'latte' ? 'light' : 'dark';
}

/** The chrome colours a Theme is drawn with. */
export function paletteFor(theme: ThemeId): Appearance {
  return AppPalettes[appearanceFor(theme)];
}
