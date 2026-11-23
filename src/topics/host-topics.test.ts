import { parseEnvironment } from './environment';
import { freshness, lastSnapshot, QUIET_ASK_MS, QUIET_WAIT_MS, TOPICS_UNASKED, withHostCli, type Freshness, type HostTopics } from './host-topics';
import inPlay from './__fixtures__/environment-in-play.json';

const snapshot = parseEnvironment(inPlay);

describe('what the Host last said about its Topics', () => {
  it('has nothing before the first push', () => {
    expect(lastSnapshot(TOPICS_UNASKED)).toBeNull();
  });

  it('keeps the last snapshot while the next push is awaited', () => {
    expect(lastSnapshot({ kind: 'loading', last: { received: { snapshot, at: 0 }, doubt: null } })).toBe(snapshot);
  });

  it('keeps the last snapshot through a failure, which the Listing does not', () => {
    expect(lastSnapshot({ kind: 'failed', error: 'no route', last: { received: { snapshot, at: 0 }, doubt: null } })).toBe(snapshot);
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

describe('how fresh the Topics on screen are', () => {
  const PUSHED = 1_000_000;
  const received = { snapshot, at: PUSHED };
  /** The phone last knew the list two hours after its last push, and asked again a minute later. */
  const KNOWN = PUSHED + 7_200_000;
  const ASKED = KNOWN + 60_000;
  const doubt = { since: KNOWN, asked: ASKED };

  it.each<{ name: string; topics: HostTopics; now: number; fresh: Freshness }>([
    { name: 'is current while the phone knows the list, however old its push', topics: { kind: 'listed', received, doubt: null }, now: KNOWN, fresh: { kind: 'current' } },
    {
      name: 'stays quiet for the first second of an ask',
      topics: { kind: 'listed', received, doubt },
      now: ASKED + QUIET_ASK_MS - 1,
      fresh: { kind: 'quiet', until: ASKED + QUIET_ASK_MS },
    },
    { name: 'says it is updating once an ask has run a second, and the list is unknown for long', topics: { kind: 'listed', received, doubt }, now: ASKED + QUIET_ASK_MS, fresh: { kind: 'updating' } },
    {
      name: 'stays quiet while the phone knew the list less than the quiet wait ago, however long it asks',
      topics: { kind: 'listed', received, doubt: { since: KNOWN, asked: KNOWN } },
      now: KNOWN + QUIET_WAIT_MS - 1,
      fresh: { kind: 'quiet', until: KNOWN + QUIET_WAIT_MS },
    },
    { name: 'stays quiet, with nothing to wake for, while the app is in the background', topics: { kind: 'listed', received, doubt: { since: KNOWN, asked: null } }, now: ASKED + 60_000, fresh: { kind: 'quiet', until: null } },
    { name: 'says it is updating a list from an earlier Connection the same way', topics: { kind: 'loading', last: { received, doubt } }, now: ASKED + QUIET_ASK_MS, fresh: { kind: 'updating' } },
    {
      name: 'counts from the push for a list from an earlier Connection whose close it never saw',
      topics: { kind: 'loading', last: { received, doubt: null } },
      now: PUSHED,
      fresh: { kind: 'quiet', until: PUSHED + QUIET_WAIT_MS },
    },
    { name: 'has nothing to say with no list: the spinner stands in for it', topics: TOPICS_UNASKED, now: KNOWN, fresh: { kind: 'current' } },
    {
      name: 'says when the phone last knew the list it could not update',
      topics: { kind: 'failed', error: 'no route', last: { received, doubt } },
      now: ASKED + 10_000,
      fresh: { kind: 'not-updated', at: KNOWN, error: 'no route' },
    },
    { name: 'leaves a failure with no list to its own row', topics: { kind: 'failed', error: 'no route', last: null }, now: KNOWN, fresh: { kind: 'current' } },
    { name: 'leaves a Host Problem to its own row', topics: { kind: 'host-problem', last: { received, doubt } }, now: ASKED + 10_000, fresh: { kind: 'current' } },
  ])('$name', ({ topics, now, fresh }) => {
    expect(freshness(topics, now)).toEqual(fresh);
  });
});
