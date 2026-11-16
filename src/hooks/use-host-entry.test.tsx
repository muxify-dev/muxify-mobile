import React from 'react';
import { Alert } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { Records } from '@/storage/records';
import { AttachProvider, useAttachHolder } from '@/tmux/attach-context';
import type { AttachHolder } from '@/tmux/attach-holder';
import type { TopicId, SessionId } from '@/topics/environment';
import type { TopicDetail, TopicRead } from '@/topics/topic-detail';

import { useHostEntry } from './use-host-entry';

const mockPush = jest.fn();
const mockEntered = jest.fn();
const mockOpenAttach = jest.fn();
const mockLoad = jest.fn();
const mockReadTopic = jest.fn();
const mockTopicPlaceFor = jest.fn();
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
  deviceHostStore: () => ({ load: mockLoad, recentSessionsFor: async () => [], topicPlaceFor: (...args: unknown[]) => mockTopicPlaceFor(...args), forgetLastPlace: async () => {} }),
}));
jest.mock('@/settings/settings-context', () => ({ useSettings: () => ({ settings: { zoomMultipaneWindows: true }, terminal: { foreground: '#e6e6e6', background: '#11131a' } }) }));
jest.mock('@/tmux/attach', () => ({ openAttach: (...args: unknown[]) => mockOpenAttach(...args) }));
jest.mock('@/tmux/ssh-connection', () => ({ appConnections: () => ({ openConnection: jest.fn(), lifecycleChanged: jest.fn() }) }));
jest.mock('@/topics/read-topic', () => ({ readTopic: (...args: unknown[]) => mockReadTopic(...args) }));
jest.mock('@/topics/act-on-topic', () => ({ sendTopicOrder: jest.fn() }));

const host = { id: 'host', displayName: 'Host', address: 'host', port: 22, identityId: 'key' };
const records: Records = { hosts: [host], identities: [], fingerprints: [], recentSessions: [], lastPlace: null, topicPlaces: [] };
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
  mockTopicPlaceFor.mockResolvedValue(null);
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
  const place = { hostId: host.id, topicId: topic.id, session: 'play', window: { id: '@3', index: 2, name: 'editor' },
    pane: '%9', tab: null, at: '2026-11-15T10:00:00.000Z' };
  mockTopicPlaceFor.mockResolvedValue(place);
  mockOpenAttach.mockReturnValue({ state: () => ({ phase: { kind: 'connecting' }, sessionName: 'play', topic: null }) });
  await mount();
  await act(async () => { actions.openTopic(two); });
  expect(mockTopicPlaceFor).toHaveBeenCalledWith(host.id, topic.id);
  expect(mockOpenAttach).toHaveBeenCalledWith(expect.objectContaining({
    destination: { sessionName: 'play', topic: { id: topic.id, seed: two }, restore: place },
  }));
});
