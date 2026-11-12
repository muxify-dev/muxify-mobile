import { answered, asking, refused, UNASKED, type Listing } from './host-listing';
import { homeSection } from './home';
import type { HostScreenLists } from '@/settings/settings';
import type { Host, RecentSession } from '@/storage/records';
import inPlayFixture from '@/topics/__fixtures__/environment-in-play.json';
import { parseEnvironment } from '@/topics/environment';
import { TOPICS_UNASKED, type HostTopics } from '@/topics/host-topics';

const HOST: Host = {
  id: 'host1',
  displayName: 'Dev Host',
  address: 'dev.example',
  port: 22,
  identityId: 'identity1',
};

const remembered = (name: string): RecentSession => ({
  hostId: 'host1',
  name,
  lastOpenedAt: '2026-09-15T10:00:00Z',
});

const section = (
  listing: Listing,
  recent: RecentSession[] = [],
  lists: HostScreenLists = ['recent', 'sessions'],
  topics: HostTopics = TOPICS_UNASKED,
) =>
  homeSection(HOST, {
    settings: { hostScreenLists: lists },
    recent,
    listing,
    topics,
    opened: new Set(),
    appearance: 'dark',
  });

const sessions = (...names: string[]) => names.map((name) => ({ name, windowCount: 1 }));
const names = (rows: { kind: string; name?: string }[]) => rows.map((row) => row.name ?? row.kind);

describe('homeSection', () => {
  it('shows the first 5 rows of the Host Screen, in the Host Screen order', () => {
    const shown = section(
      answered(sessions('a', 'b', 'c', 'd', 'e', 'f', 'g')),
      [remembered('c'), remembered('a')],
    );

    expect(names(shown.rows)).toEqual(['c', 'a', 'b', 'd', 'e']);
    expect(shown.host).toBe(HOST);
  });

  it('follows the lists the user turned on', () => {
    const shown = section(answered(sessions('a', 'b')), [remembered('a')], ['sessions']);

    expect(names(shown.rows)).toEqual(['a', 'b']);
  });

  it('says the first read is in flight while the Host has not answered', () => {
    const shown = section(UNASKED, [remembered('a')]);

    expect(shown.connection).toBe('checking');
    expect(names(shown.rows)).toEqual(['a', 'checking']);
  });

  it('says the Host answered, and keeps saying so while it is asked again', () => {
    expect(section(answered(sessions('a'))).connection).toBe('answered');
    expect(section(asking(answered(sessions('a')))).connection).toBe('answered');
  });

  it('shows a Host that refused as its reason alone', () => {
    const shown = section(refused('Host unreachable'), [remembered('a')]);

    expect(shown.connection).toBe('refused');
    expect(shown.rows).toEqual([{ kind: 'refused', message: 'Host unreachable' }]);
  });

  describe('of a Host in In Play', () => {
    const mac = parseEnvironment(inPlayFixture);
    const { places, guests, bench } = mac.unpinned;
    const listed: HostTopics = { kind: 'listed', snapshot: mac };
    const topicIds = (cards: typeof places) =>
      cards.flatMap((card) => (card.kind === 'topic' ? [card.topic.id] : []));
    const shownTopics = (rows: { kind: string; id?: string }[]) =>
      rows.flatMap((row) => (row.kind === 'topic' && row.id ? [row.id] : []));

    it('shows every Pinned, In Play and Guest Topic, with no cut at 5', () => {
      const shown = section(UNASKED, [], ['topics'], listed);

      expect(shownTopics(shown.rows)).toEqual(
        topicIds([...mac.pinned, ...places, ...guests]),
      );
      expect(guests.length).toBe(2);
    });

    it('hides Open Places and the Bench', () => {
      const shown = section(UNASKED, [], ['topics'], listed);

      expect(shown.rows.some((row) => row.kind === 'open-place' || row.kind === 'bench')).toBe(false);
      expect(shownTopics(shown.rows)).not.toContain(topicIds(bench)[0]);
    });

    it('still caps a Host that has the Topics list off at 5', () => {
      const shown = section(answered(sessions('a', 'b', 'c', 'd', 'e', 'f')), [], ['sessions'], listed);

      expect(names(shown.rows)).toEqual(['a', 'b', 'c', 'd', 'e']);
    });
  });
});
