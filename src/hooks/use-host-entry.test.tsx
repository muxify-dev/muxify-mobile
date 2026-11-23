import React from 'react';
import { ActionSheetIOS, Alert } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { Records } from '@/storage/records';
import { AttachProvider, useAttachHolder } from '@/tmux/attach-context';
import type { AttachHolder } from '@/tmux/attach-holder';
import type { BoardSessionRow } from '@/domain/host-screen';
import type { BoardSessionId, TopicId, SessionId } from '@/topics/environment';
import type { TopicDetail, TopicRead } from '@/topics/topic-detail';

import { useHostEntry } from './use-host-entry';

const mockPush = jest.fn();
const mockEntered = jest.fn();
const mockOpenAttach = jest.fn();
const mockLoad = jest.fn();
const mockReadTopic = jest.fn();
const mockPlaceFor = jest.fn();
const mockWakeBoardSession = jest.fn();
let mockBlur: (() => void) | undefined;

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (effect: () => (() => void) | undefined) => {
    const React = require('react');
    React.useEffect(() => {
      mockBlur = effect();
      return mockBlur;
    }, [effect]);
  },
}));
jest.mock('@/diagnostics/device-log', () => ({ deviceLog: () => ({ record: () => {} }) }));
jest.mock('@/storage/device-store', () => ({
  deviceHostStore: () => ({ load: mockLoad, recentSessionsFor: async () => [], placeFor: (...args: unknown[]) => mockPlaceFor(...args), forgetLastPlace: async () => {} }),
}));
jest.mock('@/settings/settings-context', () => ({ useSettings: () => ({ settings: { zoomMultipaneWindows: true }, terminal: { foreground: '#e6e6e6', background: '#11131a' } }) }));
jest.mock('@/tmux/attach', () => ({ openAttach: (...args: unknown[]) => mockOpenAttach(...args) }));
jest.mock('@/tmux/ssh-connection', () => ({ appConnections: () => ({ openConnection: jest.fn(), lifecycleChanged: jest.fn() }) }));
jest.mock('@/topics/read-topic', () => ({ readTopic: (...args: unknown[]) => mockReadTopic(...args) }));
jest.mock('@/topics/act-on-card', () => ({ sendCardOrder: jest.fn() }));
jest.mock('@/topics/host-writes', () => ({ wakeBoardSession: (...args: unknown[]) => mockWakeBoardSession(...args) }));

const host = { id: 'host', displayName: 'Host', address: 'host', port: 22, identityId: 'key' };
const records: Records = { hosts: [host], identities: [], fingerprints: [], recentSessions: [], lastPlace: null, places: [] };
const topic: TopicDetail = {
  id: 'topic' as TopicId, label: 'Topic', state: 'live', tags: [], note: null,
  sessions: [{ id: '$1' as SessionId, name: 'work', windows: [] }],
};
let actions: ReturnType<typeof useHostEntry>;
let renderer: ReactTestRenderer;
let holder: AttachHolder;

function Screen({ fromAttach = false }: { fromAttach?: boolean }) {
  holder = useAttachHolder();
  actions = useHostEntry(host.id, mockEntered, fromAttach);
  return null;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockBlur = undefined;
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockLoad.mockResolvedValue(records);
  mockPlaceFor.mockResolvedValue(null);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => { renderer?.unmount(); });
  jest.restoreAllMocks();
});

async function mount(fromAttach = false) {
  await act(async () => { renderer = create(<AttachProvider><Screen fromAttach={fromAttach} /></AttachProvider>); });
}

it('does not deliver a Topic read after the originating screen loses focus', async () => {
  let answer!: (value: TopicRead) => void;
  mockReadTopic.mockImplementation(() => new Promise<TopicRead>((resolve) => { answer = resolve; }));
  await mount();
  await act(async () => { actions.openTopic({ ...topic, sessions: [] }); });
  expect(mockReadTopic).toHaveBeenCalledTimes(1);
  await act(async () => { mockBlur?.(); });
  await act(async () => { answer({ kind: 'shown', topic }); });
  expect(mockLoad).not.toHaveBeenCalled();
  expect(mockOpenAttach).not.toHaveBeenCalled();
  expect(mockEntered).not.toHaveBeenCalled();
});

it.each(['topic', 'session'] as const)('checks focus after the Host lookup for a %s entry', async (kind) => {
  let answer!: (value: Records) => void;
  mockLoad.mockImplementation(() => new Promise<Records>((resolve) => { answer = resolve; }));
  await mount();
  await act(async () => {
    if (kind === 'topic') actions.openTopic(topic);
    else actions.openSession('work');
  });
  expect(mockLoad).toHaveBeenCalledTimes(1);
  await act(async () => { mockBlur?.(); });
  await act(async () => { answer(records); });
  expect(mockOpenAttach).not.toHaveBeenCalled();
  expect(mockEntered).not.toHaveBeenCalled();
});

it('marks an Empty Topic form opened from the Terminal for origin capture', async () => {
  await mount(true);
  await act(async () => { actions.openTopic({ ...topic, state: 'empty', sessions: [] }); });
  expect(mockPush).toHaveBeenCalledWith(expect.objectContaining({
    pathname: '/topic-add-session',
    params: expect.objectContaining({ topicId: topic.id, fromAttach: '1' }),
  }));
});


it('does not replace a newer Attach after a plain Session Host lookup', async () => {
  let answer!: (value: Records) => void;
  mockLoad.mockImplementation(() => new Promise<Records>((resolve) => { answer = resolve; }));
  const newer = { state: () => ({ phase: { kind: 'connected' }, sessionName: 'newer', topic: null }) };
  mockOpenAttach.mockReturnValue(newer);
  await mount();
  await act(async () => { actions.openSession('older'); });
  await act(async () => {
    await holder.open({ host, destination: { sessionName: 'newer', topic: null }, zoomed: true });
  });
  await act(async () => { answer(records); });
  expect(holder.current()).toBe(newer);
  expect(mockOpenAttach).toHaveBeenCalledTimes(1);
  expect(mockEntered).not.toHaveBeenCalled();
});

it('reports a live Topic failure to the open chooser', async () => {
  mockReadTopic.mockResolvedValue({ kind: 'failed', error: 'Read failed' });
  const onError = jest.fn();
  await mount(true);
  await act(async () => { actions.openTopic({ ...topic, sessions: [] }, { isCurrent: () => true, onError }); });
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Read failed' }));
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(mockEntered).not.toHaveBeenCalled();
});

it('does not deliver a live Topic after its chooser closes', async () => {
  let answer!: (value: TopicRead) => void;
  let current = true;
  mockReadTopic.mockImplementation(() => new Promise<TopicRead>((resolve) => { answer = resolve; }));
  const onError = jest.fn();
  await mount(true);
  await act(async () => { actions.openTopic({ ...topic, sessions: [] }, { isCurrent: () => current, onError }); });
  current = false;
  await act(async () => { answer({ kind: 'shown', topic }); });
  expect(mockLoad).not.toHaveBeenCalled();
  expect(mockEntered).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
});

it('opens a Topic in the Session of its Topic Place, and asks the Attach to go back to that Place', async () => {
  const two = { ...topic, sessions: [...topic.sessions, { id: '$2' as SessionId, name: 'play', windows: [] }] };
  const place = { hostId: host.id, owner: { kind: 'topic', topicId: topic.id }, session: 'play', window: { id: '@3', index: 2, name: 'editor' },
    pane: '%9', tab: null, at: '2026-11-15T10:00:00.000Z' };
  mockPlaceFor.mockResolvedValue(place);
  mockOpenAttach.mockReturnValue({ state: () => ({ phase: { kind: 'connecting' }, sessionName: 'play', topic: null }) });
  await mount();
  await act(async () => { actions.openTopic(two); });
  expect(mockPlaceFor).toHaveBeenCalledWith(host.id, { kind: 'topic', topicId: topic.id });
  expect(mockOpenAttach).toHaveBeenCalledWith(expect.objectContaining({
    destination: { sessionName: 'play', topic: { id: topic.id, seed: two }, restore: place },
  }));
});

describe('a Session with no Topic', () => {
  const TAB = { url: 'http://100.64.0.1:3000/', page: 'http://100.64.0.1:3000/docs', scrollY: 420 };
  const place = { hostId: host.id, owner: { kind: 'session', session: 'notes' }, session: 'notes',
    window: { id: '@3', index: 2, name: 'editor' }, pane: '%9', tab: TAB, at: '2026-11-15T10:00:00.000Z' };

  beforeEach(() => {
    mockPlaceFor.mockResolvedValue(place);
    mockOpenAttach.mockReturnValue({ state: () => ({ phase: { kind: 'connecting' }, sessionName: 'notes', topic: null }) });
  });

  it.each([
    ['a row on the Sessions tab', () => actions.openSession('notes')],
    ['a live Board Session card', () => actions.openBoardSession({ kind: 'board-session', card: { kind: 'live-session', session: '$4' as SessionId },
      name: 'notes', mark: null, pinned: false, section: 'guests' })],
  ])('opens from %s at its Session Place, and shows its Tab', async (_from, open) => {
    await mount();
    await act(async () => { open(); });
    expect(mockPlaceFor).toHaveBeenCalledWith(host.id, { kind: 'session', session: 'notes' });
    expect(mockOpenAttach).toHaveBeenCalledWith(expect.objectContaining({
      destination: { sessionName: 'notes', topic: null, restore: place },
    }));
    expect(mockEntered).toHaveBeenCalledWith(TAB);
  });

  it('shows no Tab when the Attach keeps a Topic that lists the Session', async () => {
    mockOpenAttach.mockReturnValue({ state: () => ({ phase: { kind: 'connecting' }, sessionName: 'notes', topic: { id: topic.id } }) });
    await mount();
    await act(async () => { actions.openSession('notes'); });
    expect(mockEntered).toHaveBeenCalledWith(null);
  });
});

describe('a tap on a Board Session card', () => {
  const dormant: BoardSessionRow = {
    kind: 'board-session', card: { kind: 'dormant-session', id: 's1' as BoardSessionId }, name: 'notes', mark: null, pinned: false, section: 'guests',
  };
  let pick: (index: number) => void;

  beforeEach(() => {
    jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation((_options, callback) => { pick = callback; });
    mockOpenAttach.mockReturnValue({ state: () => ({ phase: { kind: 'connecting' }, sessionName: 'notes', topic: null }) });
  });

  it('opens the Session of a live one', async () => {
    await mount();
    await act(async () => { actions.openBoardSession({ ...dormant, card: { kind: 'live-session', session: '$4' as SessionId } }); });
    expect(ActionSheetIOS.showActionSheetWithOptions).not.toHaveBeenCalled();
    expect(mockOpenAttach).toHaveBeenCalledWith(expect.objectContaining({ destination: { sessionName: 'notes', topic: null, restore: null } }));
  });

  it.each([[0, 'reopen'], [1, 'start-fresh']] as const)(
    'offers Reopen, Start Fresh and Cancel for a Dormant one, wakes it with choice %i, and opens the Session the Host names',
    async (index, wake) => {
      mockWakeBoardSession.mockResolvedValue({ kind: 'woke', session: 'notes+2' });
      await mount();
      await act(async () => { actions.openBoardSession(dormant); });
      expect(ActionSheetIOS.showActionSheetWithOptions).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'notes', options: ['Reopen', 'Start Fresh', 'Cancel'], cancelButtonIndex: 2 }), expect.any(Function));

      await act(async () => { pick(index); });

      expect(mockWakeBoardSession).toHaveBeenCalledWith(expect.objectContaining({ id: 'host' }), 's1', wake, expect.any(String), expect.any(Function));
      expect(mockReadTopic).not.toHaveBeenCalled();
      expect(mockOpenAttach).toHaveBeenCalledWith(expect.objectContaining({ destination: { sessionName: 'notes+2', topic: null, restore: null } }));
      expect(mockEntered).toHaveBeenCalledWith(null);
    },
  );

  it("shows the Host's reason when it refuses the wake, and opens nothing", async () => {
    mockWakeBoardSession.mockResolvedValue({ kind: 'failed', error: 'The Board Session s1 is gone.' });
    await mount();
    await act(async () => { actions.openBoardSession(dormant); });
    await act(async () => { pick(0); });

    expect(Alert.alert).toHaveBeenCalledWith('Could not Reopen', 'The Board Session s1 is gone.');
    expect(mockOpenAttach).not.toHaveBeenCalled();
  });

  it('sends nothing on Cancel', async () => {
    await mount();
    await act(async () => { actions.openBoardSession(dormant); });
    await act(async () => { pick(2); });
    expect(mockWakeBoardSession).not.toHaveBeenCalled();
  });
});
