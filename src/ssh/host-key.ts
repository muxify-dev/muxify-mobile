/** What a Connection attempt found out about the Host's key. */
export type KeyVerdict =
  | { kind: 'first-sight' }
  | { kind: 'known' }
  | { kind: 'changed'; stored: string };

/**
 * Trust on first use, as a pure comparison.
 *
 * The first key seen is recorded and every later one is compared to it. A
 * change is reported rather than accepted or refused, because the two
 * explanations — a rebuilt machine, or something sitting in the middle — are
 * indistinguishable from here and only the user knows which.
 *
 * Accepting any key silently was considered and rejected: it is a habit that
 * survives into production, and the SSH library hands the key to a callback
 * precisely so it does not have to be.
 */
export function compareHostKey(stored: string | undefined, presented: string): KeyVerdict {
  if (stored === undefined || stored === '') return { kind: 'first-sight' };
  if (stored === presented) return { kind: 'known' };
  return { kind: 'changed', stored };
}
