import type { ThemeId } from '@/constants/app-theme';

/**
 * What the user can change about the terminal.
 *
 * Small on purpose: every one of these changes what the Surface looks like, so
 * each has to be carried through to it. A setting that cannot be seen is not
 * worth a row.
 */
export interface Settings {
  /**
   * The Surface's font size, or null to let the Surface pick. Null is not a
   * number in disguise: "whatever suits the phone" is a different answer from
   * "ten", and it survives the user changing phones.
   */
  fontSize: number | null;
  theme: ThemeId;
  /**
   * Whether a Session with several Panes arrives with its active Pane filling
   * the Window. A phone is too narrow to read two Panes side by side, so this
   * starts on.
   */
  zoomMultipaneWindows: boolean;
}

export const MIN_FONT_SIZE = 5;
export const MAX_FONT_SIZE = 24;
/** Where the stepper starts when the user first turns the default off. */
export const DEFAULT_EXPLICIT_FONT_SIZE = 10;

export const DEFAULT_SETTINGS: Settings = {
  fontSize: null,
  theme: 'default',
  zoomMultipaneWindows: true,
};

/** Keeps a font size inside what the Surface will accept. */
export function clampFontSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_EXPLICIT_FONT_SIZE;
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(size)));
}

/**
 * The Theme a saved value names, or the default for one it does not know.
 *
 * Mocha and Latte are the Catppuccin pair this app shipped with before Dracula
 * and Solarized replaced them. A phone that chose one of those chose a dark or
 * a light terminal, and that choice is kept: the replacement of the same
 * appearance, rather than a fall back to the default that would turn a light
 * app dark on update.
 */
function parseTheme(theme: unknown): ThemeId {
  switch (theme) {
    case 'dracula':
    case 'solarized':
      return theme;
    case 'mocha':
      return 'dracula';
    case 'latte':
      return 'solarized';
    default:
      return 'default';
  }
}

/**
 * Reads settings back off disk, taking what it recognises and defaulting the
 * rest.
 *
 * Every field is checked rather than trusted: this file is the app's own, but a
 * half-written one after a crash, or one from a version that knew different
 * settings, must not leave the terminal unusable.
 */
export function parseSettings(raw: unknown): Settings {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_SETTINGS;
  const record = raw as Record<string, unknown>;

  const fontSize = record.fontSize;
  const theme = record.theme;
  const zoom = record.zoomMultipaneWindows;

  return {
    fontSize: typeof fontSize === 'number' ? clampFontSize(fontSize) : null,
    theme: parseTheme(theme),
    zoomMultipaneWindows:
      typeof zoom === 'boolean' ? zoom : DEFAULT_SETTINGS.zoomMultipaneWindows,
  };
}
