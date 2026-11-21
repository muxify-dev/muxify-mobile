import { parseEnvironment } from './environment';
import { lastSnapshot, TOPICS_UNASKED, withHostCli, type HostTopics } from './host-topics';
import inPlay from './__fixtures__/environment-in-play.json';

const snapshot = parseEnvironment(inPlay);

describe('what the Host last said about its Topics', () => {
  it('has nothing before the first push', () => {
    expect(lastSnapshot(TOPICS_UNASKED)).toBeNull();
  });

  it('keeps the last snapshot while the next push is awaited', () => {
    expect(lastSnapshot({ kind: 'loading', last: snapshot })).toBe(snapshot);
  });

  it('keeps the last snapshot through a failure, which the Listing does not', () => {
    expect(lastSnapshot({ kind: 'failed', error: 'no route', last: snapshot })).toBe(snapshot);
  });

  it('has no snapshot to keep when the Host has no Host CLI, or no Host Server', () => {
    const states: HostTopics[] = [{ kind: 'absent' }, { kind: 'unavailable', host: 'Mac', reason: 'x' }];
    for (const state of states) expect(lastSnapshot(state)).toBeNull();
  });

  it('says a Host CLI too old for a Host Server is being updated while the install runs', () => {
    expect(withHostCli({ kind: 'unavailable', host: 'Mac', reason: 'x' }, { kind: 'running' })).toEqual({ kind: 'updating', last: null });
    expect(withHostCli({ kind: 'unavailable', host: 'Mac', reason: 'x', tooOld: 'host' }, { kind: 'running' })).toEqual({ kind: 'updating', last: null });
  });

  it('keeps the reason of a phone too old for the Host while the install runs: no update of the Host helps it', () => {
    const phoneTooOld: HostTopics = { kind: 'unavailable', host: 'Mac', reason: 'x', tooOld: 'phone' };

    expect(withHostCli(phoneTooOld, { kind: 'running' })).toEqual(phoneTooOld);
  });
});
