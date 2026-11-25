import React from 'react';
import { Alert, type AlertButton } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Button, Text } from '@expo/ui/swift-ui';

import { TitleSheet } from '@/components/title-sheet';
import type { HostServer } from '@/ssh/host-server';
import type { LiveListing } from '@/ssh/host-listing-feed';
import { snapshotPush } from '@/test-support/fake-host-server';
import { parseEnvironment } from '@/topics/environment';
import type { Attach, AttachState } from '@/tmux/attach';
import { TOPIC_GONE, settledTopic, TOPIC_UNASKED, type TopicRead } from '@/topics/topic-detail';
import type { TopicId } from '@/topics/environment';
import { followHostTopic } from '@/topics/read-topic';

import { useTitleSheet } from './use-title-sheet';

/**
 * The Title Sheet of an Attach with a Topic, through a fake Host Server: the
 * real `topic` subscription and parser, the real `browser_tabs` read and
 * reachability filter, the real hook and sheet. The Attach stands in for the
 * real one, which settles each read the same way (`settledTopic`) and is
 * tested on its own in `attach.test.ts`.
 */

let mockFocused = true;
let mockServer: HostServer | null = null;
let mockAttach: Attach | null = null;
/** The Listing the Host Server of the Connection pushed, which offers the Session and Window Actions. */
let mockListing: LiveListing | null = null;
let mockLists = ['windows'];
const mockRouter = { push: jest.fn() };

jest.mock('expo-router', () => {
  const React = require('react');
  return {
    useNavigation: () => ({ isFocused: () => mockFocused }),
    useRouter: () => mockRouter,
    useFocusEffect: (effect: () => (() => void) | void) => {
      const focused = mockFocused;
      React.useEffect(() => (focused ? effect() : undefined), [effect, focused]);
    },
  };
});
jest.mock('@expo/ui/swift-ui', () => {
  const through = ({ children }: { children?: React.ReactNode }) => children;
  return {
    BottomSheet: 'BottomSheet', Button: 'Button', Divider: 'Divider', Group: 'Group', Host: 'Host',
    HStack: 'HStack', Image: 'Image', Picker: 'Picker', ScrollView: 'ScrollView', Spacer: 'Spacer',
    Text: 'Text', Toggle: 'Toggle', VStack: 'VStack', ZStack: 'ZStack', ProgressView: 'ProgressView',
    ContextMenu: Object.assign(through, { Items: through, Trigger: through }),
  };
});
jest.mock('@expo/ui/swift-ui/modifiers', () => new Proxy({}, {
  get: (_, name) => name === 'shapes' ? { rectangle: () => 'rectangle' } : (value: unknown) => ({ name, value }),
}));
jest.mock('@/components/topic-marks', () => ({ MarkImage: 'MarkImage', TagMarks: () => null }));
jest.mock('@/diagnostics/device-log', () => ({ deviceLog: () => ({ record: () => {} }) }));
jest.mock('@/settings/settings-context', () => ({
  useSettings: () => ({
    appearance: 'dark', palette: require('@/constants/app-theme').AppPalettes.dark,
    sheetPalette: require('@/constants/app-theme').sheetPaletteFor('ghostty'),
  }),
  useChooserLists: () => mockLists,
}));
jest.mock('@/hooks/use-host-reading', () => ({
  useHostReading: () => ({ topics: { kind: 'unasked' }, listing: { phase: 'idle' }, read: async () => {}, problem: null }),
}));
jest.mock('@/hooks/use-host-entry', () => ({ useHostEntry: () => ({ openSession: jest.fn(), openTopic: jest.fn() }) }));
const mockHolder = { current: () => mockAttach };
jest.mock('@/tmux/attach-context', () => ({ useAttachHolder: () => mockHolder }));
jest.mock('@osuki-dev/react-native-ssh', () => ({ connect: jest.fn() }));
jest.mock('@/storage/device-store', () => ({
  deviceHostStore: () => ({ load: async () => ({ hosts: [{ id: 'host', displayName: 'Dev Host' }] }) }),
}));
jest.mock('@/tmux/ssh-connection', () => ({
  appConnections: () => ({
    hostServer: () => mockServer,
    onServer: (_host: unknown, work: (server: HostServer) => Promise<unknown>) => work(mockServer!),
    listing: () => mockListing,
    subscribeListing: () => () => {},
  }),
}));

/**
 * A live Host Server whose `topic` subscriptions the test pushes into, and
 * which answers `browser_tabs` with `tabs`.
 */
function fakeServer() {
  const subscriptions: { payload: object; onItem: (item: unknown) => void; cancelled: boolean }[] = [];
  const requests: object[] = [];
  const fake = { tabs: [] as object[] };
  const server: HostServer = {
    state: () => ({ kind: 'live', build: 'muxify 1', protocol: 1 }),
    onState: () => () => {},
    request: (payload) => {
      requests.push(payload);
      const answer = 'browser_tabs' in payload ? Promise.resolve(fake.tabs)
        : 'environment' in payload ? Promise.resolve({ changed: {} })
          : new Promise<unknown>(() => {});
      return Object.assign(answer, { cancel: () => {} });
    },
    subscribe: (payload, onItem) => {
      const entry = { payload, onItem, cancelled: false };
      subscriptions.push(entry);
      return Object.assign(new Promise<unknown>(() => {}), { cancel: () => { entry.cancelled = true; } });
    },
    installAnswered: () => {},
    tryAgain: () => {},
    close: () => {},
  };
  return Object.assign(fake, {
    server,
    subscriptions,
    requests,
    push: (item: unknown) => act(async () => { subscriptions[subscriptions.length - 1]!.onItem(item); }),
  });
}

/** An Attach in Topic `t`, on Session `game/ship`, whose `showTopic` follows the Topic on the Host Server. */
function fakeAttach(sessions: { name: string; windowCount: number }[] = []): Attach {
  const listeners = new Set<(state: AttachState) => void>();
  let state = {
    sessionName: 'game/ship',
    topic: { id: 't' as TopicId, view: TOPIC_UNASKED },
    topology: {
      windows: [{ id: '@2', index: 1, name: 'claude', active: true, paneCount: 1, command: 'claude' }],
      activeWindow: { id: '@2', index: 1, name: 'claude', active: true, paneCount: 1, command: 'claude' },
      panes: [],
    },
    sessions, previews: new Map(), typing: { kind: 'open' },
  } as unknown as AttachState;
  const settle = (read: TopicRead) => {
    state = { ...state, topic: { id: state.topic!.id, view: settledTopic(state.topic!.view, read) } };
    for (const listener of [...listeners]) listener(state);
  };
  return {
    hostId: 'host',
    state: () => state,
    subscribe: (listener: (state: AttachState) => void) => {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    showTopic: () => followHostTopic('host', 't' as TopicId, settle),
    refreshTopic: () => {},
    refreshTopology: () => {},
    capturePreviews: () => {},
  } as unknown as Attach;
}

function Screen({ attach }: { attach: Attach }) {
  const [state, setState] = React.useState(() => attach.state());
  React.useEffect(() => attach.subscribe(setState), [attach]);
  const { sheet, openTitleSheet } = useTitleSheet({ attach, state, hostId: 'host', onOpenTab: () => {} });
  React.useEffect(() => { openTitleSheet(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <TitleSheet {...sheet} />;
}

/** A Topic as the Host Server pushes it: one Session with one Window, whose Pane runs an Agent. */
const topicItem = (label: string, window: string, status: string) => ({
  topic: {
    created_at: '2026-11-16T10:00:00Z', id: 't', label, note: null, slug: 'ship', state: 'live', tags: [], title: label,
    sessions: [{
      base_name: 'game', directory: '/work/game', id: '$1', name: 'game/ship', worktree: null,
      windows: [{
        active: true, id: '@2', index: 1, name: window,
        panes: [{ active: true, agent: { conversation: null, kind: 'claude', status, unread: true }, command: 'claude',
          id: '%3', index: 0, label: 'claude', path: '/work/game', window_id: '@2' }],
      }],
    }, {
      base_name: 'app', directory: '/work/app', id: '$2', name: 'app', worktree: null,
      windows: [{ active: true, id: '@5', index: 0, name: `${window} notes`, panes: [] }],
    }],
  },
});

let renderer: ReactTestRenderer;
let fake: ReturnType<typeof fakeServer>;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mockFocused = true;
  fake = fakeServer();
  mockServer = fake.server;
  mockListing = null;
  mockLists = ['windows'];
  jest.clearAllMocks();
});
afterEach(async () => { await act(async () => renderer?.unmount()); });

async function mount(attach = fakeAttach()) {
  mockAttach = attach;
  await act(async () => { renderer = create(<Screen attach={attach} />); });
}
const texts = () => renderer.root.findAllByType(Text).map((node) => node.props.children);
const labels = () => renderer.root.findAllByType(Button).map((node) =>
  node.props.modifiers?.find((modifier: { name: string }) => modifier.name === 'accessibilityLabel')?.value);
const marks = () => renderer.root.findAllByType('MarkImage' as never).map((node) => (node.props as { mark: string }).mark);

it("draws the Topic, its Windows and Agent marks from each push while the sheet is open", async () => {
  await mount();
  expect(fake.subscriptions.map((entry) => entry.payload)).toEqual([{ topic: { id: 't' } }]);

  await fake.push(topicItem('Ship', 'claude', 'working'));
  expect(texts()).toContain('Ship');
  expect(labels()).toEqual(expect.arrayContaining(['Session game/ship', 'claude', 'Session app', 'claude notes']));
  expect(marks()).toEqual(['working']);

  await fake.push(topicItem('Ship it', 'review', 'blocked'));
  expect(texts()).toContain('Ship it');
  expect(texts()).not.toContain('Ship');
  expect(labels()).toEqual(expect.arrayContaining(['review notes']));
  expect(marks()).toEqual(['blocked']);
  expect(fake.subscriptions).toHaveLength(1);
});

it('says that the Topic is gone on a null item', async () => {
  await mount();
  await fake.push(topicItem('Ship', 'claude', 'working'));
  await fake.push(null);
  expect(texts()).toContain(TOPIC_GONE);
  expect(labels()).toContain('Try again');
});

it('ends the subscription when the screen stops showing the Topic', async () => {
  await mount();
  expect(fake.subscriptions[0].cancelled).toBe(false);
  mockFocused = false;
  await act(async () => renderer.update(<Screen attach={fakeAttach()} />));
  expect(fake.subscriptions.every((entry) => entry.cancelled)).toBe(true);
  expect(fake.subscriptions).toHaveLength(1);

  mockFocused = true;
  const attach = fakeAttach();
  await act(async () => renderer.update(<Screen attach={attach} />));
  expect(fake.subscriptions.map((entry) => entry.cancelled)).toEqual([true, false]);
  await act(async () => renderer.unmount());
  expect(fake.subscriptions.every((entry) => entry.cancelled)).toBe(true);
});

it("lists the reachable Tabs that the Host Server answers for the Window on screen", async () => {
  fake.tabs = [
    { active: false, id: '00000000-0000-0000-0000-000000000000', title: '', url: 'http://localhost:3000/' },
    { active: true, id: '00000000-0000-0000-0000-000000000001', title: '', url: 'http://mac.tail1234.ts.net:3000/' },
    { active: false, id: '00000000-0000-0000-0000-000000000002', title: 'GitHub', url: 'https://github.com/' },
    { active: false, id: '00000000-0000-0000-0000-000000000003', title: '', url: 'http://192.168.1.10:8080/' },
  ];
  await mount();
  await fake.push(topicItem('Ship', 'claude', 'working'));

  expect(fake.requests).toEqual([{ browser_tabs: { window: '@2' } }]);
  expect(texts()).toContain('Browser tabs');
  expect(labels()).toEqual(expect.arrayContaining(['Tab http://mac.tail1234.ts.net:3000/', 'Tab GitHub']));
  expect(labels().filter((label: string | undefined) => label?.startsWith('Tab '))).toHaveLength(2);
});

it('lists no Browser tabs for a Window whose Browser has none', async () => {
  await mount();
  await fake.push(topicItem('Ship', 'claude', 'working'));

  expect(fake.requests).toEqual([{ browser_tabs: { window: '@2' } }]);
  expect(texts()).not.toContain('Browser tabs');
});

describe('the Session and Window Actions', () => {
  /** The Host Server is live, and its Listing has `game/ship` in Topic `t` and `app` in no Topic. */
  const live = (): LiveListing => ({
    server: { kind: 'live', build: 'muxify 1', protocol: 1 },
    received: {
      snapshot: parseEnvironment(snapshotPush({
        topics: [{ id: 't', label: 'Ship', state: 'live' }],
        sessions: [{ id: '$1', name: 'game/ship', topic: 't' }, { id: '$2', name: 'app' }],
      })),
      at: 0,
    },
    doubt: null,
  });
  const button = (label: string, nth = 0) => renderer.root.findAllByType(Button).filter((node) =>
    node.props.modifiers?.some((modifier: { name: string; value: unknown }) => modifier.name === 'accessibilityLabel' && modifier.value === label))[nth]!;
  const writes = () => fake.requests.flatMap((payload) => ('environment' in payload ? [(payload as { environment: object }).environment] : []));
  const confirmed = async (title: string) => {
    const alert = (Alert.alert as jest.Mock).mock.calls.at(-1)!;
    expect(alert[0]).toBe(title);
    const buttons = alert[2] as AlertButton[];
    expect(buttons.map((choice) => [choice.text, choice.style])).toEqual([[expect.any(String), 'destructive'], ['Cancel', 'cancel']]);
    await act(async () => { buttons[0]!.onPress!(); });
  };
  beforeEach(() => { jest.spyOn(Alert, 'alert').mockImplementation(() => {}); });

  it('offers Rename Window and Close Window on each Window, asks before Close, and sends it on the Window', async () => {
    mockListing = live();
    await mount();
    await fake.push(topicItem('Ship', 'claude', 'working'));
    expect(labels().filter((label: string) => label.endsWith('Window…'))).toEqual(
      ['Rename Window…', 'Close Window…', 'Rename Window…', 'Close Window…']);

    await act(async () => { button('Close Window…').props.onPress(); });
    expect(writes()).toEqual([]);
    await confirmed('Close claude?');
    expect(writes()).toEqual([{ version: 2, command: { kill_window: {} }, target: { window: '@2' }, request: expect.any(String) }]);
  });

  it('closes the sheet and opens the name sheet for Rename Window', async () => {
    mockListing = live();
    await mount();
    await fake.push(topicItem('Ship', 'claude', 'working'));

    await act(async () => { button('Rename Window…', 1).props.onPress(); });
    expect(renderer.root.findByType('BottomSheet' as never).props.isPresented).toBe(false);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 500)); });
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/rename', params: { hostId: 'host', kind: 'window', id: '@5', name: 'claude notes' },
    });
    expect(writes()).toEqual([]);
  });

  it('offers Remove from Topic only on a Session in a Topic, and asks before Kill Session', async () => {
    mockListing = live();
    mockLists = ['sessions'];
    await mount(fakeAttach([{ name: 'game/ship', windowCount: 1 }, { name: 'app', windowCount: 2 }]));
    expect(labels().filter((label: string) => label !== 'Close Choose')).toEqual([
      'Rename Session…', 'Move to Topic…', 'Remove from Topic', 'Kill Session…', 'game/ship',
      'Rename Session…', 'Move to Topic…', 'Kill Session…', 'app',
    ]);

    await act(async () => { button('Remove from Topic').props.onPress(); });
    await act(async () => { button('Kill Session…', 1).props.onPress(); });
    await confirmed('Kill app?');
    expect(writes()).toEqual([
      { version: 2, command: { remove_from_topic: {} }, target: { session: '$1' }, request: expect.any(String) },
      { version: 2, command: { kill_session: {} }, target: { session: '$2' }, request: expect.any(String) },
    ]);

    await act(async () => { button('Rename Session…').props.onPress(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 500)); });
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/rename', params: { hostId: 'host', kind: 'session', id: '$1', name: 'game/ship' },
    });
  });

  it('offers none of them in Sessions only', async () => {
    mockListing = { server: { kind: 'sessions-only', reason: 'the Host Server did not answer' }, received: null, doubt: null };
    mockLists = ['sessions', 'windows'];
    await mount(fakeAttach([{ name: 'game/ship', windowCount: 1 }]));
    await fake.push(topicItem('Ship', 'claude', 'working'));
    expect(labels()).toContain('game/ship');
    expect(labels().filter((label: string) => label.endsWith('…') || label === 'Remove from Topic')).toEqual([]);
  });
});
