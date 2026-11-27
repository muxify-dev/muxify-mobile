import React from 'react';
import { Alert, type AlertButton } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Button, Picker } from '@expo/ui/swift-ui';

import HostScreen from '@/app/hosts/[id]';
import { HostProblem } from '@/ssh/failures';
import { followListing, type ListingFeed } from '@/ssh/host-listing-feed';
import type { HostServer, HostServerState } from '@/ssh/host-server';
import { protocolFrames } from '@/test-support/protocol-frames';
import { searchBar, toolbarMenuActions } from '@/test-support/toolbar';
import type { DisconnectReason } from '@/tmux/disconnect-reason';
import type { HostCliState } from '@/topics/host-cli-install';

/**
 * The Host Screen through a fake Host Server: the real Listing feed and the
 * real hook, on a registry that the test drives.
 */

const mockRouter = { push: jest.fn() };
const mockSend = jest.fn();
const mockTmuxSend = jest.fn();
let mockSettings: Record<string, unknown> = {};
const mockRelease = jest.fn();
let mockFocused = true;
let mockConnections: Record<string, unknown>;

// The push of the screen has ended, so its rows mount.
jest.mock('@/navigation/use-push-ended', () => ({ usePushEnded: () => true }));
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
// The budget has its own test. Here every row mounts in the first render.
jest.mock('@/hooks/use-row-budget', () => ({
  ...jest.requireActual('@/hooks/use-row-budget'),
  useRowBudget: (total: number) => ({ budget: total, more: () => {} }),
}));
jest.mock('@/diagnostics/device-log', () => ({ deviceLog: () => ({ record: () => {} }) }));
jest.mock('@/hooks/use-host-entry', () => ({ useHostEntry: () => ({ openSession: jest.fn(), openTopic: jest.fn(), openBoardSession: jest.fn(), busyCard: null }) }));
jest.mock('@/hooks/use-go-to-paths', () => {
  // A Go to list that was never asked: these tests are about the Listing.
  const unasked = { isPending: false, data: undefined, dataKey: undefined, error: null, ask: () => {}, retry: () => {}, cancel: () => {}, forget: () => {}, whenAnswered: () => {} };
  return { ...jest.requireActual('@/hooks/use-go-to-paths'), useHostGoTo: () => unasked, useGoToPaths: () => unasked };
});
jest.mock('@/topics/act-on-card', () => ({
  ...jest.requireActual('@/topics/act-on-card'),
  sendCardOrder: (...args: unknown[]) => mockSend(...args),
  closeTopic: (...args: unknown[]) => mockSend(...args),
}));
jest.mock('@/topics/tmux-order', () => ({
  ...jest.requireActual('@/topics/tmux-order'),
  sendTmuxOrder: (...args: unknown[]) => mockTmuxSend(...args),
}));
jest.mock('@/keyboard/key-commands', () => ({ useScreenKeyboardShortcuts: () => {} }));
jest.mock('@/settings/settings-context', () => ({ useSettings: () => ({
  settings: mockSettings, appearance: 'dark', palette: require('@/constants/app-theme').AppPalettes.dark, rememberHostScreenTab: jest.fn(),
}) }));
jest.mock('@/storage/device-store', () => ({
  deviceHostStore: () => ({
    load: async () => ({ hosts: [{ id: 'host', displayName: 'Dev Host' }] }),
    recentSessionsFor: async () => [],
  }),
}));
jest.mock('@/tmux/attach-context', () => ({
  useAttachHolder: () => ({ current: () => null, disconnect: jest.fn() }),
  useCurrentAttach: () => null,
  useAttachState: () => null,
  useOpenSession: jest.fn(),
}));
jest.mock('@/tmux/ssh-connection', () => ({ appConnections: () => mockConnections }));

/** A Host Server that the test moves and pushes snapshots from. */
function fakeServer(initial: HostServerState) {
  let state = initial;
  const listeners = new Set<(state: HostServerState) => void>();
  const items: ((item: unknown) => void)[] = [];
  const subscriptions: object[] = [];
  const never = () => Object.assign(new Promise<unknown>(() => {}), { cancel: () => {} });
  const server: HostServer = {
    state: () => state,
    onState: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    request: never,
    subscribe: (payload, onItem) => {
      subscriptions.push(payload);
      items.push(onItem);
      return never();
    },
    installAnswered: () => {},
    tryAgain: () => {},
    close: () => {},
  };
  return {
    server,
    subscriptions,
    become(next: HostServerState) {
      state = next;
      for (const listener of [...listeners]) listener(next);
    },
    push: (item: unknown) => act(async () => { items[items.length - 1]!(item); }),
    /** A push on the `nth` subscription, such as one that ran before the app went to the background. */
    pushOn: (nth: number, item: unknown) => act(async () => { items[nth]!(item); }),
  };
}

const T0 = { kind: 'topic', id: 't0' };

/** A snapshot as the Host Server pushes it: one Session in a Topic In Play for each label. */
const snapshotItem = (...labels: string[]) => ({
  no_topic: [],
  pinned: [],
  sessions: labels.map((label, index) => ({
    activity: 1763100000, id: `$${index}`, mark: null, name: label.toLowerCase(), topic: `t${index}`,
    windows: [{ active: true, id: `@${index}`, index: 0, mark: null, name: 'shell' }],
  })),
  sidebar: { sessions: true, topics: true },
  tags: [],
  unpinned: {
    bench: [], guests: [], kind: 'in_play', limit: 3,
    places: labels.map((label, index) => ({
      kind: 'topic', mark: null, sessions: [`$${index}`],
      topic: { id: `t${index}`, label, note: null, state: 'live', tags: [] },
    })),
  },
});

let renderer: ReactTestRenderer;
let feed: ListingFeed;
let hostCli: HostCliState;
let read: jest.Mock;
const listingListeners = new Set<(hostId: string) => void>();
const listingChanged = () => { for (const listener of [...listingListeners]) listener('host'); };
let problem: DisconnectReason | null;
const problemListeners = new Set<(hostId: string) => void>();
/** The Host Problem as the Connections set and clear it. */
const setProblem = (reason: DisconnectReason | null) => {
  problem = reason;
  for (const listener of [...problemListeners]) listener('host');
};

/** A new Connection, whose Host Server the registry follows from now on. */
function connect(initial: HostServerState) {
  const fake = fakeServer(initial);
  const mine = followListing(fake.server);
  feed = mine;
  mine.onChange(() => { if (feed === mine) listingChanged(); });
  listingChanged();
  return fake;
}

async function mount() {
  await act(async () => { renderer = create(<HostScreen />); });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFocused = true;
  hostCli = { kind: 'idle' };
  problem = null;
  problemListeners.clear();
  read = jest.fn(async () => [{ name: 'api', windowCount: 1 }]);
  mockSend.mockResolvedValue({ kind: 'changed' });
  mockTmuxSend.mockResolvedValue({ kind: 'changed' });
  mockSettings = {};
  mockConnections = {
    hold: jest.fn(async () => mockRelease),
    listing: () => feed.current(),
    subscribeListing: (listener: (hostId: string) => void) => {
      listingListeners.add(listener);
      return () => listingListeners.delete(listener);
    },
    hostCli: () => hostCli,
    subscribeHostCli: () => () => {},
    problem: () => problem,
    subscribeProblem: (listener: (hostId: string) => void) => {
      problemListeners.add(listener);
      return () => problemListeners.delete(listener);
    },
    read,
    write: jest.fn(),
  };
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => { await act(async () => renderer?.unmount()); });

/** What the user sees: the Go to list while it is open, which hides the tab under it from VoiceOver. */
const shownRoot = () => renderer.root.findAll((node) => node.props.testID === 'go-to-list')[0] ?? renderer.root;
const labels = () => shownRoot().findAllByType(Button).flatMap((node) =>
  (node.props.modifiers ?? []).flatMap((modifier: { name: string; value: unknown }) => (modifier.name === 'accessibilityLabel' ? [modifier.value as string] : [])));
const button = (label: string) => shownRoot().findAllByType(Button)
  .find((node) => node.props.modifiers?.some((modifier: { name: string; value: unknown }) => modifier.name === 'accessibilityLabel' && modifier.value === label))!;
const labelled = (label: string) => shownRoot().findAllByType(Button)
  .filter((node) => node.props.modifiers?.some((modifier: { name: string; value: unknown }) => modifier.name === 'accessibilityLabel' && modifier.value === label));
const texts = () => shownRoot().findAllByType('Text' as never).map((node) => node.props.children);
const topics = () => labels().filter((label) => label.startsWith('Topic '));

describe('a live Host Screen', () => {
  it('says once that it cannot reach the Host, and holds it again when any use reaches it', async () => {
    const unreachable = { kind: 'host-unreachable', detail: 'Connection refused' } as const;
    connect({ kind: 'live', build: 'muxify 1', protocol: 1 });
    (mockConnections.hold as jest.Mock).mockImplementationOnce(async () => {
      setProblem(unreachable);
      throw new HostProblem(unreachable);
    });
    await mount();

    expect(texts()).toContain('Could not reach Dev Host');
    expect(labels().filter((label) => label === 'Try again' || label === 'Retry')).toEqual(['Try again']);

    await act(async () => { setProblem(null); });

    expect(mockConnections.hold).toHaveBeenCalledTimes(2);
    expect(texts()).not.toContain('Could not reach Dev Host');
  });

  it('says at once that it tries again, keeps the reason, and ignores a second tap until the hold ends', async () => {
    const unreachable = { kind: 'host-unreachable', detail: 'Connection refused' } as const;
    connect({ kind: 'live', build: 'muxify 1', protocol: 1 });
    (mockConnections.hold as jest.Mock).mockImplementationOnce(async () => {
      setProblem(unreachable);
      throw new HostProblem(unreachable);
    });
    await mount();
    let fail!: () => void;
    (mockConnections.hold as jest.Mock).mockImplementationOnce(() => new Promise((_resolve, reject) => {
      fail = () => reject(new HostProblem(unreachable));
    }));

    act(() => { button('Try again').props.onPress(); });
    expect(texts()).toEqual(expect.arrayContaining(['Could not reach Dev Host', 'Trying again…']));
    expect(labels()).toContain('Try again, in progress');
    await act(async () => { button('Try again, in progress').props.onPress(); });
    expect(mockConnections.hold).toHaveBeenCalledTimes(2);

    await act(async () => { fail(); });
    expect(texts()).not.toContain('Trying again…');
    expect(labels()).toContain('Try again');
  });

  it('holds its Connection while focused, draws each pushed snapshot, and reads nothing on focus', async () => {
    const server = connect({ kind: 'live', build: 'muxify 1', protocol: 1 });
    await mount();

    expect(mockConnections.hold).toHaveBeenCalledWith(expect.objectContaining({ id: 'host' }));
    expect(server.subscriptions).toEqual([{ snapshot: {} }]);
    expect(texts()).toContain('Reading Dev Host…');

    await server.push(snapshotItem('Ship'));
    expect(topics()).toEqual(['Topic Ship']);

    // Made on the Host, with no focus and no read.
    await server.push(snapshotItem('Ship', 'Docs'));
    expect(topics()).toEqual(['Topic Ship', 'Topic Docs']);
    expect(texts()).not.toContain('Reading Dev Host…');

    mockFocused = false;
    await act(async () => { renderer.update(<HostScreen />); });
    expect(mockRelease).toHaveBeenCalledTimes(1);
    mockFocused = true;
    await act(async () => { renderer.update(<HostScreen />); });

    expect(read).not.toHaveBeenCalled();
    expect(mockConnections.hold).toHaveBeenCalledTimes(2);
  });

  it('reads nothing after a card write or on a Move start: the push brings the change', async () => {
    const server = connect({ kind: 'live', build: 'muxify 1', protocol: 1 });
    await mount();
    await server.push(snapshotItem('Ship', 'Docs'));

    await act(async () => { button('Move Down').props.onPress(); });
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ id: 'host' }), T0, { kind: 'action', action: 'move-down' }, expect.any(Function));
    expect(topics()).toEqual(['Topic Ship', 'Topic Docs']);

    await server.push(snapshotItem('Docs', 'Ship'));
    expect(topics()).toEqual(['Topic Docs', 'Topic Ship']);

    await act(async () => { button('Move…').props.onPress(); });
    expect(read).not.toHaveBeenCalled();
  });

  it("offers Pin, Unpin and Forget in a card's menu, sends each as a card write, and shows the pushed result", async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const server = connect({ kind: 'live', build: 'muxify 1', protocol: 1 });
    await mount();
    await server.push(snapshotItem('Ship', 'Docs'));
    expect(labels()).toEqual(expect.arrayContaining(['Pin', 'Settle…', 'Forget…']));
    expect(labels()).not.toContain('Unpin');

    await act(async () => { button('Pin').props.onPress(); });
    expect(mockSend).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'host' }), T0, { kind: 'action', action: 'pin' }, expect.any(Function));
    const pinned = snapshotItem('Ship', 'Docs');
    const [ship, ...rest] = pinned.unpinned.places;
    await server.push({ ...pinned, pinned: [ship], unpinned: { ...pinned.unpinned, places: rest } });
    expect(labels()).toEqual(expect.arrayContaining(['Unpin', 'Pin']));

    await act(async () => { button('Unpin').props.onPress(); });
    expect(mockSend).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'host' }), T0, { kind: 'action', action: 'unpin' }, expect.any(Function));

    await act(async () => { button('Forget…').props.onPress(); });
    const [title, message, buttons] = alert.mock.calls[0]!;
    expect(title).toBe('Forget Ship?');
    expect(message).toContain('Its Worktrees stay in both cases.');
    expect((buttons as AlertButton[]).map((choice) => choice.text)).toEqual(['Forget', 'Forget and Stop Sessions', 'Cancel']);
    await act(async () => { (buttons as AlertButton[])[1]!.onPress!(); });
    expect(mockSend).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'host' }), 't0', 'forget-stopping-sessions', expect.any(Function));

    await server.push(snapshotItem('Docs'));
    expect(topics()).toEqual(['Topic Docs']);
  });

  it('draws the Board Sessions of the board fixture at their places, with the menu of each, and writes to the card', async () => {
    const server = connect({ kind: 'live', build: 'muxify 1', protocol: 1 });
    await mount();
    await server.push(protocolFrames('5-board').find((frame) => frame.kind === 'item' && 'pinned' in frame.item)!.item);

    expect(labels()).toEqual([
      'Mark as Unread', 'Unpin', 'Move Up', 'Move Down', 'Move…', 'Rename Session…', 'Move to Topic…', 'Kill Session…', 'Session docs', 'Mark as Unread docs',
      'Reopen', 'Start Fresh', 'Unpin', 'Move Up', 'Move Down', 'Move…', 'Session logs',
      'Reopen', 'Start Fresh', 'Pin', 'Move Up', 'Move Down', 'Bench', 'Move…', 'Session scratch',
      'Reopen', 'Start Fresh', 'Pin', 'Move Up', 'Move Down', 'Bench', 'Move…', 'Session notes',
    ]);
    expect(texts().filter((text) => text === 'Dormant')).toHaveLength(3);

    await act(async () => { labelled('Bench')[1]!.props.onPress(); });
    expect(mockSend).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'host' }), { kind: 'dormant-session', id: 's1' }, { kind: 'action', action: 'bench' }, expect.any(Function));
    await act(async () => { labelled('Unpin')[0]!.props.onPress(); });
    expect(mockSend).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'host' }), { kind: 'live-session', session: '$6' }, { kind: 'action', action: 'unpin' }, expect.any(Function));
    await act(async () => { button('Mark as Unread docs').props.onPress(); });
    expect(mockSend).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'host' }), { kind: 'live-session', session: '$6' }, { kind: 'action', action: 'mark-unread' }, expect.any(Function));
    await act(async () => { labelled('Reopen')[0]!.props.onPress(); });
    expect(mockSend).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'host' }), { kind: 'dormant-session', id: 's4' }, { kind: 'wake', wake: 'reopen' }, expect.any(Function));

    await act(async () => { button('Rename Session…').props.onPress(); });
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/rename', params: { hostId: 'host', kind: 'session', id: '$6', name: 'docs' } });
    await act(async () => { button('Move to Topic…').props.onPress(); });
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/move-to-topic', params: { hostId: 'host', session: '$6', name: 'docs' } });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await act(async () => { button('Kill Session…').props.onPress(); });
    const [title, , buttons] = alert.mock.calls[0]!;
    expect(title).toBe('Kill docs?');
    await act(async () => { (buttons as AlertButton[])[0]!.onPress!(); });
    expect(mockTmuxSend).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'host' }), { kind: 'kill-session', session: '$6' }, expect.any(Function));
  });

  it('moves a Board Session card: a Guest trades with a card In Play', async () => {
    const server = connect({ kind: 'live', build: 'muxify 1', protocol: 1 });
    await mount();
    await server.push(protocolFrames('5-board').find((frame) => frame.kind === 'item' && 'pinned' in frame.item)!.item);

    await act(async () => { labelled('Move…')[3]!.props.onPress(); });
    await act(async () => { button('Trade scratch').props.onPress(); });
    expect(mockSend).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'host' }),
      { kind: 'dormant-session', id: 's1' },
      { kind: 'drop', drop: { kind: 'trade', with: { kind: 'dormant-session', id: 's2' } } },
      expect.any(Function),
    );
  });

  it('offers the Session Actions on the Sessions tab and Mark All as Read in Options, sends each as a Host Write, and shows the pushed result', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockSettings = { hostScreenTabs: { host: 'sessions' } };
    const server = connect({ kind: 'live', build: 'muxify 1', protocol: 1 });
    await mount();
    const withScratch = (ship: string) => {
      const item = snapshotItem('Ship');
      return {
        ...item,
        no_topic: ['$9'],
        sessions: [{ ...item.sessions[0]!, name: ship }, { ...item.sessions[0]!, id: '$9', name: 'scratch', topic: null }],
      };
    };
    await server.push(withScratch('ship'));
    // Remove from Topic only for the Session in a Topic.
    expect(labels()).toEqual([
      'Rename Session…', 'Move to Topic…', 'Remove from Topic', 'Kill Session…', 'Session ship',
      'Rename Session…', 'Move to Topic…', 'Kill Session…', 'Session scratch',
    ]);

    await act(async () => { button('Remove from Topic').props.onPress(); });
    expect(mockTmuxSend).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'host' }), { kind: 'remove-from-topic', session: '$0' }, expect.any(Function));

    await act(async () => { labelled('Rename Session…')[0]!.props.onPress(); });
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/rename', params: { hostId: 'host', kind: 'session', id: '$0', name: 'ship' } });
    await server.push(withScratch('web'));
    expect(labels()).toContain('Session web');

    mockTmuxSend.mockClear();
    await act(async () => { labelled('Kill Session…')[1]!.props.onPress(); });
    expect(mockTmuxSend).not.toHaveBeenCalled();
    const [title, , buttons] = alert.mock.calls[0]!;
    expect(title).toBe('Kill scratch?');
    expect((buttons as AlertButton[]).map((choice) => choice.text)).toEqual(['Kill Session', 'Cancel']);
    await act(async () => { (buttons as AlertButton[])[0]!.onPress!(); });
    expect(mockTmuxSend).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'host' }), { kind: 'kill-session', session: '$9' }, expect.any(Function));
    const stopped = withScratch('web');
    await server.push({ ...stopped, no_topic: [], sessions: [stopped.sessions[0]] });
    expect(labels()).not.toContain('Session scratch');

    await act(async () => { toolbarMenuActions(renderer).get('Mark All as Read')!.props.onPress(); });
    expect(mockTmuxSend).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'host' }), { kind: 'mark-all-read' }, expect.any(Function));
    expect(read).not.toHaveBeenCalled();
  });

  it('keeps the last Listing on screen, with no spinner, while a new Connection waits for its first push', async () => {
    const first = connect({ kind: 'live', build: 'muxify 1', protocol: 1 });
    await mount();
    await first.push(snapshotItem('Ship'));

    await act(async () => { first.become({ kind: 'closed' }); });
    expect(mockConnections.hold).toHaveBeenCalledTimes(2);
    let second!: ReturnType<typeof connect>;
    await act(async () => { second = connect({ kind: 'starting' }); });

    expect(topics()).toEqual(['Topic Ship']);
    expect(texts()).not.toContain('Reading Dev Host…');
    await act(async () => { second.become({ kind: 'live', build: 'muxify 1', protocol: 1 }); });
    await second.push(snapshotItem('Ship', 'Docs'));
    expect(topics()).toEqual(['Topic Ship', 'Topic Docs']);
  });
});

describe('a Host Screen after a return from the background', () => {
  const LIVE = { kind: 'live', build: 'muxify 1', protocol: 1 } as const;
  const wait = (ms: number) => act(async () => { jest.advanceTimersByTime(ms); });
  /** The Connections, as the app goes away for `ms` and comes back: the Host Server has not been asked yet. */
  const away = (ms: number) => act(async () => {
    feed.pause();
    jest.advanceTimersByTime(ms);
    feed.resume();
  });
  /** The Host Server answered the return's ping: the Connections read the Listing again. */
  const answered = () => act(async () => { feed.refresh(); });
  const updating = () => texts().includes('Updating…');

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('says nothing after 10 s away, however slow the answer', async () => {
    const server = connect(LIVE);
    await mount();
    await server.push(snapshotItem('Ship'));

    await away(10_000);
    await wait(5_000);
    expect(updating()).toBe(false);
    await answered();
    await server.push(snapshotItem('Ship'));

    expect(updating()).toBe(false);
  });

  it('says nothing after 2 min away when the Host Server answers at once', async () => {
    const server = connect(LIVE);
    await mount();
    await server.push(snapshotItem('Ship'));

    await act(async () => { feed.pause(); });
    await wait(120_000);
    // Timers that fire as the app wakes, before it hears it is active, say nothing either.
    expect(updating()).toBe(false);
    await act(async () => { feed.resume(); });
    expect(updating()).toBe(false);
    await wait(300);
    await answered();
    expect(updating()).toBe(false);
    await wait(300);
    await server.push(snapshotItem('Ship', 'Docs'));

    expect(updating()).toBe(false);
    expect(topics()).toEqual(['Topic Ship', 'Topic Docs']);
  });

  it('says "Updating…" from 1 s after a return from 2 min away until the first push of the new subscription', async () => {
    const server = connect(LIVE);
    await mount();
    // An hour with no change on the Mac: the list stays the Host's.
    await server.push(snapshotItem('Ship'));
    await wait(3_600_000);
    expect(updating()).toBe(false);

    await away(120_000);
    await wait(999);
    expect(updating()).toBe(false);
    await wait(1);
    expect(updating()).toBe(true);

    // A push the old subscription held over the background proves nothing.
    await server.pushOn(0, snapshotItem('Ship', 'Old'));
    expect(updating()).toBe(true);
    await wait(5_000);
    await answered();
    expect(updating()).toBe(true);
    expect(topics()).toEqual(['Topic Ship', 'Topic Old']);

    await server.push(snapshotItem('Docs'));
    expect(updating()).toBe(false);
    expect(topics()).toEqual(['Topic Docs']);
  });

  it('says how long ago it last knew the list when it cannot update it after 2 hr away, not how old the last push is', async () => {
    const server = connect(LIVE);
    await mount();
    await server.push(snapshotItem('Ship'));
    await wait(3_600_000);

    await away(2 * 3_600_000);
    // The Host Server did not answer the ping: the Connections drop the link, and the next dial fails.
    (mockConnections.hold as jest.Mock).mockImplementationOnce(async () => { throw new Error('Network is unreachable'); });
    await act(async () => { server.become({ kind: 'closed' }); });

    expect(texts()).toContain('Not updated · 2 hr ago');
    expect(topics()).toEqual(['Topic Ship']);
    expect(labels()).toContain('Retry: not updated, 2 hr ago');
  });
});

describe('Sessions only', () => {
  it('shows the Sessions tab from tmux, says why there are no Topics, and hides the Topic Actions, Go to and New Topic', async () => {
    connect({ kind: 'sessions-only', reason: 'the Host Server did not answer' });
    await mount();

    expect(read).toHaveBeenCalledTimes(1);
    expect(texts()).toContain('Topics are unavailable on Dev Host: the Host Server did not answer');
    expect(labels()).toEqual(['Session api']);
    expect(labels().filter((label) => ['Pin', 'Unpin', 'Forget…'].includes(label))).toEqual([]);
    expect(labels().filter((label) => label.endsWith('Session…') || label === 'Remove from Topic')).toEqual([]);
    expect(renderer.root.findAllByType(Picker)).toEqual([]);
    expect(searchBar(renderer)).toBeUndefined();
    expect([...toolbarMenuActions(renderer).keys()]).toEqual(['New Session', 'Configure chooser']);

    toolbarMenuActions(renderer).get('New Session')!.props.onPress();
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/session-form', params: { hostId: 'host' } });
  });

  it('falls to Sessions only from a live Host Server that keeps stopping', async () => {
    const server = connect({ kind: 'live', build: 'muxify 1', protocol: 1 });
    await mount();
    await server.push(snapshotItem('Ship'));

    await act(async () => { server.become({ kind: 'sessions-only', reason: 'the Host Server stopped 3 times in a minute (boom)' }); });

    expect(topics()).toEqual([]);
    expect(labels()).toEqual(['Session api']);
    expect(texts()).toContain('Topics are unavailable on Dev Host: the Host Server stopped 3 times in a minute (boom)');
  });
});

describe('the Host CLI install', () => {
  it('says Muxify is being installed on a Host with no muxify', async () => {
    hostCli = { kind: 'running' };
    connect({ kind: 'installing' });
    await mount();

    expect(texts()).toContain('Installing Muxify on this Host…');
    expect(labels()).toEqual(['Session api']);
  });

  it('says Muxify is being updated on a Host whose muxify is too old for a Host Server', async () => {
    hostCli = { kind: 'running' };
    connect({ kind: 'sessions-only', reason: "the Host's muxify is too old (muxify 0)", tooOld: 'host' });
    await mount();

    expect(texts()).toContain('Updating Muxify on this Host…');
  });

  it('keeps saying the app is too old, and nothing of an update, on a Host whose muxify is too new for the phone', async () => {
    hostCli = { kind: 'running' };
    connect({ kind: 'sessions-only', reason: "Muxify Mobile is too old for the Host's muxify (muxify 3). Update the app.", tooOld: 'phone' });
    await mount();

    expect(texts()).toContain("Topics are unavailable on Dev Host: Muxify Mobile is too old for the Host's muxify (muxify 3). Update the app.");
    expect(texts()).not.toContain('Updating Muxify on this Host…');
    expect(labels()).toEqual(['Session api']);
  });
});
