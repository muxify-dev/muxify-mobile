import type { ThemeId } from '@/constants/app-theme';

/**
 * What the user can change about the terminal and the Host Screen.
 *
 * Small on purpose: every one of these changes what the user sees, so each has
 * to be carried through to a screen. A setting that cannot be seen is not
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
  /**
   * Which lists the Host Screen shows, top to bottom. One array holds both
   * the order and which lists are on: a list that is off has no place in it.
   * Never empty, so a setting cannot leave a Host Screen with nothing on it.
   */
  hostScreenLists: HostScreenLists;
  /**
   * Whether the Sessions list puts the Sessions this phone opened at the top.
   * Off, it keeps the Host's own order, the order the Mac shows.
   */
  recentSessionsFirst: boolean;
  /**
   * Whether a cold start opens the Last Place again, if there is one. Off by
   * default: an app that connects to a machine on launch is a surprise
   * nobody asked for.
   */
  reconnectOnStart: boolean;
  /**
   * Whether the Terminal Screen shows its Status Lines. On by default, as they
   * were before they could be hidden. Off loses nothing about the Connection:
   * the Banner reports every state other than connected.
   */
  showStatusLines: boolean;
}

/** Every list the Host Screen can show, in the order Settings offers the ones that are off. */
export const HOST_SCREEN_LISTS = ['sessions', 'topics'] as const;
export type HostScreenList = (typeof HOST_SCREEN_LISTS)[number];
export type HostScreenLists = readonly [HostScreenList, ...HostScreenList[]];

export const MIN_FONT_SIZE = 5;
export const MAX_FONT_SIZE = 24;
/** Where the stepper starts when the user first turns the default off. */
export const DEFAULT_EXPLICIT_FONT_SIZE = 10;

export const DEFAULT_SETTINGS: Settings = {
  fontSize: null,
  theme: 'default',
  zoomMultipaneWindows: true,
  hostScreenLists: ['sessions'],
  recentSessionsFirst: true,
  reconnectOnStart: false,
  showStatusLines: true,
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

/** The lists in the order given, or null for none. */
function nonEmpty(lists: readonly HostScreenList[]): HostScreenLists | null {
  const [first, ...rest] = lists;
  return first === undefined ? null : [first, ...rest];
}

/**
 * The Host Screen lists a saved value names: the known ones, each once, in
 * the saved order. A value that names none of them is the default, because a
 * Host Screen with no list on it is not a choice the user can make.
 */
function parseHostScreenLists(raw: unknown): HostScreenLists {
  if (!Array.isArray(raw)) return DEFAULT_SETTINGS.hostScreenLists;
  const known = raw.filter((entry): entry is HostScreenList =>
    (HOST_SCREEN_LISTS as readonly unknown[]).includes(entry),
  );
  return nonEmpty([...new Set(known)]) ?? DEFAULT_SETTINGS.hostScreenLists;
}

/**
 * The rows of the Host Screen section in Settings: the lists that are on, in
 * their order, then the ones that are off.
 */
export function hostScreenListRows(lists: HostScreenLists): HostScreenList[] {
  return [...lists, ...HOST_SCREEN_LISTS.filter((list) => !lists.includes(list))];
}

/**
 * Turns one list on, at the bottom of the Host Screen, or off. The last list
 * that is on stays on: Settings disables its switch, and this keeps the rule
 * if a switch is pressed anyway.
 */
export function switchHostScreenList(
  lists: HostScreenLists,
  list: HostScreenList,
  on: boolean,
): HostScreenLists {
  const others = lists.filter((candidate) => candidate !== list);
  if (on) return nonEmpty([...others, list]) ?? lists;
  return nonEmpty(others) ?? lists;
}

/**
 * The lists that are on after the user drags rows of the Host Screen section,
 * with SwiftUI's move: `destination` is a row index from before the move.
 * A list that is off has no place to keep, so dragging one changes nothing.
 */
export function moveHostScreenLists(
  lists: HostScreenLists,
  sources: number[],
  destination: number,
): HostScreenLists {
  const rows = hostScreenListRows(lists);
  const moving = rows.filter((_, at) => sources.includes(at));
  const before = rows.filter((_, at) => at < destination && !sources.includes(at));
  const after = rows.filter((_, at) => at >= destination && !sources.includes(at));
  const moved = [...before, ...moving, ...after].filter((list) => lists.includes(list));
  return nonEmpty(moved) ?? lists;
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
  const recentFirst = record.recentSessionsFirst;
  const reconnect = record.reconnectOnStart;
  const statusLines = record.showStatusLines;

  return {
    fontSize: typeof fontSize === 'number' ? clampFontSize(fontSize) : null,
    theme: parseTheme(theme),
    zoomMultipaneWindows:
      typeof zoom === 'boolean' ? zoom : DEFAULT_SETTINGS.zoomMultipaneWindows,
    hostScreenLists: parseHostScreenLists(record.hostScreenLists),
    recentSessionsFirst:
      typeof recentFirst === 'boolean' ? recentFirst : DEFAULT_SETTINGS.recentSessionsFirst,
    reconnectOnStart:
      typeof reconnect === 'boolean' ? reconnect : DEFAULT_SETTINGS.reconnectOnStart,
    showStatusLines:
      typeof statusLines === 'boolean' ? statusLines : DEFAULT_SETTINGS.showStatusLines,
  };
}
