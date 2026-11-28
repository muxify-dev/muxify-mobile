import {
  isDarkThemeId,
  isLightThemeId,
  type DarkThemeId,
  type LightThemeId,
  type ThemeId,
  type ThemeKind,
} from '@/constants/app-theme';
import { parseGripActions, type GripActionSlots } from '@/lib/grip-actions';
import { parseQuickActions, type QuickActions } from '@/lib/quick-actions';
import type { HostScreenTab } from '@/domain/host-screen';
import { parseKeyboardShortcuts, type KeyboardShortcuts } from '@/keyboard/keyboard-shortcuts';

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
  /**
   * Whether the Surface's font may join characters such as `>=` into one
   * glyph. On by default, which is how ghostty draws its own font.
   */
  ligatures: boolean;
  /**
   * Whether the app is light, dark, or follows the phone. The app and the
   * Surface are always the same kind: resolveTheme picks lightTheme or
   * darkTheme from this.
   */
  appearance: AppearanceSetting;
  lightTheme: LightThemeId;
  darkTheme: DarkThemeId;
  /**
   * Whether a Session with several Panes arrives with its active Pane filling
   * the Window. A phone is too narrow to read two Panes side by side, so this
   * starts on.
   */
  zoomMultipaneWindows: boolean;
  /** The Host Screen tab the user last chose on each Host, by Host id. */
  hostScreenTabs?: Readonly<Record<string, HostScreenTab>>;
  /**
   * Whether a cold start opens the Last Place again, if there is one. Off by
   * default: an app that connects to a machine on launch is a surprise
   * nobody asked for.
   */
  reconnectOnStart: boolean;
  /**
   * Whether every way into the Panes picker (the Layout Map, the Panes key
   * and Options › Panes) is hidden, so the Edge Drawer is the way to a Pane.
   * The Header title's tap stays. Zoom and Split keep their own items in
   * Options. A trial setting, off by default: whether to retire them is
   * decided after use (D6 of the right-edge switcher proposal).
   */
  hidePanesPicker: boolean;
  chooserListPreferences?: Readonly<Record<string, ChooserLists>>;
  /** The Keyboard Shortcuts the user changed. The rest keep their defaults. */
  keyboardShortcuts?: KeyboardShortcuts;
  quickActions?: QuickActions;
  /** The three Grip actions beside Destinations in the Fan. Absent means the defaults. */
  gripActions?: GripActionSlots;
}

export const APPEARANCE_SETTINGS = ['system', 'light', 'dark'] as const;
export type AppearanceSetting = (typeof APPEARANCE_SETTINGS)[number];

/**
 * The Theme in use: the user's light or dark Theme, chosen by the appearance
 * setting, or by the phone's when the setting is System. The app chrome, the
 * Surface and the colours reported to tmux all come from this one answer.
 */
export function resolveTheme(
  settings: Pick<Settings, 'appearance' | 'lightTheme' | 'darkTheme'>,
  phoneScheme: ThemeKind,
): ThemeId {
  const kind = settings.appearance === 'system' ? phoneScheme : settings.appearance;
  return kind === 'light' ? settings.lightTheme : settings.darkTheme;
}

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

/** The chooser lists that are off, in the order Settings offers them. */
export function hiddenChooserLists(lists: ChooserLists): ChooserList[] {
  return CHOOSER_LISTS.filter((list) => !lists.includes(list));
}

/** Shows one list, as the last tab of the chooser, or hides it. The last list stays. */
export function switchChooserList(lists: ChooserLists, list: ChooserList, on: boolean): ChooserLists {
  if (lists.includes(list) === on) return lists;
  const next = on ? [...lists, list] : lists.filter((item) => item !== list);
  const [first, ...rest] = next;
  return first === undefined ? lists : [first, ...rest];
}

export function moveChooserLists(lists: ChooserLists, sources: number[], destination: number): ChooserLists {
  return parseChooserLists(moved(lists, sources, destination));
}

/**
 * The items after a drag, with SwiftUI's move: `sources` are the dragged
 * indices and `destination` is an index from before the move.
 */
export function moved<T>(items: readonly T[], sources: number[], destination: number): T[] {
  const moving = items.filter((_, at) => sources.includes(at));
  const before = items.filter((_, at) => at < destination && !sources.includes(at));
  const after = items.filter((_, at) => at >= destination && !sources.includes(at));
  return [...before, ...moving, ...after];
}

export const MIN_FONT_SIZE = 5;
export const MAX_FONT_SIZE = 24;
/** Where the stepper starts when the user first turns the default off. */
export const DEFAULT_EXPLICIT_FONT_SIZE = 10;
/** What the Surface uses when the user has not picked a size. */
export const DEFAULT_FONT_SIZE = 13;

export const DEFAULT_SETTINGS: Settings = {
  fontSize: null,
  ligatures: true,
  appearance: 'system',
  lightTheme: 'solarized-light',
  darkTheme: 'ghostty',
  zoomMultipaneWindows: true,
  reconnectOnStart: false,
  hidePanesPicker: false,
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

type ThemeChoice = Pick<Settings, 'appearance' | 'lightTheme' | 'darkTheme'>;

/**
 * The appearance and the two Themes a saved value names, each defaulted on
 * its own when it is not one this version knows.
 *
 * Settings saved before the appearance setting have one `theme` instead, and
 * that Theme decided the app's appearance. It is carried over as a fixed
 * appearance of its kind with that Theme in its slot, so an update does not
 * change how the app looks. Mocha and Latte are the Catppuccin pair the app
 * had before Dracula and Solarized, and go to the Theme of the same kind.
 */
function parseThemeChoice(record: Record<string, unknown>): ThemeChoice {
  const { appearance, lightTheme, darkTheme, theme } = record;
  if (appearance === undefined && lightTheme === undefined && darkTheme === undefined) {
    switch (theme) {
      case 'solarized':
      case 'latte':
        return { ...DEFAULT_THEME_CHOICE, appearance: 'light', lightTheme: 'solarized-light' };
      case 'default':
        return { ...DEFAULT_THEME_CHOICE, appearance: 'dark', darkTheme: 'ghostty' };
      case 'dracula':
      case 'mocha':
        return { ...DEFAULT_THEME_CHOICE, appearance: 'dark', darkTheme: 'dracula' };
      default:
        return DEFAULT_THEME_CHOICE;
    }
  }
  return {
    appearance: (APPEARANCE_SETTINGS as readonly unknown[]).includes(appearance)
      ? (appearance as AppearanceSetting)
      : DEFAULT_SETTINGS.appearance,
    lightTheme: isLightThemeId(lightTheme) ? lightTheme : DEFAULT_SETTINGS.lightTheme,
    darkTheme: isDarkThemeId(darkTheme) ? darkTheme : DEFAULT_SETTINGS.darkTheme,
  };
}

const DEFAULT_THEME_CHOICE: ThemeChoice = {
  appearance: DEFAULT_SETTINGS.appearance,
  lightTheme: DEFAULT_SETTINGS.lightTheme,
  darkTheme: DEFAULT_SETTINGS.darkTheme,
};

/**
 * The last tab of each Host a saved value names. A tab this version does not
 * know is dropped. The Board tab was saved as `topics` before it had the
 * Mac's name.
 */
function parseHostScreenTabs(raw: unknown): Record<string, HostScreenTab> | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const tabs = Object.entries(raw).flatMap(([host, tab]): [string, HostScreenTab][] =>
    tab === 'board' || tab === 'topics' ? [[host, 'board']] : tab === 'sessions' ? [[host, 'sessions']] : []);
  return tabs.length > 0 ? Object.fromEntries(tabs) : undefined;
}

/**
 * Reads settings back off disk, taking what it recognises and defaulting the
 * rest.
 *
 * Every field is checked rather than trusted: this file is the app's own, but a
 * half-written one after a crash, or one from a version that knew different
 * settings, must not leave the terminal unusable.
 *
 * A field this version does not know is not carried over: the next save does
 * not write it.
 */
export function parseSettings(raw: unknown): Settings {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_SETTINGS;
  const record = raw as Record<string, unknown>;

  const fontSize = record.fontSize;
  const ligatures = record.ligatures;
  const zoom = record.zoomMultipaneWindows;
  const reconnect = record.reconnectOnStart;
  const hide = record.hidePanesPicker;

  const chooser = record.chooserListPreferences;
  const chooserListPreferences = typeof chooser === 'object' && chooser !== null && !Array.isArray(chooser)
    ? Object.fromEntries(Object.entries(chooser).map(([id, lists]) => [id, parseChooserLists(lists)]))
    : undefined;

  const quickActions = parseQuickActions(record.quickActions);
  const gripActions = parseGripActions(record.gripActions);
  const keyboardShortcuts = parseKeyboardShortcuts(record.keyboardShortcuts);
  const hostScreenTabs = parseHostScreenTabs(record.hostScreenTabs);

  return {
    ...(chooserListPreferences === undefined ? {} : { chooserListPreferences }),
    ...(quickActions === undefined ? {} : { quickActions }),
    ...(gripActions === undefined ? {} : { gripActions }),
    ...(keyboardShortcuts === undefined ? {} : { keyboardShortcuts }),
    ...(hostScreenTabs === undefined ? {} : { hostScreenTabs }),
    fontSize: typeof fontSize === 'number' ? clampFontSize(fontSize) : null,
    ligatures: typeof ligatures === 'boolean' ? ligatures : DEFAULT_SETTINGS.ligatures,
    ...parseThemeChoice(record),
    zoomMultipaneWindows:
      typeof zoom === 'boolean' ? zoom : DEFAULT_SETTINGS.zoomMultipaneWindows,
    reconnectOnStart:
      typeof reconnect === 'boolean' ? reconnect : DEFAULT_SETTINGS.reconnectOnStart,
    hidePanesPicker: typeof hide === 'boolean' ? hide : DEFAULT_SETTINGS.hidePanesPicker,
  };
}
