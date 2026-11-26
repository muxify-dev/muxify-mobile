/**
 * Whether the user wants the system keyboard up. See CONTEXT.md, Keyboard
 * Intent. The Attach holds it, and only a user act changes it.
 */
export type KeyboardIntent = 'up' | 'down';

/** Which Surface must hold the keyboard, if any. */
export type KeyboardTarget =
  /** This Pane's Surface holds it. No other Surface does. */
  | { readonly kind: 'pane'; readonly paneId: string }
  /** No Surface of the Terminal Screen holds it. */
  | { readonly kind: 'none' }
  /** The Composer, a Selection, a sheet, the Edge Drawer or another screen has input: nothing here touches the keyboard. */
  | { readonly kind: 'elsewhere' };

export interface KeyboardFacts {
  readonly intent: KeyboardIntent;
  readonly physicalKeyboard: boolean;
  /** The active Pane, or null while it has no Surface on this screen. */
  readonly activePaneId: string | null;
  /** Whether keys reach the active Pane now: Typing is open. */
  readonly typingOpen: boolean;
  /** The Composer, a Selection, a sheet, the Edge Drawer, or another screen has input. */
  readonly inputElsewhere: boolean;
}

/**
 * The one rule for the keyboard of the Terminal Screen: only the active
 * Pane's Surface holds it, and only while the user wants it up and keys reach
 * that Pane.
 *
 * A hardware keyboard always wants the active Pane: its Surface takes first
 * responder without raising anything. A Pane's first paint is not a fact
 * here, because before it tmux already takes keys (see Typing), and the new
 * Pane of a split must take the keyboard from the old one at once.
 */
export function keyboardTarget(facts: KeyboardFacts): KeyboardTarget {
  if (facts.inputElsewhere) return { kind: 'elsewhere' };
  if (!facts.typingOpen || facts.activePaneId === null) return { kind: 'none' };
  const wanted = facts.physicalKeyboard || facts.intent === 'up';
  return wanted ? { kind: 'pane', paneId: facts.activePaneId } : { kind: 'none' };
}

export function sameKeyboardTarget(a: KeyboardTarget, b: KeyboardTarget): boolean {
  return a.kind === b.kind && (a.kind !== 'pane' || (b.kind === 'pane' && a.paneId === b.paneId));
}
