import type { Session } from '@/tmux/tmux-client';

/**
 * What the Host has to say for itself, once asked.
 *
 * A state machine rather than a boolean, because the Host Screen asks again
 * every time it comes back into focus — closing the Edit sheet, closing the New
 * Session sheet, coming Home from the Terminal Screen — and the asking must not
 * be visible. It used to be: the screen dropped to `reading` with nothing in
 * hand, which emptied the Available list, blanked the Session count and took
 * the window count off every remembered row, and a second later put it all
 * back. Every trip through a sheet flashed the whole screen.
 *
 * So a question in flight carries the last answer with it. The screen draws
 * what it already had until a better answer arrives, and a re-read shows as
 * nothing at all — which is what it should look like, because nothing the user
 * did was about the Host's Session list.
 *
 * A refusal is the exception and drops the list on purpose. A Host that cannot
 * be reached has no Sessions to offer, and leaving the last ones on screen
 * under an error would be offering Sessions that may not be there.
 */
export type Listing =
  | { phase: 'reading'; sessions?: Session[] }
  | { phase: 'read'; sessions: Session[] }
  | { phase: 'failed'; message: string };

/** Before the Host has been asked anything. */
export const UNASKED: Listing = { phase: 'reading' };

/** Asking again, without taking down the answer already on screen. */
export function asking(previous: Listing): Listing {
  const held = lastAnswer(previous);
  return held === undefined ? { phase: 'reading' } : { phase: 'reading', sessions: held };
}

/** The Host answered. */
export function answered(sessions: Session[]): Listing {
  return { phase: 'read', sessions };
}

/** The Host could not be asked, or refused. */
export function refused(message: string): Listing {
  return { phase: 'failed', message };
}

/** What the Host last said, or undefined before it has said anything. */
export function lastAnswer(listing: Listing): Session[] | undefined {
  return listing.phase === 'failed' ? undefined : listing.sessions;
}

/**
 * Whether there is nothing to draw yet and the spinner has to stand in for it.
 *
 * Only ever true of the first question. Every later one is answered from what
 * is already on screen while it is in flight.
 */
export function waitingOnFirstAnswer(listing: Listing): boolean {
  return listing.phase === 'reading' && lastAnswer(listing) === undefined;
}
