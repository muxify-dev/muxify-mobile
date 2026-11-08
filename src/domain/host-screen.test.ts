import { answered, asking, refused, UNASKED, type Listing } from './host-listing';
import { hostScreen, type HostScreenRow, type HostScreenSection } from './host-screen';
import type { HostScreenLists } from '@/settings/settings';
import type { RecentSession } from '@/storage/records';
import type { Session } from '@/tmux/tmux-client';

const remembered = (name: string, lastOpenedAt = '2026-09-15T10:00:00Z'): RecentSession => ({
  hostId: 'host1',
  name,
  lastOpenedAt,
});

const running = (name: string, windowCount = 1): Session => ({ name, windowCount });

const recentRow = (name: string, windowCount?: number, lastOpenedAt = '2026-09-15T10:00:00Z') =>
  ({ kind: 'recent', name, lastOpenedAt, windowCount }) as const;
const availableRow = (name: string) => ({ kind: 'available', name }) as const;
const note = (text: string) => ({ kind: 'note', text }) as const;

const NOTHING_OPENED = note('Nothing opened on this Host yet. Pick one below to start.');
const NOTHING_OPENED_YET = note('Nothing opened on this Host yet.');
const NO_OTHERS = note('No other Sessions on this Host.');

const recentSection = (...rows: HostScreenRow[]): HostScreenSection => ({
  id: 'recent',
  title: 'Sessions',
  footer: null,
  rows,
});

const availableSection = (...rows: HostScreenRow[]): HostScreenSection => ({
  id: 'available',
  title: 'Available on Host',
  footer: rows.some((row) => row.kind === 'available')
    ? 'Opening one adds it to Sessions above.'
    : null,
  rows,
});

const TOPICS: HostScreenSection = {
  id: 'topics',
  title: 'Topics',
  footer: null,
  rows: [note('Topics come in a later version.')],
};

interface Case {
  name: string;
  lists?: HostScreenLists;
  recent: RecentSession[];
  listing: Listing;
  sections: HostScreenSection[];
}

describe('hostScreen', () => {
  it.each<Case>([
    {
      // One Session, one row: two ways to open the same thing is a list that
      // lies about how many Sessions the Host has.
      name: 'keeps a Session out of Available once it is remembered',
      recent: [remembered('muxify')],
      listing: answered([running('muxify'), running('cook')]),
      sections: [recentSection(recentRow('muxify', 1)), availableSection(availableRow('cook'))],
    },
    {
      name: 'keeps the order it was given for Recent, and sorts Available by name',
      recent: [
        remembered('zebra', '2026-09-15T11:00:00Z'),
        remembered('alpha', '2026-09-15T09:00:00Z'),
      ],
      listing: answered([
        running('zebra'),
        running('alpha'),
        running('game_server'),
        running('aws_terraform'),
      ]),
      sections: [
        recentSection(
          recentRow('zebra', 1, '2026-09-15T11:00:00Z'),
          recentRow('alpha', 1, '2026-09-15T09:00:00Z'),
        ),
        availableSection(availableRow('aws_terraform'), availableRow('game_server')),
      ],
    },
    {
      name: 'carries what the Host said onto the remembered row',
      recent: [remembered('muxify')],
      listing: answered([running('muxify', 4)]),
      sections: [recentSection(recentRow('muxify', 4)), availableSection(NO_OTHERS)],
    },
    {
      name: 'hides a remembered Session the Host no longer has',
      recent: [remembered('gone'), remembered('here')],
      listing: answered([running('here')]),
      sections: [recentSection(recentRow('here', 1)), availableSection(NO_OTHERS)],
    },
    {
      // Failing open is the whole point: an unreachable Host is exactly when
      // you most want to see what you had open on it.
      name: 'shows everything remembered while the first question is in flight',
      recent: [remembered('muxify'), remembered('cook')],
      listing: UNASKED,
      sections: [
        recentSection(recentRow('muxify'), recentRow('cook')),
        availableSection({ kind: 'checking' }),
      ],
    },
    {
      name: 'shows everything remembered when the Host refused, with why',
      recent: [remembered('muxify')],
      listing: refused('Host unreachable'),
      sections: [
        recentSection(recentRow('muxify')),
        availableSection({ kind: 'refused', message: 'Host unreachable' }),
      ],
    },
    {
      name: 'keeps the last answer on screen while it asks again',
      recent: [remembered('muxify')],
      listing: asking(answered([running('muxify', 2), running('cook')])),
      sections: [recentSection(recentRow('muxify', 2)), availableSection(availableRow('cook'))],
    },
    {
      name: 'reads a Host with nothing running as no Sessions at all',
      recent: [remembered('gone')],
      listing: answered([]),
      sections: [recentSection(NOTHING_OPENED), availableSection(NO_OTHERS)],
    },
    {
      name: 'lists a Host that has Sessions nobody here has opened',
      recent: [],
      listing: answered([running('cook'), running('aws_terraform')]),
      sections: [
        recentSection(NOTHING_OPENED),
        availableSection(availableRow('aws_terraform'), availableRow('cook')),
      ],
    },
    {
      name: 'does not point below before the Host has answered',
      recent: [],
      listing: UNASKED,
      sections: [recentSection(NOTHING_OPENED_YET), availableSection({ kind: 'checking' })],
    },
    {
      name: 'shows only the Topics placeholder when Topics is the one list on',
      lists: ['topics'],
      recent: [remembered('muxify')],
      listing: answered([running('muxify'), running('cook')]),
      sections: [TOPICS],
    },
    {
      name: 'puts Topics under Sessions in that order',
      lists: ['sessions', 'topics'],
      recent: [remembered('muxify')],
      listing: answered([running('muxify'), running('cook')]),
      sections: [
        recentSection(recentRow('muxify', 1)),
        availableSection(availableRow('cook')),
        TOPICS,
      ],
    },
    {
      name: 'puts Topics above Sessions in that order',
      lists: ['topics', 'sessions'],
      recent: [remembered('muxify')],
      listing: answered([running('muxify'), running('cook')]),
      sections: [
        TOPICS,
        recentSection(recentRow('muxify', 1)),
        availableSection(availableRow('cook')),
      ],
    },
  ])('$name', ({ lists = ['sessions'], recent, listing, sections }) => {
    expect(hostScreen({ settings: { hostScreenLists: lists }, recent, listing })).toEqual(sections);
  });
});
