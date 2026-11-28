import { terminalClearance, type ScreenRect } from '@/lib/terminal-clearance';

/**
 * Whether the user wants the system keyboard up. See CONTEXT.md, Keyboard
 * Intent. The Attach holds it, and only a user act changes it.
 */
export type KeyboardIntent = 'up' | 'down';

/**
 * Whether a physical keyboard is in use, as the native KeyboardSnapshot
 * module says. `unknown` is the time before its first check: nothing may be
 * decided on it, and it is never "absent".
 */
export type PhysicalKeyboard = 'unknown' | 'inUse' | 'absent';

/**
 * What iOS says about the keyboard, as the native module mirrors it. The one
 * source of keyboard facts. See ADR 0043.
 */
export interface KeyboardSnapshot {
  readonly physical: PhysicalKeyboard;
  /** The software keyboard where it shows in the window, or null when none does. */
  readonly software: ScreenRect | null;
}

/** What the app holds until the native module has answered. */
export const UNKNOWN_KEYBOARD: KeyboardSnapshot = { physical: 'unknown', software: null };

/**
 * A physical keyboard that was in use and is not: it left, or iOS shows the
 * full software keyboard in its place. The keyboard that is up is then the
 * user's, and ADR 0039 has the Attach keep it up.
 */
export function physicalKeyboardLeft(before: KeyboardSnapshot, after: KeyboardSnapshot): boolean {
  return before.physical === 'inUse' && after.physical === 'absent';
}

/** Which Surface must hold the keyboard, if any. */
export type KeyboardTarget =
  /** This Pane's Surface holds it. No other Surface does. */
  | { readonly kind: 'pane'; readonly paneId: string }
  /** No Surface of the Terminal Screen holds it. */
  | { readonly kind: 'none' }
  /** The Composer, a Selection, a sheet, the Edge Drawer or another screen has input: nothing here touches the keyboard. */
  | { readonly kind: 'elsewhere' };

/** What the Terminal Screen knows that decides the keyboard, beside the snapshot and the intent. */
export interface KeyboardScreen {
  /** The active Pane, or null while there is none. */
  readonly activePaneId: string | null;
  /** Whether keys reach the active Pane now: Typing is open. */
  readonly typingOpen: boolean;
  /** The Composer, a Selection, a sheet, the Edge Drawer, or another screen has input. */
  readonly inputElsewhere: boolean;
  /** The Terminal Screen's bounds in the window. */
  readonly rootBounds: ScreenRect;
  /** The home indicator's inset. */
  readonly safeBottom: number;
  /** How tall the Key Row is when it shows. */
  readonly keyRowHeight: number;
}

/** Every keyboard decision of the Terminal Screen. It makes none of its own. */
export interface KeyboardPlan {
  readonly target: KeyboardTarget;
  /** The Key Row is mounted. Never while the physical keyboard is unknown. */
  readonly keyRow: boolean;
  /** The Surface's iPad shortcut bar (undo, redo, Paste, the language switch) is on. */
  readonly shortcutBar: boolean;
  /** A software keyboard shows in the window: the Keyboard button points down. */
  readonly keyboardShown: boolean;
  /** What the Terminal Screen keeps clear under its content. See terminalClearance. */
  readonly clearance: { readonly resting: number; readonly bottom: number };
  /** How much of the screen's bottom the Key Row takes. */
  readonly reservedBottom: number;
  /** The Window's full height, which survives a keyboard and a Composer. See ADR 0008. */
  readonly windowHeight: number;
}

/**
 * The one rule for the keyboard of the Terminal Screen. A pure function of
 * what iOS says (the snapshot), what the user wants (the intent) and what the
 * screen has open.
 *
 * Only the active Pane's Surface holds the keyboard, and only while the user
 * wants it up and keys reach that Pane. A physical keyboard in use always
 * wants the active Pane: its Surface takes first responder without raising
 * anything. `unknown` is not "in use". A Pane's first paint is not a fact
 * here, because before it tmux already takes keys (see Typing), and the new
 * Pane of a split must take the keyboard from the old one at once.
 *
 * The Key Row shows only when no physical keyboard is in use, and never
 * before the first check says so. The shortcut bar is on only for a physical
 * keyboard in use: iOS shows it as the short strip in place of the software
 * keyboard, and it has the iPad's language switch, which the user would lose
 * with it off. Over a full software keyboard it stays off, so the Key Row has
 * the 55 pt that ADR 0003 gave it. The bar's short frame is also evidence
 * that clears a false "stale" in the native rule, and a key press, a notice
 * or a changed check clears it too, so the bar does not lock itself off. See
 * ADR 0043.
 */
export function keyboardPlan(snapshot: KeyboardSnapshot, intent: KeyboardIntent, screen: KeyboardScreen): KeyboardPlan {
  const keyRow = snapshot.physical === 'absent';
  const reservedBottom = keyRow ? screen.keyRowHeight : 0;
  const clearance = terminalClearance(screen.rootBounds, snapshot.software, screen.safeBottom);
  return {
    target: targetFor(snapshot, intent, screen),
    keyRow,
    shortcutBar: snapshot.physical === 'inUse',
    keyboardShown: snapshot.software !== null,
    clearance,
    reservedBottom,
    windowHeight: Math.max(0, screen.rootBounds.height - reservedBottom - clearance.resting),
  };
}

function targetFor(snapshot: KeyboardSnapshot, intent: KeyboardIntent, screen: KeyboardScreen): KeyboardTarget {
  if (screen.inputElsewhere) return { kind: 'elsewhere' };
  if (!screen.typingOpen || screen.activePaneId === null) return { kind: 'none' };
  const wanted = snapshot.physical === 'inUse' || intent === 'up';
  return wanted ? { kind: 'pane', paneId: screen.activePaneId } : { kind: 'none' };
}

export function sameKeyboardTarget(a: KeyboardTarget, b: KeyboardTarget): boolean {
  return a.kind === b.kind && (a.kind !== 'pane' || (b.kind === 'pane' && a.paneId === b.paneId));
}
