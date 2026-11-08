/**
 * A copy of `set` with `item` taken out if it was in, or put in if it was not.
 * A copy, so a React state updater that returns it is a new state.
 */
export function toggled<T>(set: ReadonlySet<T>, item: T): ReadonlySet<T> {
  const next = new Set(set);
  if (!next.delete(item)) next.add(item);
  return next;
}
