import { lastAnswer } from '@/domain/host-listing';
import { homeRows, type HostScreenInput, type HostScreenRow } from '@/domain/host-screen';
import type { Host } from '@/storage/records';

/** How many rows Home shows of a Host that is not in In Play, before All opens its Host Screen. */
export const HOME_ROWS = 5;

/**
 * Where Home's first read of a Host stands, as the dot beside its name says.
 * A re-read that still holds the last answer is `answered`: the dot must not
 * flicker orange each time Home comes back into focus.
 */
export type HostConnection = 'checking' | 'answered' | 'refused';

/** One Host's part of Home. Hosts are never mixed: a row is under its own Host. */
export interface HomeSection {
  host: Host;
  connection: HostConnection;
  rows: HostScreenRow[];
}

/**
 * A Host's section of Home: the first rows of its Host Screen, in the lists
 * and the order Settings gives. A Host in In Play shows all its live Topics
 * instead, as `homeRows` says.
 *
 * A Host that refused has its error and nothing else. Its Host Screen would
 * offer the Sessions it remembered, but a Home that opens with a row per
 * Session of a Host that is down reads as a Host that is up.
 */
export function homeSection(host: Host, input: HostScreenInput): HomeSection {
  const { listing } = input;
  if (listing.phase === 'failed') {
    return { host, connection: 'refused', rows: [{ kind: 'refused', message: listing.message }] };
  }
  return {
    host,
    connection: lastAnswer(listing) === undefined ? 'checking' : 'answered',
    rows: homeRows(input, HOME_ROWS),
  };
}
