import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Button, Picker } from '@expo/ui/swift-ui';

import HostScreen from '@/app/hosts/[id]';
import { answered, HOST_PROBLEM } from '@/domain/host-listing';
import { requestGoTo } from '@/keyboard/go-to-request';
import type { KeyboardHandlers } from '@/keyboard/key-commands';
import { fakeHostServer, refused } from '@/test-support/fake-host-server';
import { searchBar, toolbarMenuActions } from '@/test-support/toolbar';
import type { EnvironmentSnapshot, SessionId, TopicId } from '@/topics/environment';
import type { DisconnectReason } from '@/tmux/disconnect-reason';
import type { HostTopics } from '@/topics/host-topics';
import { sessionPathRowsJson, type SessionPathRow } from '@/topics/session-paths';

const mockRouter = { push: jest.fn() };
const mockRemember = jest.fn();
const mockOpenSession = jest.fn();
const mockOpen = jest.fn();
const mockPaths = jest.fn();
let mockServer = fakeHostServer();
const mockVisit = jest.fn();
const mockSearch = { focus: jest.fn(), cancelSearch: jest.fn() };
let mockKeys: KeyboardHandlers = {};
let mockFocused = true;
let mockSettings: { hostScreenTabs?: Record<string, string> } = {};
let mockReading: { listing: unknown; topics: HostTopics; sessionsOnly: boolean; problem: DisconnectReason | null; retry: jest.Mock };

jest.mock('expo-router', () => {
  const React = require('react');
  return {
    ...require('@/test-support/toolbar').mockStack,
    useRouter: () => mockRouter,
    useLocalSearchParams: () => ({ id: 'host' }),
    useIsFocused: () => mockFocused,
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
jest.mock('@/diagnostics/device-log', () => ({ deviceLog: () => ({ record: () => {} }) }));
jest.mock('@/hooks/use-host-listing', () => ({ useHostListing: () => mockReading }));
jest.mock('@/hooks/use-host-entry', () => ({ useHostEntry: (_host: string, entered: () => void) => ({
  openSession: (name: string) => { mockOpenSession(name); entered(); }, openTopic: jest.fn(), openBoardSession: jest.fn(), busyCard: null,
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
  deviceGoToCache: () => ({ load: async () => [], save: async () => {} }),
}));
jest.mock('@/tmux/attach-context', () => ({
  useAttachHolder: () => ({ current: () => null, disconnect: jest.fn() }),
  useCurrentAttach: () => null,
  useAttachState: () => null,
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
const path = (name: string): SessionPathRow => ({ kind: 'session_path', name, label: name, directory: `/work/${name}`, worktree: null, alsoIn: [], lastVisit: null });

let renderer: ReactTestRenderer;
async function mount(topics: HostTopics = { kind: 'listed', snapshot: snapshot() }) {
  mockReading = {
    listing: answered([{ name: 'api', windowCount: 1 }, { name: 'api/fix-login', windowCount: 2 }]),
    topics,
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
const labels = () => renderer.root.findAllByType(Button).flatMap((node) => labelOf(node) ?? []);
const row = (label: string) => renderer.root.findAllByType(Button).find((node) => labelOf(node) === label)!;
const READING = 'Reading folders…';
const WAITING = 'The Host sent a new list. It shows when you type.';
/** The Go to list from top to bottom: each row by what VoiceOver calls it, and the lines about the read. */
const goToLines = () => renderer.root
  .findAll((node) => node.type === Button || (node.type === ('Text' as never) && [READING, WAITING].includes(node.props.children)))
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
const tabs = () => renderer.root.findAllByType(Picker);
const focusGoTo = () => act(async () => { searchBar(renderer)!.props.onFocus(); });
const type = (text: string) => act(async () => { searchBar(renderer)!.props.onChangeText({ nativeEvent: { text } }); });

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
      'Rename Session…', 'Kill Session…', 'Session api',
      'Rename Session…', 'Remove from Topic', 'Kill Session…', 'Session api/fix-login',
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
      topics: { kind: 'host-problem', last: snapshot() },
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

    requestGoTo('host');
    mockFocused = true;
    await act(async () => { renderer.update(<HostScreen />); });

    expect(searchBar(renderer)).toBeDefined();
    expect(mockSearch.focus).toHaveBeenCalledTimes(1);
  });

  it('goes away while a Topic card moves', async () => {
    await mount();
    await act(async () => { row('Move…').props.onPress(); });

    expect(searchBar(renderer)).toBeUndefined();
    expect(mockKeys['go-to']).toBeUndefined();
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
  it('says so after the rows on show, so no row moves, and stops when the answer comes', async () => {
    const answer = pendingPaths();
    await mount();
    await focusGoTo();

    expect(goToLines()).toEqual(['Session api', 'Session api/fix-login', READING]);
    await act(async () => { mockKeys['list-down']!(); mockKeys['list-down']!(); mockKeys['list-down']!(); });
    await act(async () => { mockKeys['list-pick']!(); });
    expect(mockOpenSession).toHaveBeenLastCalledWith('api/fix-login');

    await focusGoTo();
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

  // The screen comes back from the Terminal and reads again, and the user opens Go to before the answer.
  async function comeBackAndOpenGoTo() {
    await mount();
    const answer = pendingPaths();
    mockFocused = false;
    await act(async () => { renderer.update(<HostScreen />); });
    mockFocused = true;
    await act(async () => { renderer.update(<HostScreen />); });
    await focusGoTo();
    return answer;
  }

  it('keeps the folders on show in place while the field is empty, and says that a new list waits for the text', async () => {
    const answer = await comeBackAndOpenGoTo();
    expect(goToLines()).toEqual(['Session api', 'Session api/fix-login', 'Folder /work/api', 'Folder /work/web', READING]);

    await answer([path('web'), path('api')]);
    expect(goToLines()).toEqual(['Session api', 'Session api/fix-login', 'Folder /work/api', 'Folder /work/web', WAITING]);
  });

  it('shows a new answer at once, with no line, when it moves no row', async () => {
    const answer = await comeBackAndOpenGoTo();
    await answer([path('api'), path('web')]);

    expect(goToLines()).toEqual(['Session api', 'Session api/fix-login', 'Folder /work/api', 'Folder /work/web']);
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
