import type { Host } from '@/storage/records';

/**
 * The ids of the Hosts after a drag, for the store to keep.
 *
 * `destination` is a row index from before the move, as SwiftUI gives it.
 */
export function movedHostIds(hosts: Host[], sources: number[], destination: number): string[] {
  const moving = hosts.filter((_, at) => sources.includes(at));
  const before = hosts.filter((_, at) => at < destination && !sources.includes(at));
  const after = hosts.filter((_, at) => at >= destination && !sources.includes(at));
  return [...before, ...moving, ...after].map((host) => host.id);
}
