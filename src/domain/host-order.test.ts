import { movedHostIds } from './host-order';
import type { Host } from '@/storage/records';

const hosts = ['a', 'b', 'c', 'd'].map(
  (id): Host => ({ id, displayName: id, address: id, port: 22, identityId: id }),
);

describe('movedHostIds', () => {
  it.each([
    ['down, past one Host', [0], 2, ['b', 'a', 'c', 'd']],
    ['to the end', [0], 4, ['b', 'c', 'd', 'a']],
    ['up', [3], 1, ['a', 'd', 'b', 'c']],
    ['onto its own place', [1], 1, ['a', 'b', 'c', 'd']],
  ])('%s', (_, sources, destination, order) => {
    expect(movedHostIds(hosts, sources, destination)).toEqual(order);
  });
});
