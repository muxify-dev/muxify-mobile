import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Button, TextField } from '@expo/ui/swift-ui';

import MoveToTopicScreen, { type MoveToTopicParams } from '@/app/move-to-topic';
import { fakeHostServer, lost, refused, snapshotPush } from '@/test-support/fake-host-server';
import { toolbarButton } from '@/test-support/toolbar';

let mockServer = fakeHostServer();
const mockParams = { hostId: 'host', session: '$3', name: 'scratch' } as MoveToTopicParams;
const mockBack = jest.fn();
const mockMovedIntoTopic = jest.fn();
let mockAttachedHost: string | null = null;
const TOPICS = [{ id: 'ship', label: 'Ship', state: 'live' }, { id: 'dock', label: 'Dock' }];
let mockListing = snapshotPush({ topics: TOPICS, sessions: [{ id: '$3', name: 'scratch' }] });
jest.mock('expo-router', () => ({
  ...require('@/test-support/toolbar').mockStack, useRouter: () => ({ back: mockBack }),
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@expo/ui/swift-ui', () => {
  const React = require('react');
  return {
    Button: 'Button', Form: 'Form', Host: 'Host', HStack: 'HStack', ProgressView: 'ProgressView',
    Section: 'Section', Text: 'Text', TextField: 'TextField',
    useNativeState: (value: string) => React.useRef({ value }).current,
  };
});
jest.mock('@expo/ui/swift-ui/modifiers', () => new Proxy({}, { get: (_, name) => (value: unknown) => ({ name, value }) }));
jest.mock('@/diagnostics/device-log', () => ({ deviceLog: () => ({ record: () => {} }) }));
jest.mock('@/storage/device-store', () => ({
  deviceHostStore: () => ({ load: async () => ({ hosts: [{ id: 'host', displayName: 'Dev Host' }] }) }),
}));
jest.mock('@/settings/settings-context', () => ({ useSettings: () => ({ appearance: 'dark', palette: require('@/constants/app-theme').AppPalettes.dark }) }));
jest.mock('@/tmux/ssh-connection', () => ({ appConnections: () => ({ onServer: mockServer.onServer }) }));
jest.mock('@/hooks/use-host-listing', () => ({
  useLiveListing: () => ({ server: { kind: 'live' }, snapshot: require('@/topics/environment').parseEnvironment(mockListing) }),
}));
jest.mock('@/tmux/attach-context', () => ({
  useAttachHolder: () => ({
    current: () => (mockAttachedHost === null ? null : { hostId: mockAttachedHost, movedIntoTopic: mockMovedIntoTopic }),
  }),
}));

let renderer: ReactTestRenderer;
const texts = () => renderer.root.findAllByType('Text' as never).map((node) => node.props.children).join('\n');
const button = (label: string) => renderer.root.findAllByType(Button).find((node) => node.props.label === label)!;
const labels = () => renderer.root.findAllByType(Button).map((node) => node.props.label);

beforeEach(() => {
  jest.clearAllMocks();
  mockServer = fakeHostServer();
  mockServer.answer = () => ({ changed: { topic_id: 'ship', created: false, session: '$3', session_name: 'scratch/ship' } });
  mockAttachedHost = null;
  mockListing = snapshotPush({ topics: TOPICS, sessions: [{ id: '$3', name: 'scratch' }] });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => { await act(async () => renderer?.unmount()); });

async function mount() {
  await act(async () => { renderer = create(<MoveToTopicScreen />); });
}

it('offers New Topic… and then the open Topics in Board order', async () => {
  await mount();
  expect(labels()).toEqual(['New Topic…', 'Ship', 'Dock']);
});

it('leaves out the Topic the Session is in', async () => {
  mockListing = snapshotPush({ topics: TOPICS, sessions: [{ id: '$3', name: 'scratch/ship', topic: 'ship' }] });
  await mount();
  expect(labels()).toEqual(['New Topic…', 'Dock']);
});

it('moves the Session into a picked Topic as one Host Write on the Session, then closes', async () => {
  await mount();
  await act(async () => { button('Ship').props.onPress(); });
  expect(mockServer.writes()).toEqual([
    { version: 2, command: { move: { to: { topic: { ref: { id: 'ship' } } } } }, target: { session: '$3' }, request: expect.any(String) },
  ]);
  expect(mockBack).toHaveBeenCalledTimes(1);
});

it('moves the Session into a new Topic with the title given, and asks for one first', async () => {
  await mount();
  await act(async () => { button('New Topic…').props.onPress(); });
  await act(async () => { toolbarButton(renderer, 'Create').props.onPress(); });
  expect(texts()).toContain('Give the Topic a title.');
  expect(mockServer.writes()).toEqual([]);

  renderer.root.findByType(TextField).props.text.value = ' Fix login ';
  await act(async () => { toolbarButton(renderer, 'Create').props.onPress(); });
  expect(mockServer.writes()).toEqual([
    { version: 2, command: { move: { to: { new_topic: { title: 'Fix login' } } } }, target: { session: '$3' }, request: expect.any(String) },
  ]);
  expect(mockBack).toHaveBeenCalledTimes(1);
});

it('tells an Attach on the Host which Topic the Session moved into, and none on another Host', async () => {
  mockAttachedHost = 'host';
  await mount();
  await act(async () => { button('Ship').props.onPress(); });
  expect(mockMovedIntoTopic).toHaveBeenCalledWith('$3', 'scratch', 'ship');

  mockMovedIntoTopic.mockClear();
  mockAttachedHost = 'other';
  await act(async () => { button('Dock').props.onPress(); });
  expect(mockMovedIntoTopic).not.toHaveBeenCalled();
});

it("shows the Host's refusal, stays open, and a Retry is a new Request", async () => {
  mockServer.answer = () => { throw refused('The Topic is gone.', 'topic_unavailable'); };
  await mount();
  await act(async () => { button('Ship').props.onPress(); });
  expect(texts()).toContain('The Topic is gone.');
  expect(mockBack).not.toHaveBeenCalled();

  mockServer.answer = () => ({ changed: { topic_id: 'ship' } });
  await act(async () => { button('Retry').props.onPress(); });
  const [first, again] = mockServer.writes();
  expect(again!.command).toEqual(first!.command);
  expect(again!.request).not.toBe(first!.request);
  expect(mockBack).toHaveBeenCalledTimes(1);
});

it('checks a move the Host did not answer in the pushed Listing, and closes once the Session is in the Topic', async () => {
  mockServer.answer = () => { throw lost(); };
  await mount();
  await act(async () => { button('Dock').props.onPress(); });
  expect(texts()).toContain('scratch may be in the Topic.');
  const [first, again] = mockServer.writes();
  expect(again!.request).toBe(first!.request);

  mockServer.pushes.snapshot = snapshotPush({ topics: [{ id: 'dock', label: 'Dock' }], sessions: [{ id: '$3', name: 'scratch' }] });
  await act(async () => { button('Check').props.onPress(); });
  expect(texts()).toContain('scratch is not in the Topic on Dev Host. Retry sends the move again.');
  expect(mockBack).not.toHaveBeenCalled();

  mockServer.answer = () => { throw lost(); };
  await act(async () => { button('Retry').props.onPress(); });
  mockServer.pushes.snapshot = snapshotPush({ topics: [{ id: 'dock', label: 'Dock' }], sessions: [{ id: '$3', name: 'scratch/dock', topic: 'dock' }] });
  await act(async () => { button('Check').props.onPress(); });
  expect(mockBack).toHaveBeenCalledTimes(1);
});

it('sends the title as it is now when Retry follows a refused new Topic', async () => {
  mockServer.answer = () => { throw refused('A Topic has that title.', 'invalid_request'); };
  await mount();
  await act(async () => { button('New Topic…').props.onPress(); });
  renderer.root.findByType(TextField).props.text.value = 'Fix login';
  await act(async () => { toolbarButton(renderer, 'Create').props.onPress(); });
  expect(texts()).toContain('A Topic has that title.');

  mockServer.answer = () => ({ changed: { topic_id: 'made' } });
  renderer.root.findByType(TextField).props.text.value = 'Fix logout';
  await act(async () => { button('Retry').props.onPress(); });
  expect(mockServer.writes().at(-1)!.command).toEqual({ move: { to: { new_topic: { title: 'Fix logout' } } } });
  expect(mockBack).toHaveBeenCalledTimes(1);
});
