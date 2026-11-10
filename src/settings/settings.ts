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
   * Legacy list choice, retained until migration copies it to existing Hosts.
   * Domain list builders also accept this shape for one resolved Host.
   */
  hostScreenLists: HostScreenLists;
  hostListPreferences?: {
    version: 1;
    byHost: Readonly<Record<string, HostScreenLists>>;
  };
  /**
   * Whether a cold start opens the Last Place again, if there is one. Off by
   * default: an app that connects to a machine on launch is a surprise
   * nobody asked for.
   */
  reconnectOnStart: boolean;
  chooserListPreferences?: Readonly<Record<string, ChooserLists>>;
}

/** Every list the Host Screen can show, in the order Settings offers the ones that are off. */
export const HOST_SCREEN_LISTS = ['recent', 'sessions', 'topics'] as const;
export type HostScreenList = (typeof HOST_SCREEN_LISTS)[number];
export type HostScreenLists = readonly [HostScreenList, ...HostScreenList[]];

export const CHOOSER_LISTS = ['windows', 'sessions', 'topics'] as const;
export type ChooserList = (typeof CHOOSER_LISTS)[number];
export type ChooserLists = readonly [ChooserList, ...ChooserList[]];
export const DEFAULT_CHOOSER_LISTS: ChooserLists = ['windows'];
export const CHOOSER_LIST_NAMES: Record<ChooserList, string> = {
  windows: 'Windows', sessions: 'Sessions', topics: 'Topics',
};

function parseChooserLists(raw: unknown): ChooserLists {
  const lists = Array.isArray(raw) ? [...new Set(raw.filter((item): item is ChooserList =>
    (CHOOSER_LISTS as readonly unknown[]).includes(item)))] : [];
  const [first, ...rest] = lists;
  return first === undefined ? DEFAULT_CHOOSER_LISTS : [first, ...rest];
}

export function chooserListsFor(settings: Settings, hostId: string): ChooserLists {
  const preferences = settings.chooserListPreferences;
  return preferences && Object.hasOwn(preferences, hostId) ? preferences[hostId] : DEFAULT_CHOOSER_LISTS;
}

export function chooserListRows(lists: ChooserLists): ChooserList[] {
  return [...lists, ...CHOOSER_LISTS.filter((list) => !lists.includes(list))];
}

export function switchChooserList(lists: ChooserLists, list: ChooserList, on: boolean): ChooserLists {
  if (lists.includes(list) === on) return lists;
  const next = on ? [...lists, list] : lists.filter((item) => item !== list);
  const [first, ...rest] = next;
  return first === undefined ? lists : [first, ...rest];
}

export function moveChooserLists(lists: ChooserLists, sources: number[], destination: number): ChooserLists {
  const rows = chooserListRows(lists);
  const moving = rows.filter((_, index) => sources.includes(index));
  const before = rows.filter((_, index) => index < destination && !sources.includes(index));
  const after = rows.filter((_, index) => index >= destination && !sources.includes(index));
  return parseChooserLists([...before, ...moving, ...after].filter((list) => lists.includes(list)));
}

export function hostCreationOrder(lists: HostScreenLists): ('sessions' | 'topics')[] {
  const enabled = lists.filter((list): list is 'sessions' | 'topics' => list !== 'recent');
  return [...enabled, ...(['sessions', 'topics'] as const).filter((list) => !enabled.includes(list))];
}

export const MIN_FONT_SIZE = 5;
export const MAX_FONT_SIZE = 24;
/** Where the stepper starts when the user first turns the default off. */
export const DEFAULT_EXPLICIT_FONT_SIZE = 10;
/** What the Surface uses when the user has not picked a size. */
export const DEFAULT_FONT_SIZE = 13;

export const DEFAULT_SETTINGS: Settings = {
  fontSize: null,
  theme: 'default',
  zoomMultipaneWindows: true,
  hostScreenLists: ['recent', 'sessions'],
  reconnectOnStart: false,
};

/** Keeps a font size inside what the Surface will accept. */
export function clampFontSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_EXPLICIT_FONT_SIZE;
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(size)));
}

/** The size the Surface draws at: the user's, or the default while there is none. */
export function fontSizeInForce(fontSize: number | null): number {
  return fontSize ?? DEFAULT_FONT_SIZE;
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
 * The lists that reach every Session of a Host. Recent Sessions is not one: on
 * a Host this phone has never opened a Session of, it is empty.
 */
const REACH_EVERY_SESSION: readonly HostScreenList[] = ['sessions', 'topics'];

/** The lists in the order given, or null when none of them reaches every Session. */
function reachable(lists: readonly HostScreenList[]): HostScreenLists | null {
  const [first, ...rest] = lists;
  if (first === undefined) return null;
  return lists.some((list) => REACH_EVERY_SESSION.includes(list)) ? [first, ...rest] : null;
}

/** Whether this list is on and turning it off would leave no way to every Session. */
export function mustStayOn(lists: HostScreenLists, list: HostScreenList): boolean {
  return lists.includes(list) && reachable(lists.filter((other) => other !== list)) === null;
}

/**
 * The Host Screen lists a saved value names: the known ones, each once, in
 * the saved order. A value with no list that reaches every Session is the
 * default, because that Host Screen is not a choice the user can make.
 *
 * Settings saved before Recent Sessions was a list of their own say
 * `recentSessionsFirst` instead. On, the Sessions list was drawn with the
 * Recent Sessions above the rest, so Recent Sessions goes in just above
 * Sessions and the Host Screen looks as it did.
 */
function parseHostScreenLists(raw: unknown, recentSessionsFirst: unknown): HostScreenLists {
  const saved = Array.isArray(raw)
    ? [
        ...new Set(
          raw.filter((entry): entry is HostScreenList =>
            (HOST_SCREEN_LISTS as readonly unknown[]).includes(entry),
          ),
        ),
      ]
    : null;
  if (typeof recentSessionsFirst === 'boolean' && !saved?.includes('recent')) {
    // Before the lists could be chosen, the Host Screen was the Sessions list.
    const before = saved ?? ['sessions'];
    const lists = recentSessionsFirst
      ? before.flatMap((list): HostScreenList[] => (list === 'sessions' ? ['recent', list] : [list]))
      : before;
    return reachable(lists) ?? DEFAULT_SETTINGS.hostScreenLists;
  }
  return (saved && reachable(saved)) ?? DEFAULT_SETTINGS.hostScreenLists;
}

/**
 * The rows of the Host Screen section in Settings: the lists that are on, in
 * their order, then the ones that are off.
 */
export function hostScreenListRows(lists: HostScreenLists): HostScreenList[] {
  return [...lists, ...HOST_SCREEN_LISTS.filter((list) => !lists.includes(list))];
}

/**
 * Turns one list on, at the bottom of the Host Screen, or off. Sessions or
 * Topics stays on (see mustStayOn): Settings disables that switch, and this
 * keeps the rule if a switch is pressed anyway.
 */
export function switchHostScreenList(
  lists: HostScreenLists,
  list: HostScreenList,
  on: boolean,
): HostScreenLists {
  const others = lists.filter((candidate) => candidate !== list);
  return reachable(on ? [...others, list] : others) ?? lists;
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
  return reachable(moved) ?? lists;
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
  const reconnect = record.reconnectOnStart;

  const preferences = record.hostListPreferences;
  const byHost = typeof preferences === 'object' && preferences !== null &&
    'version' in preferences && preferences.version === 1 && 'byHost' in preferences &&
    typeof preferences.byHost === 'object' && preferences.byHost !== null && !Array.isArray(preferences.byHost)
    ? Object.fromEntries(Object.entries(preferences.byHost).map(([id, lists]) => [id, parseHostScreenLists(lists, undefined)]))
    : null;

  const chooser = record.chooserListPreferences;
  const chooserListPreferences = typeof chooser === 'object' && chooser !== null && !Array.isArray(chooser)
    ? Object.fromEntries(Object.entries(chooser).map(([id, lists]) => [id, parseChooserLists(lists)]))
    : undefined;

  return {
    ...(chooserListPreferences === undefined ? {} : { chooserListPreferences }),
    ...(byHost === null ? {} : { hostListPreferences: { version: 1 as const, byHost } }),
    fontSize: typeof fontSize === 'number' ? clampFontSize(fontSize) : null,
    theme: parseTheme(theme),
    zoomMultipaneWindows:
      typeof zoom === 'boolean' ? zoom : DEFAULT_SETTINGS.zoomMultipaneWindows,
    hostScreenLists: parseHostScreenLists(record.hostScreenLists, record.recentSessionsFirst),
    reconnectOnStart:
      typeof reconnect === 'boolean' ? reconnect : DEFAULT_SETTINGS.reconnectOnStart,
  };
}

export function hostListsFor(settings: Settings, hostId: string): HostScreenLists {
  const preferences = settings.hostListPreferences;
  if (!preferences) return settings.hostScreenLists;
  return Object.hasOwn(preferences.byHost, hostId)
    ? preferences.byHost[hostId]
    : DEFAULT_SETTINGS.hostScreenLists;
}

export function migrateHostLists(settings: Settings, existingHostIds: readonly string[]): Settings {
  if (settings.hostListPreferences) return settings;
  return {
    ...settings,
    hostListPreferences: {
      version: 1,
      byHost: Object.fromEntries(existingHostIds.map((id) => [id, settings.hostScreenLists])),
    },
  };
}
