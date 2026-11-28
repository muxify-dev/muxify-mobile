import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Button, Picker } from '@expo/ui/swift-ui';

import HostScreen from '@/app/hosts/[id]';
import { answered, HOST_PROBLEM } from '@/domain/host-listing';
import { requestGoTo } from '@/keyboard/go-to-request';
import { placeTabRoute } from '@/browser/place-tab-route';
import type { KeyboardHandlers } from '@/keyboard/key-commands';
import { fakeHostServer, refused } from '@/test-support/fake-host-server';
import { protocolFrames } from '@/test-support/protocol-frames';
import { searchBar, toolbarMenuActions } from '@/test-support/toolbar';
import type { EnvironmentSnapshot, SessionId, TopicId } from '@/topics/environment';
import type { DisconnectReason } from '@/tmux/disconnect-reason';
import type { Freshness, HostTopics, Shown } from '@/topics/host-topics';
import { sessionPathRowsJson, type SessionPathRow } from '@/topics/session-paths';

const mockRouter = { push: jest.fn() };
const mockNavigation = { addListener: () => () => undefined };
const mockRemember = jest.fn();
const mockReopen = jest.fn();
const mockWake = jest.fn();
const mockOpenTopic = jest.fn();
const mockOpenSession = jest.fn();
const mockOpen = jest.fn();
const mockPaths = jest.fn();
let mockServer = fakeHostServer();
const mockVisit = jest.fn();
const mockSearch = { focus: jest.fn(), cancelSearch: jest.fn(), setText: jest.fn() };
let mockKeys: KeyboardHandlers = {};
let mockFocused = true;
/** The Session that opens from a tap, as `useHostEntry` reports it. */
let mockBusySession: string | null = null;
let mockAttachedHost: string | null = null;
let mockSettings: { hostScreenTabs?: Record<string, string> } = {};
let mockReading: { listing: unknown; topics: HostTopics; freshness: Freshness; sessionsOnly: boolean; hostRanksGoTo?: boolean; problem: DisconnectReason | null; retry: jest.Mock };

// The push of the screen has ended, so its rows mount.
jest.mock('@/navigation/use-push-ended', () => ({ usePushEnded: () => true }));
jest.mock('expo-router', () => {
  const React = require('react');
  return {
    ...require('@/test-support/toolbar').mockStack,
    useRouter: () => mockRouter,
    useLocalSearchParams: () => ({ id: 'host' }),
    useIsFocused: () => mockFocused,
    useNavigation: () => mockNavigation,
    useFocusEffect: (effect: () => void) => {
      const focused = mockFocused;
      React.useEffect(() => (focused ? effect() : undefined), [effect, focused]);
    },
  };
});
// Native views: the strip shows the tab on show, as the accessibility tree does.
jest.mock('@/components/tab-swipe', () => ({
  TabSwipe: ({ tab, header, renderTab }: {
    tab: string;
    header: (shown: string) => React.ReactNode;
    renderTab: (each: string) => React.ReactNode;
  }) => [header(tab), renderTab(tab)],
}));
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 0 }));
jest.mock('@expo/ui/swift-ui', () => {
  const through = ({ children }: { children?: React.ReactNode }) => children;
  return {
    Button: 'Button', Form: 'Form', Host: 'Host', HStack: 'HStack', VStack: 'VStack', Picker: 'Picker', ProgressView: 'ProgressView',
    Section: 'Section', Text: 'Text', Image: 'Image', Spacer: 'Spacer',
    ContextMenu: Object.assign(through, { Items: through, Trigger: through }),
    SwipeActions: Object.assign(through, { Actions: through }),
  };
});
jest.mock('@expo/ui/swift-ui/modifiers', () => new Proxy({}, { get: (_, name) => (value: unknown) => ({ name, value }) }));
jest.mock('@/components/tappable-row', () => ({ TAPPABLE_ROW: {} }));
jest.mock('@/components/topic-marks', () => ({ MarkImage: () => null, TagMarks: () => null }));
jest.mock('@/components/fill-place-sheet', () => ({ FillPlaceSheet: () => null }));
// The budget has its own test. Here every row mounts in the first render.
jest.mock('@/hooks/use-row-budget', () => ({
  ...jest.requireActual('@/hooks/use-row-budget'),
  useRowBudget: (total: number) => ({ budget: total, more: () => {} }),
}));
jest.mock('@/diagnostics/device-log', () => ({ deviceLog: () => ({ record: () => {} }) }));
jest.mock('@/hooks/use-host-listing', () => ({ useHostListing: () => mockReading }));
jest.mock('@/hooks/use-host-entry', () => ({ useHostEntry: (_host: string, entered: () => void) => ({
  openSession: (name: string) => { mockOpenSession(name); entered(); }, openTopic: mockOpenTopic, wakeSession: mockWake, reopenSettled: mockReopen, openBoardSession: jest.fn(), busyCard: null,
  busySession: mockBusySession,
}) }));
jest.mock('@/hooks/use-card-writes', () => ({ useCardWrites: () => ({ order: jest.fn(), close: jest.fn(), writing: () => false }) }));
jest.mock('@/keyboard/key-commands', () => ({ useScreenKeyboardShortcuts: (handlers: KeyboardHandlers) => { mockKeys = handlers; } }));
jest.mock('@/settings/settings-context', () => ({ useSettings: () => ({
  settings: mockSettings, appearance: 'dark', palette: require('@/constants/app-theme').AppPalettes.dark, rememberHostScreenTab: mockRemember,
}) }));
jest.mock('@/storage/device-store', () => ({
  deviceHostStore: () => ({
    load: async () => ({ hosts: [{ id: 'host', displayName: 'Dev Host' }] }),
    recentSessionsFor: async () => [],
  }),
}));
jest.mock('@/tmux/attach-context', () => ({
  useAttachHolder: () => ({ current: () => null, disconnect: jest.fn() }),
  useCurrentAttach: () => mockAttachedHost && { hostId: mockAttachedHost },
  useAttachState: () => mockAttachedHost && { sessionName: 'api', topic: null, phase: { kind: 'connected' } },
  useOpenSession: () => mockOpen,
}));
jest.mock('@/tmux/ssh-connection', () => ({ appConnections: () => ({ onServer: mockServer.onServer }) }));

const sid = (id: string) => id as SessionId;
const tid = (id: string) => id as TopicId;
const topicCard = (id: string, label: string) =>
  ({ kind: 'topic' as const, mark: null, sessions: [], topic: { id: tid(id), label, note: null, tags: [], state: 'live' as const } });
const snapshot = (): EnvironmentSnapshot => ({
  sidebar: null,
  tags: [],
  sessions: [
    { id: sid('$1'), name: 'api', activity: 0, mark: null, topic: null, windows: null },
    { id: sid('$2'), name: 'api/fix-login', activity: 0, mark: null, topic: tid('t1'), windows: null },
  ],
  pinned: [],
  unpinned: { limit: 3, places: [topicCard('t1', 'Fix login')], guests: [], bench: [] },
  no_topic: [sid('$1')],
});
const got = (shown: EnvironmentSnapshot): Shown => ({ received: { snapshot: shown, at: 0 }, doubt: null });
const path = (name: string): SessionPathRow => ({ kind: 'session_path', name, label: name, directory: `/work/${name}`, worktree: null, alsoIn: [], lastVisit: null });

let renderer: ReactTestRenderer;
async function mount(topics: HostTopics = { kind: 'listed', ...got(snapshot()) }, hostRanksGoTo = false) {
  mockReading = {
    listing: answered([{ name: 'api', windowCount: 1 }, { name: 'api/fix-login', windowCount: 2 }]),
    topics,
    freshness: { kind: 'current' },
    hostRanksGoTo,
    sessionsOnly: topics.kind === 'unavailable',
    problem: null,
    retry: jest.fn(),
  };
  await act(async () => { renderer = create(<HostScreen />); });
  const field = searchBar(renderer);
  if (field) field.props.ref.current = mockSearch;
}
beforeEach(() => {
  jest.clearAllMocks();
  mockSettings = {};
  mockKeys = {};
  mockFocused = true;
  mockAttachedHost = null;
  mockPaths.mockResolvedValue([path('api'), path('web')]);
  mockServer = fakeHostServer();
  mockServer.answer = (payload) => ({ changed: { session_name: newSessionOf(payload)?.name } });
  // The Host's ranked rows for each `session_paths`, and the visits it records.
  mockServer.on.session_paths = async (asked) => sessionPathRowsJson(await mockPaths(asked));
  mockServer.on.visit_session_path = mockVisit;
  mockVisit.mockResolvedValue({});
  mockOpen.mockResolvedValue(undefined);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => { await act(async () => renderer?.unmount()); });

const newSessionOf = (payload: object) =>
  (payload as { environment?: { command: { new_session?: { directory: string; name: string } } } }).environment?.command.new_session;
/** The `new_session` writes the Host Server got. */
const newSessions = () => mockServer.requests.flatMap((payload) => newSessionOf(payload) ?? []);

/** What VoiceOver calls each button on screen, in order. */
/** What the user sees: the Go to list while it is open, which hides the tab under it from VoiceOver. */
const shownRoot = () => renderer.root.findAll((node) => node.props.testID === 'go-to-list')[0] ?? renderer.root;
const labels = () => shownRoot().findAllByType(Button).flatMap((node) => labelOf(node) ?? []);
const row = (label: string) => shownRoot().findAllByType(Button).find((node) => labelOf(node) === label)!;
const READING = 'Reading folders…';
/** The Go to list from top to bottom: each row by what VoiceOver calls it, and the lines about the read. */
const goToLines = () => shownRoot()
  .findAll((node) => node.type === Button || (node.type === ('Text' as never) && node.props.children === READING))
  .map((node) => (node.type === Button ? labelOf(node) : node.props.children))
  .filter((line) => line !== undefined && line !== 'New Session here');
const labelOf = (node: { props: { modifiers?: { name: string; value: unknown }[] } }) =>
  node.props.modifiers?.find((modifier) => modifier.name === 'accessibilityLabel')?.value as string | undefined;
function pendingPaths() {
  const answers: ((value: unknown) => void)[] = [];
  mockPaths.mockImplementation(() => new Promise((resolve) => { answers.push(resolve); }));
  return (rows: ReturnType<typeof path>[]) => act(async () => { answers.shift()!(rows); });
}
const menu = () => [...toolbarMenuActions(renderer).keys()];
const tabs = () => shownRoot().findAllByType(Picker);
const focusGoTo = () => act(async () => { searchBar(renderer)!.props.onFocus(); });
const type = (text: string) => act(async () => { searchBar(renderer)!.props.onChangeText({ nativeEvent: { text } }); });

describe('a Session that opens from a tap', () => {
  afterEach(() => { mockBusySession = null; });

  it('shows a spinner in its row on the Sessions tab and in Go to', async () => {
    mockSettings = { hostScreenTabs: { host: 'sessions' } };
    mockBusySession = 'api';
    await mount();
    expect(row('Session api').findAllByType('ProgressView' as never)).toHaveLength(1);
    expect(row('Session api/fix-login').findAllByType('ProgressView' as never)).toHaveLength(0);

    await focusGoTo();
    expect(row('Session api').findAllByType('ProgressView' as never)).toHaveLength(1);
  });
});

describe('the tabs', () => {
  it('opens on the Board, and remembers Sessions for this Host on a tap and on ⌥⌘T', async () => {
    await mount();

    expect(labels()).toEqual(expect.arrayContaining(['Topic Fix login', 'No Topic']));
    await act(async () => { tabs()[0]!.props.onSelectionChange('sessions'); });
    await act(async () => { mockKeys['switch-tab']!(); });

    expect(mockRemember.mock.calls).toEqual([['host', 'sessions'], ['host', 'sessions']]);
  });

  it('shows every running Session on the Sessions tab that the user last chose, with its Actions', async () => {
    mockSettings = { hostScreenTabs: { host: 'sessions' } };
    await mount();

    // Remove from Topic only for the Session in a Topic.
    expect(labels()).toEqual([
      'Rename Session…', 'Move to Topic…', 'Kill Session…', 'Session api',
      'Rename Session…', 'Move to Topic…', 'Remove from Topic', 'Kill Session…', 'Session api/fix-login',
    ]);
  });
});

describe('a Host that cannot be reached', () => {
  it.each(['board', 'sessions'] as const)('says so once on the %s tab, with one Try again that holds the Host again', async (tab) => {
    mockSettings = { hostScreenTabs: { host: tab } };
    await mount();
    mockReading = {
      ...mockReading,
      listing: HOST_PROBLEM,
      topics: { kind: 'host-problem', last: got(snapshot()) },
      problem: { kind: 'host-unreachable', detail: 'The Host did not answer in time.' },
    };
    await act(async () => renderer.update(<HostScreen />));

    expect(labels().filter((label) => label === 'Try again' || label === 'Retry')).toEqual(['Try again']);
    expect(labels()).not.toContain('Topic Fix login');
    await act(async () => row('Try again').props.onPress());
    expect(mockReading.retry).toHaveBeenCalled();
  });
});

describe('in Sessions only', () => {
  it('has no bar and no New Topic, and keeps New Session in Options with the Session form', async () => {
    await mount({ kind: 'unavailable', host: 'Dev Host', reason: 'the Host Server did not answer' });

    expect(searchBar(renderer)).toBeUndefined();
    expect(menu()).toEqual(['New Session', 'Configure chooser']);
    expect(mockKeys['go-to']).toBeUndefined();
    expect(mockKeys['new-topic']).toBeUndefined();

    toolbarMenuActions(renderer).get('New Session')!.props.onPress();
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/session-form', params: { hostId: 'host' } });
  });
});

describe('the bar at the bottom', () => {
  it('has Go to and ＋, and moves New Topic and New Session out of Options', async () => {
    await mount();

    expect(searchBar(renderer)!.props.placeholder).toBe('Go to');
    expect(menu()).toEqual(['Mark All as Read', 'Configure chooser', 'New Topic', 'New Session at a folder']);

    toolbarMenuActions(renderer).get('New Topic')!.props.onPress();
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/new-topic', params: { hostId: 'host' } });
  });

  it('puts the keys in the Go to field for ⌘P', async () => {
    await mount();
    await act(async () => { mockKeys['go-to']!(); });

    expect(mockSearch.focus).toHaveBeenCalled();
  });

  it('is gone while another screen has the focus, and takes ⌘P from the Terminal when it comes back', async () => {
    await mount();
    mockFocused = false;
    await act(async () => { renderer.update(<HostScreen />); });

    expect(searchBar(renderer)).toBeUndefined();

    requestGoTo('host', { kind: 'terminal' });
    mockFocused = true;
    await act(async () => { renderer.update(<HostScreen />); });

    expect(searchBar(renderer)).toBeDefined();
    expect(mockSearch.focus).toHaveBeenCalledTimes(1);
  });

  async function askedFrom(from: Parameters<typeof requestGoTo>[1]) {
    mockAttachedHost = 'host';
    await mount();
    mockFocused = false;
    await act(async () => { renderer.update(<HostScreen />); });
    requestGoTo('host', from);
    mockFocused = true;
    await act(async () => { renderer.update(<HostScreen />); });
    await act(async () => { searchBar(renderer)!.props.onFocus(); });
    mockRouter.push.mockClear();
  }

  it('goes back to the Terminal Screen when Go to that it asked for is cancelled', async () => {
    await askedFrom({ kind: 'terminal' });
    await act(async () => { searchBar(renderer)!.props.onCancelButtonPress(); });

    expect(mockRouter.push).toHaveBeenCalledWith('/terminal');
  });

  it('goes back to the page when Go to that the Web View asked for is closed with Escape', async () => {
    const tab = { url: 'https://example.com/', page: 'https://example.com/a', scrollY: 120 };
    await askedFrom({ kind: 'page', tab });
    await act(async () => { mockKeys['list-close']!(); });

    expect(mockRouter.push).toHaveBeenCalledWith(placeTabRoute(tab));
  });

  it('stays on the Host Screen when Go to opened here is cancelled', async () => {
    mockAttachedHost = 'host';
    await mount();
    await act(async () => { searchBar(renderer)!.props.onFocus(); });
    await act(async () => { searchBar(renderer)!.props.onCancelButtonPress(); });

    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('goes away while a Topic card moves', async () => {
    await mount();
    await act(async () => { row('Move…').props.onPress(); });

    expect(searchBar(renderer)).toBeUndefined();
    expect(mockKeys['go-to']).toBeUndefined();
  });
});

describe('Go to on a Host that ranks the list', () => {
  const frames = protocolFrames('6-go-to');
  const rankedAnswer = frames[3]!.end.ok;
  const taggedAnswer = frames[5]!.end.ok;

  async function ranked(answer = rankedAnswer) {
    mockServer.on.go_to = () => answer;
    await mount(undefined, true);
    await focusGoTo();
  }

  it.each(['host', 'other'])('sends the current Session only for the attached Host (%s)', async (hostId) => {
    mockAttachedHost = hostId;
    await ranked();
    const query = hostId === 'host' ? { query: '', current_session: 'api' } : { query: '' };
    expect(mockServer.requests.at(-1)).toEqual({ go_to: query });
  });

  it('shows the Host sections and row order and opens a Topic, a Board Session and a running Session by their targets', async () => {
    await ranked();
    expect(labels()).toEqual(['Topic Ship music', 'Reopen music-logs', 'Folder /code/music', 'Session muxify']);
    expect(mockPaths).not.toHaveBeenCalled();
    await act(async () => { row('Topic Ship music').props.onPress(); });
    expect(mockOpenTopic).toHaveBeenCalledWith(expect.objectContaining({ id: 't1', state: 'live' }));
    await act(async () => { row('Reopen music-logs').props.onPress(); });
    expect(mockWake).toHaveBeenCalledWith('s1', 'reopen');
    await act(async () => { row('Session muxify').props.onPress(); });
    expect(mockOpenSession).toHaveBeenCalledWith('muxify');
  });

  it('opens the Session Path at its directory with the launch name the Host sent', async () => {
    await ranked();
    await act(async () => { row('Folder /code/music').props.onPress(); });
    expect(newSessions()).toEqual([{ directory: '/code/music', name: 'music' }]);
  });

  it('shows the empty-field answer as soon as the user clears a query', async () => {
    jest.useFakeTimers();
    try {
      await ranked();
      mockServer.on.go_to = () => taggedAnswer;
      await type('#back');
      await act(async () => { jest.runAllTimers(); });
      expect(labels()).toContain('Tag #backend');
      mockServer.on.go_to = () => rankedAnswer;
      await type('');
      expect(labels()).toContain('Folder /code/music');
    } finally {
      jest.useRealTimers();
    }
  });

  it('highlights Swift Character offsets across an emoji family and a combining accent', async () => {
    const title = { text: 'A👨‍👩‍👧‍👦e\u0301Z', marks: [1, 2] };
    await ranked({ sections: [{ id: 'topics', title: null, rows: [{ ...rankedAnswer.sections[0].rows[0], title }] }] });
    const bold = renderer.root.findAll((node) => node.type === ('Text' as never) &&
      node.props.modifiers?.some((m: { name: string; value?: { weight?: string } }) => m.name === 'font' && m.value?.weight === 'bold'));
    expect(bold.map((part) => part.props.children)).toEqual(['👨‍👩‍👧‍👦e\u0301']);
  });

  it('opens each time as a new search, with no rows from the last open', async () => {
    await ranked();
    expect(labels()).toContain('Topic Ship music');
    await type('ship');
    // iOS empties the field after its Cancel, as a change of the text.
    await act(async () => { searchBar(renderer)!.props.onCancelButtonPress(); });
    const asked = mockServer.requests.length;
    await type('');
    expect(mockServer.requests).toHaveLength(asked);

    let answer!: (value: unknown) => void;
    mockServer.on.go_to = () => new Promise((resolve) => { answer = resolve; });
    await focusGoTo();
    expect(labels()).not.toContain('Topic Ship music');
    await act(async () => { answer(rankedAnswer); });
    expect(labels()).toContain('Topic Ship music');
  });

  it('reopens a Settled Topic by id', async () => {
    const topic = rankedAnswer.sections[0].rows[0];
    await ranked({ sections: [{ id: 'settled', title: 'Settled', rows: [{ ...topic, target: { settled: { id: 'closed' } } }] }] });
    await act(async () => { row('Reopen Ship music').props.onPress(); });
    expect(mockReopen).toHaveBeenCalledWith('closed');
  });

  it('lists a Tag by name with an empty field and does not keep a Tag filter on cancel', async () => {
    await ranked(taggedAnswer);
    mockServer.on.go_to = () => frames[7]!.end.ok;
    await act(async () => { row('Tag #backend').props.onPress(); });
    expect(mockServer.requests.at(-1)).toEqual({ go_to: { query: '', tag: 'backend' } });
    expect(labels()).toEqual(['Topic Ship music']);
    const asked = mockServer.requests.length;
    await act(async () => { searchBar(renderer)!.props.onCancelButtonPress(); });
    expect(mockServer.requests).toHaveLength(asked);
    await act(async () => { searchBar(renderer)!.props.onFocus(); });
    expect(mockServer.requests.at(-1)).toEqual({ go_to: { query: '' } });
  });

  describe('on a slow link', () => {
    /** The `go_to` requests that wait for an answer, by the text they ask for. */
    let waiting: Record<string, { answer(value: unknown): void; fail(error: unknown): void }>;
    const texts = () => renderer.root.findAllByType('Text' as never).map((node) => node.props.children);
    const goToRequests = () => mockServer.requests.filter((payload) => 'go_to' in payload);

    beforeEach(async () => {
      jest.useFakeTimers();
      await ranked();
      waiting = {};
      mockServer.on.go_to = (payload) => new Promise((resolve, reject) => {
        waiting[(payload as { query: string }).query] = { answer: resolve, fail: reject };
      });
    });
    afterEach(() => { jest.useRealTimers(); });

    it('keeps the rows and says that it reads from the keystroke, cancels the replaced read, and drops its late answer', async () => {
      const before = labels();
      const sent = goToRequests().length;
      await type('m');
      expect(goToRequests()).toHaveLength(sent);
      expect(texts()).toContain('Reading Go to…');
      expect(labels()).toEqual(before);

      await act(async () => { jest.advanceTimersByTime(150); });
      await type('mu');
      await act(async () => { jest.advanceTimersByTime(150); });
      expect(mockServer.cancelled).toEqual([{ go_to: { query: 'm' } }]);

      await act(async () => { waiting.m!.answer(taggedAnswer); });
      expect(labels()).toEqual(before);
      expect(texts()).toContain('Reading Go to…');

      await act(async () => { waiting.mu!.answer(taggedAnswer); });
      expect(labels()).toContain('Tag #backend');
      expect(texts()).not.toContain('Reading Go to…');
    });

    it('offers Try again for a failed read, and shows at once that it tries again', async () => {
      await type('x');
      await act(async () => { jest.advanceTimersByTime(150); });
      await act(async () => { waiting.x!.fail(refused('The Config is broken.', 'config_invalid')); });
      expect(texts()).toContain('The Config is broken.');

      await act(async () => { row('Try again').props.onPress(); });
      expect(texts()).toEqual(expect.arrayContaining(['Trying again…', 'The Config is broken.']));
      expect(labels()).toContain('Try again, in progress');

      await act(async () => { waiting.x!.answer(taggedAnswer); });
      expect(texts()).not.toContain('The Config is broken.');
      expect(labels()).toContain('Tag #backend');
    });

    it('waits on Return for the answer to the text typed, then opens its first row', async () => {
      await type('ship');
      await act(async () => { searchBar(renderer)!.props.onSearchButtonPress(); });
      expect(mockOpenTopic).not.toHaveBeenCalled();

      await act(async () => { jest.advanceTimersByTime(150); });
      await act(async () => { waiting.ship!.answer(rankedAnswer); });
      expect(mockOpenTopic).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }));
    });
  });
});

describe('Go to', () => {
  it('shows one list in place of the tab: the running Sessions with their Topic, then the folders', async () => {
    await mount();
    await focusGoTo();

    expect(tabs()).toEqual([]);
    expect(labels().filter((label) => label !== 'New Session here')).toEqual(['Session api', 'Session api/fix-login', 'Folder /work/api', 'Folder /work/web']);
  });

  it('asks the Host Server for the folders of an empty field, and draws them in its order after the running Sessions', async () => {
    mockPaths.mockResolvedValue([path('web'), path('api')]);
    await mount();
    await focusGoTo();

    expect(mockPaths).toHaveBeenCalledWith({});
    expect(labels().filter((label) => label !== 'New Session here')).toEqual(['Session api', 'Session api/fix-login', 'Folder /work/web', 'Folder /work/api']);
  });

  it('matches the running Sessions by the text in the field, and asks the Host for the folders', async () => {
    jest.useFakeTimers();
    await mount();
    await focusGoTo();
    mockPaths.mockResolvedValue([path('web')]);
    await type('login');
    await act(async () => { jest.runAllTimers(); });
    jest.useRealTimers();

    expect(mockPaths).toHaveBeenLastCalledWith({ query: 'login' });
    expect(labels().filter((label) => label !== 'New Session here')).toEqual(['Session api/fix-login', 'Folder /work/web']);
  });

  it('goes to a running Session, and shows the tab again', async () => {
    await mount();
    await focusGoTo();
    await act(async () => { row('Session api/fix-login').props.onPress(); });

    expect(mockOpenSession).toHaveBeenCalledWith('api/fix-login');
    expect(mockRouter.push).toHaveBeenCalledWith('/terminal');
    expect(mockSearch.cancelSearch).toHaveBeenCalled();
    expect(tabs()).toHaveLength(1);
  });

  it('goes to the Session in no Topic that runs at a folder, makes none, and records the visit', async () => {
    await mount();
    await focusGoTo();
    await act(async () => { row('Folder /work/api').props.onPress(); });

    expect(mockOpenSession).toHaveBeenCalledWith('api');
    expect(newSessions()).toEqual([]);
    expect(mockVisit).toHaveBeenCalledWith({ folder: '/work/api' });
  });

  it('makes a Session at a folder where none runs, opens it, and records the visit', async () => {
    await mount();
    await focusGoTo();
    await act(async () => { row('Folder /work/web').props.onPress(); });

    expect(newSessions()).toEqual([{ directory: '/work/web', name: 'web' }]);
    expect(mockOpen).toHaveBeenCalledWith(expect.objectContaining({ destination: { sessionName: 'web', topic: null } }));
    expect(mockVisit).toHaveBeenCalledWith({ folder: '/work/web' });
    expect(mockRouter.push).toHaveBeenCalledWith('/terminal');
  });

  it('makes one more Session with a +2 name for New Session here, and for ⌘↩ on the row', async () => {
    await mount();
    await focusGoTo();
    const [here] = renderer.root.findAllByType(Button).filter((node) => node.props.label === 'New Session here');
    await act(async () => { here!.props.onPress(); });

    expect(newSessions()).toEqual([{ directory: '/work/api', name: 'api+2' }]);

    await focusGoTo();
    await act(async () => { mockKeys['list-down']!(); });
    await act(async () => { mockKeys['list-down']!(); });
    await act(async () => { mockKeys['list-down']!(); });
    await act(async () => { mockKeys['new-session-here']!(); });
    expect(newSessions().at(-1)).toEqual({ directory: '/work/web', name: 'web' });
  });

  it('picks the row that ↓ moved to on Return, from a hardware keyboard and from the software one', async () => {
    await mount();
    await focusGoTo();
    await act(async () => { mockKeys['list-down']!(); });
    await act(async () => { mockKeys['list-pick']!(); });
    expect(mockOpenSession).toHaveBeenLastCalledWith('api/fix-login');

    await focusGoTo();
    await act(async () => { searchBar(renderer)!.props.onSearchButtonPress(); });
    expect(mockOpenSession).toHaveBeenLastCalledWith('api');
  });

  it('has the List Keys only while the list is on show, and closes on Escape', async () => {
    await mount();
    expect(mockKeys['list-pick']).toBeUndefined();

    await focusGoTo();
    await act(async () => { mockKeys['list-close']!(); });

    expect(tabs()).toHaveLength(1);
    expect(mockKeys['list-pick']).toBeUndefined();
  });

  it('keeps the list and says why when the Host refuses the folder, and sends a new Request on Retry', async () => {
    mockServer.answer = () => { throw refused('No folder at /work/web.', 'session_path_unavailable'); };
    await mount();
    await focusGoTo();
    await act(async () => { row('Folder /work/web').props.onPress(); });

    expect(renderer.root.findAllByType('Text' as never).map((node) => node.props.children)).toContain('No folder at /work/web.');
    expect(mockRouter.push).not.toHaveBeenCalled();

    await act(async () => { renderer.root.findAllByType(Button).find((node) => node.props.label === 'Retry')!.props.onPress(); });
    const [first, second] = mockServer.writes();
    expect(mockServer.writes()).toHaveLength(2);
    expect(second!.request).not.toBe(first!.request);
  });
});

describe('Go to while the Host reads the folders', () => {
  it('says so above the rows on show, keeps them for a tap, and stops when the answer comes', async () => {
    const answer = pendingPaths();
    await mount();
    await focusGoTo();

    expect(goToLines()).toEqual([READING, 'Session api', 'Session api/fix-login']);
    await act(async () => { mockKeys['list-down']!(); mockKeys['list-down']!(); mockKeys['list-down']!(); });
    await act(async () => { mockKeys['list-pick']!(); });
    expect(mockOpenSession).toHaveBeenLastCalledWith('api/fix-login');

    // The pick closed Go to, which dropped its read. The new open asks again.
    await focusGoTo();
    await answer([path('old')]);
    expect(goToLines()).toEqual([READING, 'Session api', 'Session api/fix-login']);
    await answer([path('web')]);
    expect(goToLines()).toEqual(['Session api', 'Session api/fix-login', 'Folder /work/web']);
  });

  it('says it once, in place of Nothing matches, while no row matches', async () => {
    jest.useFakeTimers();
    pendingPaths();
    await mount();
    await focusGoTo();
    await type('zzz');
    await act(async () => { jest.runAllTimers(); });
    jest.useRealTimers();

    expect(goToLines()).toEqual([READING]);
    expect(renderer.root.findAllByType('Text' as never).filter((node) => node.props.children === 'Nothing matches.')).toEqual([]);
  });

  it('opens each time as a new search, with no folders from the last open', async () => {
    await mount();
    await focusGoTo();
    expect(goToLines()).toEqual(['Session api', 'Session api/fix-login', 'Folder /work/api', 'Folder /work/web']);
    await act(async () => { searchBar(renderer)!.props.onCancelButtonPress(); });

    const answer = pendingPaths();
    await focusGoTo();
    expect(goToLines()).toEqual([READING, 'Session api', 'Session api/fix-login']);
    await answer([path('web')]);
    expect(goToLines()).toEqual(['Session api', 'Session api/fix-login', 'Folder /work/web']);
  });
});

describe('New Session at a folder', () => {
  it('lists the folders only, and always makes a Session, with a free name', async () => {
    await mount();
    await act(async () => { toolbarMenuActions(renderer).get('New Session at a folder')!.props.onPress(); });

    expect(mockSearch.focus).toHaveBeenCalled();
    expect(searchBar(renderer)!.props.placeholder).toBe('New Session at a folder');
    expect(labels()).toEqual(['Folder /work/api', 'Folder /work/web']);

    await act(async () => { row('Folder /work/api').props.onPress(); });
    expect(newSessions()).toEqual([{ directory: '/work/api', name: 'api+2' }]);
    expect(mockOpenSession).not.toHaveBeenCalled();
  });
});
