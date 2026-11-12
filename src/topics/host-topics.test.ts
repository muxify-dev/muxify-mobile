import { parseEnvironment } from './environment';
import {
  lastSnapshot,
  loadingTopics,
  settled,
  TOPICS_UNASKED,
  withHostCli,
  type HostTopics,
} from './host-topics';
import inPlay from './__fixtures__/environment-in-play.json';

const snapshot = parseEnvironment(inPlay);

describe('what the Host last said about its Topics', () => {
  it('has nothing before the first answer', () => {
    expect(lastSnapshot(TOPICS_UNASKED)).toBeNull();
  });

  it('keeps the last snapshot while the next read is in flight', () => {
    const again = loadingTopics({ kind: 'listed', snapshot });

    expect(again).toEqual({ kind: 'loading', last: snapshot });
    expect(lastSnapshot(again)).toBe(snapshot);
  });

  it('keeps the last snapshot through a read that fails, which the Listing does not', () => {
    const failed = settled(loadingTopics({ kind: 'listed', snapshot }), {
      kind: 'failed',
      error: 'muxify exited with status 1',
    });

    expect(failed).toEqual({ kind: 'failed', error: 'muxify exited with status 1', last: snapshot });
  });

  it('has no snapshot to keep when the Host has no Host CLI, or an old one that never listed', () => {
    const states: HostTopics[] = [{ kind: 'absent' }, { kind: 'old', last: null }];
    for (const state of states) expect(loadingTopics(state)).toEqual(TOPICS_UNASKED);
  });

  it('keeps the last snapshot when the Host answers with an old Host CLI', () => {
    const old = settled(loadingTopics({ kind: 'listed', snapshot }), { kind: 'old' });

    expect(old).toEqual({ kind: 'old', last: snapshot });
    expect(lastSnapshot(withHostCli(old, { kind: 'running' }))).toBe(snapshot);
  });

  it('settles on a listed snapshot, whatever came before', () => {
    const previous: HostTopics = { kind: 'failed', error: 'old trouble', last: null };

    expect(settled(previous, { kind: 'listed', snapshot })).toEqual({ kind: 'listed', snapshot });
  });
});
