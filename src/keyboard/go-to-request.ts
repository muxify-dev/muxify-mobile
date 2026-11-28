import type { PlaceTab } from '@/storage/records';

/**
 * Where Go to was asked for, so a Cancel goes back there: the Terminal
 * Screen, or the Web View with this Tab. The Live Page waits while Go to is
 * open, so the Web View that comes back shows the same page.
 */
export type GoToReturn = { kind: 'terminal' } | { kind: 'page'; tab: PlaceTab };

/**
 * Go to asked for from a screen that has no Go to field: ⌘P or the Grip
 * action, on the Terminal Screen or the Web View. That screen names the Host
 * and goes to its Host Screen, which takes the request when it has the focus
 * and puts the keys in its Go to field.
 */
let requested: { hostId: string; from: GoToReturn } | null = null;

export function requestGoTo(hostId: string, from: GoToReturn): void {
  requested = { hostId, from };
}

/** The screen Go to was asked for from on this Host, or null. A request is taken one time. */
export function takeGoToRequest(hostId: string): GoToReturn | null {
  if (requested?.hostId !== hostId) return null;
  const { from } = requested;
  requested = null;
  return from;
}
