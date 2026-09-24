/**
 * The app's chrome colours, and the terminal Themes the user can pick between.
 *
 * Taken from remux, whose palette these screens copy. Given as flat hex rather
 * than the system's semantic colours because the app is dark whatever the phone
 * is: the Surface is dark, and a light list behind a dark terminal reads as two
 * apps. The light halves of remux's dynamic colours are therefore dropped.
 */
export const AppPalette = {
  /** Behind a grouped list. */
  background: '#262b36',
  /** A row sitting on it. */
  rowSurface: '#363b47',
  /** Between rows. White at 8%, flattened onto rowSurface. */
  separator: '#484d58',
  /** A section's title, above its rows. */
  sectionHeader: '#b8bdcc',
  /** Navigation bar buttons and titles. */
  toolbarTint: '#e8edfa',
  /** Switches, steppers, links: anything the user can act on. */
  controlAccent: '#63a3ff',
  /** A row's leading glyph, and the disc behind it. */
  rowIcon: '#c9d4e8',
  rowIconSurface: '#424653',
  /** Secondary text inside a row. */
  secondaryLabel: '#9aa1b2',
  /** Something destructive. */
  destructive: '#ff6b6b',
} as const;

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
}

export type ThemeId = 'default' | 'mocha' | 'latte';

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
    },
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
    },
  },
};

/** The Themes in picker order. */
export const THEME_IDS: ThemeId[] = ['default', 'mocha', 'latte'];
