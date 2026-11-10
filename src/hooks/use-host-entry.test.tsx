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
  deviceHostStore: () => ({ load: mockLoad, recentSessionsFor: async () => [], forgetLastPlace: async () => {} }),
}));
jest.mock('@/settings/settings-context', () => ({ useSettings: () => ({ settings: { zoomMultipaneWindows: true } }) }));
jest.mock('@/tmux/attach', () => ({ openAttach: (...args: unknown[]) => mockOpenAttach(...args) }));
jest.mock('@/tmux/ssh-connection', () => ({ appConnections: () => ({ openConnection: jest.fn(), lifecycleChanged: jest.fn() }) }));
jest.mock('@/topics/read-topic', () => ({ readTopic: (...args: unknown[]) => mockReadTopic(...args) }));
jest.mock('@/topics/wake-topic', () => ({ WAKE_LABEL: {}, wakeTopic: jest.fn() }));

const host = { id: 'host', displayName: 'Host', address: 'host', port: 22, identityId: 'key' };
const records: Records = { hosts: [host], identities: [], fingerprints: [], recentSessions: [], lastPlace: null };
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
