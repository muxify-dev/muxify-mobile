/**
 * Whether a physical keyboard is attached, from two witnesses that each miss
 * something.
 *
 * GameController's `GCKeyboard.coalesced` can stay set after a Bluetooth
 * keyboard goes, with no disconnect notification, so a check after that keeps
 * saying "connected". UIKit's software keyboard says it plainly: iOS shows the
 * full keyboard only when no physical keyboard is in use, and shrinks it to a
 * bar when one is. It says nothing while the keyboard is down, so it can only
 * overrule GameController, never stand in for it.
 */
export interface PhysicalKeyboardPresence {
  /** What GameController last said. */
  readonly reported: boolean;
  /** The full software keyboard came up after GameController said "connected". */
  readonly overruled: boolean;
}

export type PresenceEvidence =
  /** A connect or disconnect notification: news of a change, so it ends any overruling. */
  | { readonly kind: 'announced'; readonly connected: boolean }
  /** A read of `coalesced`, on start and on return to the foreground. It can be stale. */
  | { readonly kind: 'checked'; readonly connected: boolean }
  /** The software keyboard's height in points as it settles; 0 when it is down. */
  | { readonly kind: 'softwareKeyboard'; readonly height: number };

/**
 * Taller than the bar iOS leaves while a physical keyboard is attached (about
 * 45–70 pt on iPhone and iPad), shorter than any software keyboard, which
 * starts near 160 pt in landscape on iPhone.
 */
export const FULL_SOFTWARE_KEYBOARD_HEIGHT = 120;

export function initialPresence(connected: boolean): PhysicalKeyboardPresence {
  return { reported: connected, overruled: false };
}

export function isPhysicalKeyboardAttached(presence: PhysicalKeyboardPresence): boolean {
  return presence.reported && !presence.overruled;
}

export function nextPresence(
  presence: PhysicalKeyboardPresence,
  evidence: PresenceEvidence,
): PhysicalKeyboardPresence {
  switch (evidence.kind) {
    case 'announced':
      return { reported: evidence.connected, overruled: false };
    case 'checked':
      return evidence.connected === presence.reported ? presence : { reported: evidence.connected, overruled: false };
    case 'softwareKeyboard':
      if (evidence.height >= FULL_SOFTWARE_KEYBOARD_HEIGHT) return presence.overruled ? presence : { ...presence, overruled: true };
      if (evidence.height > 0) return presence.overruled ? { ...presence, overruled: false } : presence;
      return presence;
  }
}
